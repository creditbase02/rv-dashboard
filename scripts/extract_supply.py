#!/usr/bin/env python3
"""Extract a sanitized aggregate IG primary supply snapshot from Excel."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from peer_data import parse_peer_definitions
from supply_data import OTHER_IG, RATING_ORDER, SCHEMA_VERSION, TENOR_BUCKETS, validate_supply
from xlsx_table import find_table

REQUIRED = (
    "BB ID", "CUSIP", "Ticker", "Corp Ticker", "Pricing Date",
    "Tranche Size", "Tenor", "Ind Sector", "BB Composite",
)


def require_text(value: object, field: str, row: int, maximum: int = 160) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ValueError(f"Supply row {row} has invalid {field}")
    return value.strip()


def parse_date(value: object, row: int) -> date:
    if isinstance(value, str):
        for pattern in ("%m/%d/%y", "%m/%d/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(value.strip(), pattern).date()
            except ValueError:
                pass
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return date(1899, 12, 30) + timedelta(days=math.floor(value))
    raise ValueError(f"Supply row {row} has invalid Pricing Date")


def require_usd(value: object, row: int) -> int:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0 or value > 10_000_000_000_000:
        raise ValueError(f"Supply row {row} has invalid Tranche Size")
    rounded = round(value)
    if abs(value - rounded) > 1e-6:
        raise ValueError(f"Supply row {row} Tranche Size must be whole USD")
    return rounded


def tenor_bucket(security: str, tenor: object, row: int) -> str:
    upper = security.upper()
    if "FLOAT" in upper or re.search(r"\bFRN\b", upper):
        return "FRN"
    if "PERP" in upper:
        return ">10Y / Perpetual"
    if not isinstance(tenor, (int, float)) or isinstance(tenor, bool) or not math.isfinite(tenor) or tenor <= 0:
        raise ValueError(f"Supply row {row} has invalid Tenor")
    if tenor <= 5:
        return "≤5Y"
    if tenor <= 10:
        return ">5Y–10Y"
    return ">10Y / Perpetual"


def normalize_rating(value: object) -> str:
    if not isinstance(value, str):
        return "NR"
    normalized = value.strip().upper()
    return normalized if normalized in RATING_ORDER else "NR"


def _pairs(totals: dict[str, int], order: list[str] | None = None) -> list[list[object]]:
    keys = order if order is not None else sorted(totals, key=lambda key: (-totals[key], key.casefold()))
    return [[key, totals.get(key, 0)] for key in keys]


def _top(totals: dict[str, int]) -> list[list[object]]:
    return _pairs(totals)[:5]


def extract(workbook: Path, peer_workbook: Path | None = None, peer_definitions: list[dict[str, object]] | None = None) -> tuple[dict, dict]:
    if (peer_workbook is None) == (peer_definitions is None):
        raise ValueError("Provide exactly one peer mapping source")
    definitions = parse_peer_definitions(peer_workbook) if peer_workbook else peer_definitions
    assert definitions is not None
    validate_definition_tickers = [ticker for definition in definitions for ticker in definition["tickers"]]
    if len(validate_definition_tickers) != len(set(validate_definition_tickers)):
        raise ValueError("Peer mapping contains duplicate tickers")

    values, maximum, headers, formulas = find_table(workbook, REQUIRED)
    records = []
    required_columns = {headers[field] for field in REQUIRED}
    for row in range(2, maximum + 1):
        if values.get((row, headers["BB ID"])) in (None, ""):
            continue
        if any((row, column) in formulas for column in required_columns):
            raise ValueError(f"Supply row {row} required fields may not use formulas")
        record = {
            "row": row,
            "id": require_text(values.get((row, headers["BB ID"])), "BB ID", row, 64),
            "cusip": require_text(values.get((row, headers["CUSIP"])), "CUSIP", row, 32),
            "security": require_text(values.get((row, headers["Ticker"])), "Ticker", row, 180),
            "ticker": require_text(values.get((row, headers["Corp Ticker"])), "Corp Ticker", row, 32).upper(),
            "date": parse_date(values.get((row, headers["Pricing Date"])), row),
            "usd": require_usd(values.get((row, headers["Tranche Size"])), row),
            "tenor": values.get((row, headers["Tenor"])),
            "industry": require_text(values.get((row, headers["Ind Sector"])), "Ind Sector", row),
            "rating": normalize_rating(values.get((row, headers["BB Composite"])),),
        }
        records.append(record)
    if not records:
        raise ValueError("Supply workbook has no records")

    year_counts = Counter(record["date"].year for record in records)
    main_year, main_count = year_counts.most_common(1)[0]
    if list(year_counts.values()).count(main_count) > 1:
        raise ValueError("Supply workbook has no unique primary year")
    corrections = []
    valid_year_rows = [record for record in records if record["date"].year == main_year]
    for record in records:
        if record["date"].year == main_year:
            continue
        candidates = [candidate for candidate in valid_year_rows if candidate["ticker"] == record["ticker"]]
        if not candidates:
            raise ValueError(f"Supply row {record['row']} has no same-ticker {main_year} date candidate")
        distances = sorted(
            ((abs(candidate["row"] - record["row"]), candidate) for candidate in candidates),
            key=lambda item: (item[0], item[1]["row"]),
        )
        if len(distances) > 1 and distances[0][0] == distances[1][0]:
            raise ValueError(f"Supply row {record['row']} has tied same-ticker date candidates")
        replacement = distances[0][1]["date"]
        corrections.append({"row": record["row"], "ticker": record["ticker"], "from": record["date"].isoformat(), "to": replacement.isoformat()})
        record["date"] = replacement

    peer_lookup = {
        ticker: definition["name"]
        for definition in definitions
        for ticker in definition["tickers"]
    }
    peer_names = [definition["name"] for definition in definitions]
    industry: defaultdict[str, int] = defaultdict(int)
    rating: defaultdict[str, int] = defaultdict(int)
    tenor: defaultdict[str, int] = defaultdict(int)
    peer: defaultdict[str, int] = defaultdict(int)
    peer_tickers: dict[str, defaultdict[str, int]] = {name: defaultdict(int) for name in peer_names}
    industry_tickers: defaultdict[str, defaultdict[str, int]] = defaultdict(lambda: defaultdict(int))
    rating_tickers: defaultdict[str, defaultdict[str, int]] = defaultdict(lambda: defaultdict(int))
    peer_top_tickers: defaultdict[str, defaultdict[str, int]] = defaultdict(lambda: defaultdict(int))
    monthly_total = [0] * 12
    all_peer_names = [*peer_names, OTHER_IG]
    monthly_peer = {name: [0] * 12 for name in all_peer_names}
    monthly_total_tickers = [defaultdict(int) for _ in range(12)]
    monthly_peer_tickers = {name: [defaultdict(int) for _ in range(12)] for name in all_peer_names}
    for record in records:
        group = peer_lookup.get(record["ticker"], OTHER_IG)
        bucket = tenor_bucket(record["security"], record["tenor"], record["row"])
        amount, month = record["usd"], record["date"].month - 1
        industry[record["industry"]] += amount
        rating[record["rating"]] += amount
        tenor[bucket] += amount
        peer[group] += amount
        monthly_total[month] += amount
        monthly_peer[group][month] += amount
        industry_tickers[record["industry"]][record["ticker"]] += amount
        rating_tickers[record["rating"]][record["ticker"]] += amount
        peer_top_tickers[group][record["ticker"]] += amount
        monthly_total_tickers[month][record["ticker"]] += amount
        monthly_peer_tickers[group][month][record["ticker"]] += amount
        if group != OTHER_IG:
            peer_tickers[group][record["ticker"]] += amount

    data_date = max(record["date"] for record in records)
    ytd = sum(record["usd"] for record in records)
    mtd = sum(record["usd"] for record in records if record["date"].month == data_date.month)
    rating_order = [value for value in RATING_ORDER if value in rating]
    rating_order.extend(sorted(value for value in rating if value not in RATING_ORDER))
    duplicate_cusips = sum(1 for count in Counter(record["cusip"] for record in records).values() if count > 1)
    result = {
        "schema_version": SCHEMA_VERSION,
        "date": data_date.isoformat(),
        "year": main_year,
        "currency": "USD",
        "row_count": len(records),
        "ytd_usd": ytd,
        "mtd_usd": mtd,
        "breakdowns": {
            "industry": _pairs(industry),
            "rating": _pairs(rating, rating_order),
            "tenor": _pairs(tenor, list(TENOR_BUCKETS)),
            "peer_group": _pairs(peer, all_peer_names),
        },
        "monthly": {
            "total": monthly_total,
            "peer_groups": [[name, monthly_peer[name]] for name in all_peer_names],
        },
        "peer_definitions": definitions,
        "peer_tickers": {name: _pairs(peer_tickers[name]) for name in peer_names},
        "top_tickers": {
            "ytd": {
                "industry": [[name, _top(industry_tickers[name])] for name, _ in _pairs(industry)],
                "rating": [[name, _top(rating_tickers[name])] for name, _ in _pairs(rating, rating_order)],
                "peer_group": [[name, _top(peer_top_tickers[name])] for name in all_peer_names],
            },
            "monthly": {
                "total": [_top(tickers) for tickers in monthly_total_tickers],
                "peer_groups": [[name, [_top(tickers) for tickers in monthly_peer_tickers[name]]] for name in all_peer_names],
            },
        },
        "quality": {
            "date_corrections": len(corrections),
            "duplicate_cusip_groups": duplicate_cusips,
        },
    }
    validate_supply(result)
    audit = {
        "date": result["date"],
        "year": main_year,
        "rows": len(records),
        "ytd_usd": ytd,
        "mtd_usd": mtd,
        "date_corrections": corrections,
        "duplicate_cusip_groups": duplicate_cusips,
    }
    return result, audit


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--peers", required=True, type=Path)
    parser.add_argument("--output", type=Path, help="Write sanitized JSON here; defaults to stdout")
    parser.add_argument("--audit", type=Path, help="Write private validation details outside the repository")
    arguments = parser.parse_args()
    data, audit = extract(arguments.workbook, peer_workbook=arguments.peers)
    serialized = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    if arguments.output:
        arguments.output.write_text(serialized, encoding="utf-8")
    else:
        print(serialized, end="")
    if arguments.audit:
        audit_path = arguments.audit.resolve()
        if audit_path.is_relative_to(ROOT):
            parser.error("Private audit must be outside the repository")
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Supply snapshot date={data['date']} rows={data['row_count']} "
        f"ytd_usd={data['ytd_usd']} corrections={data['quality']['date_corrections']}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
