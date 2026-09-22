"""Validation rules for the sanitized IG primary supply snapshot."""

from __future__ import annotations

import math
from datetime import date


SCHEMA_VERSION = 2
OTHER_IG = "Other IG"
TENOR_BUCKETS = ("FRN", "≤5Y", ">5Y–10Y", ">10Y / Perpetual")
RATING_ORDER = (
    "AAA", "AA+", "AA", "AA-", "A+", "A", "A-",
    "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-", "B+", "B", "B-",
    "CCC+", "CCC", "CCC-", "CC", "C", "D", "NR",
)
MAX_PUBLISH_BYTES = 262_144


def finite_number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def valid_usd(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def reconciled_percentages(records: list[list[object]], total: int) -> list[int]:
    """Return integer basis points whose displayed percentages total 100.00%."""
    if total <= 0:
        raise ValueError("Supply percentage total must be positive")
    floors: list[int] = []
    remainders: list[tuple[int, int]] = []
    for index, record in enumerate(records):
        amount = record[1]
        if not valid_usd(amount):
            raise ValueError("Supply percentage amount is invalid")
        quotient, remainder = divmod(amount * 10_000, total)
        floors.append(quotient)
        remainders.append((remainder, index))
    if sum(record[1] for record in records) != total:
        raise ValueError("Supply percentages do not reconcile")
    for _, index in sorted(remainders, key=lambda item: (-item[0], item[1]))[:10_000 - sum(floors)]:
        floors[index] += 1
    return floors


def _validate_pairs(value: object, field: str, *, allow_empty: bool = False) -> int:
    if not isinstance(value, list) or (not value and not allow_empty):
        raise ValueError(f"Supply {field} must be a non-empty list")
    names: set[str] = set()
    total = 0
    for index, record in enumerate(value, start=1):
        if not isinstance(record, list) or len(record) != 2:
            raise ValueError(f"Supply {field} row {index} has the wrong shape")
        name, amount = record
        if not isinstance(name, str) or not name.strip() or len(name) > 160:
            raise ValueError(f"Supply {field} row {index} has invalid text")
        if name in names:
            raise ValueError(f"Supply {field} contains duplicate category {name}")
        if not valid_usd(amount):
            raise ValueError(f"Supply {field} row {index} has invalid USD amount")
        names.add(name)
        total += amount
    return total


def _validate_top_pairs(value: object, field: str, denominator: int) -> None:
    if not isinstance(value, list) or len(value) > 5:
        raise ValueError(f"Supply {field} Top 5 has the wrong shape")
    total = _validate_pairs(value, field, allow_empty=True)
    if any(amount <= 0 for _, amount in value) or total > denominator:
        raise ValueError(f"Supply {field} Top 5 amount is invalid")
    if value != sorted(value, key=lambda row: (-row[1], row[0].casefold())):
        raise ValueError(f"Supply {field} Top 5 order is invalid")


def validate_supply(data: dict) -> dict[str, int]:
    expected = {
        "schema_version", "date", "year", "currency", "row_count",
        "ytd_usd", "mtd_usd", "breakdowns", "monthly", "peer_definitions",
        "peer_tickers", "top_tickers", "quality",
    }
    if not isinstance(data, dict) or set(data) != expected:
        raise ValueError("Unexpected Supply snapshot fields")
    if data["schema_version"] != SCHEMA_VERSION or data["currency"] != "USD":
        raise ValueError("Unexpected Supply schema")
    parsed_date = date.fromisoformat(data["date"])
    if not isinstance(data["year"], int) or data["year"] != parsed_date.year:
        raise ValueError("Supply year does not match data date")
    if not isinstance(data["row_count"], int) or not 1 <= data["row_count"] <= 100_000:
        raise ValueError("Supply row count is out of range")
    if not valid_usd(data["ytd_usd"]) or data["ytd_usd"] <= 0 or not valid_usd(data["mtd_usd"]):
        raise ValueError("Supply headline totals are invalid")
    if data["mtd_usd"] > data["ytd_usd"]:
        raise ValueError("Supply MTD exceeds YTD")

    breakdowns = data["breakdowns"]
    if not isinstance(breakdowns, dict) or set(breakdowns) != {"industry", "rating", "tenor", "peer_group"}:
        raise ValueError("Unexpected Supply breakdown fields")
    for field in ("industry", "rating", "tenor", "peer_group"):
        if _validate_pairs(breakdowns[field], field) != data["ytd_usd"]:
            raise ValueError(f"Supply {field} does not reconcile to YTD")
    if [record[0] for record in breakdowns["tenor"]] != list(TENOR_BUCKETS):
        raise ValueError("Supply tenor bucket order is invalid")
    rating_positions = [RATING_ORDER.index(record[0]) if record[0] in RATING_ORDER else len(RATING_ORDER) for record in breakdowns["rating"]]
    if any(record[0] not in RATING_ORDER for record in breakdowns["rating"]) or rating_positions != sorted(rating_positions):
        raise ValueError("Supply rating order is invalid")

    monthly = data["monthly"]
    if not isinstance(monthly, dict) or set(monthly) != {"total", "peer_groups"}:
        raise ValueError("Unexpected Supply monthly fields")
    if not isinstance(monthly["total"], list) or len(monthly["total"]) != 12 or not all(valid_usd(value) for value in monthly["total"]):
        raise ValueError("Supply monthly total series is invalid")
    if sum(monthly["total"]) != data["ytd_usd"]:
        raise ValueError("Supply monthly totals do not reconcile to YTD")

    definitions = data["peer_definitions"]
    if not isinstance(definitions, list) or not definitions:
        raise ValueError("Supply peer definitions are missing")
    peer_names: list[str] = []
    peer_tickers_seen: set[str] = set()
    for index, definition in enumerate(definitions, start=1):
        if not isinstance(definition, dict) or set(definition) != {"name", "tickers"}:
            raise ValueError(f"Supply peer definition {index} has the wrong shape")
        name, tickers = definition["name"], definition["tickers"]
        if not isinstance(name, str) or not name.strip() or name in {"Others", OTHER_IG} or name in peer_names:
            raise ValueError(f"Supply peer definition {index} has an invalid name")
        if not isinstance(tickers, list) or not tickers:
            raise ValueError(f"Supply peer definition {name} has no tickers")
        for ticker in tickers:
            if not isinstance(ticker, str) or not ticker.strip() or len(ticker) > 32 or ticker in peer_tickers_seen:
                raise ValueError(f"Supply peer definition {name} has an invalid ticker")
            peer_tickers_seen.add(ticker)
        peer_names.append(name)
    expected_peer_names = [*peer_names, OTHER_IG]
    if [record[0] for record in breakdowns["peer_group"]] != expected_peer_names:
        raise ValueError("Supply peer group order does not match definitions")

    peer_monthly = monthly["peer_groups"]
    if not isinstance(peer_monthly, list) or [record[0] for record in peer_monthly] != expected_peer_names:
        raise ValueError("Supply peer monthly groups do not match definitions")
    month_reconciliations = [0] * 12
    for index, record in enumerate(peer_monthly, start=1):
        if not isinstance(record, list) or len(record) != 2 or not isinstance(record[1], list) or len(record[1]) != 12:
            raise ValueError(f"Supply peer monthly row {index} has the wrong shape")
        if not all(valid_usd(value) for value in record[1]):
            raise ValueError(f"Supply peer monthly row {index} has invalid values")
        for month, value in enumerate(record[1]):
            month_reconciliations[month] += value
    if month_reconciliations != monthly["total"]:
        raise ValueError("Supply peer monthly values do not reconcile")

    peer_tickers = data["peer_tickers"]
    if not isinstance(peer_tickers, dict) or list(peer_tickers) != peer_names:
        raise ValueError("Supply peer ticker groups do not match definitions")
    peer_totals = dict(breakdowns["peer_group"])
    for name in peer_names:
        if _validate_pairs(peer_tickers[name], f"peer ticker {name}", allow_empty=True) != peer_totals[name]:
            raise ValueError(f"Supply peer ticker group {name} does not reconcile")

    top = data["top_tickers"]
    if not isinstance(top, dict) or set(top) != {"ytd", "monthly"}:
        raise ValueError("Unexpected Supply Top 5 fields")
    if not isinstance(top["ytd"], dict) or set(top["ytd"]) != {"industry", "rating", "peer_group"}:
        raise ValueError("Unexpected Supply YTD Top 5 fields")
    for field in ("industry", "rating", "peer_group"):
        rows = top["ytd"][field]
        expected_rows = breakdowns[field]
        if not isinstance(rows, list) or [row[0] for row in rows if isinstance(row, list) and len(row) == 2] != [row[0] for row in expected_rows]:
            raise ValueError(f"Supply {field} Top 5 categories do not match")
        totals = dict(expected_rows)
        for name, ticker_rows in rows:
            _validate_top_pairs(ticker_rows, f"{field} {name}", totals[name])
    for name in peer_names:
        if dict(top["ytd"]["peer_group"])[name] != peer_tickers[name][:5]:
            raise ValueError(f"Supply peer Top 5 {name} does not match ticker totals")

    top_monthly = top["monthly"]
    if not isinstance(top_monthly, dict) or set(top_monthly) != {"total", "peer_groups"}:
        raise ValueError("Unexpected Supply monthly Top 5 fields")
    if not isinstance(top_monthly["total"], list) or len(top_monthly["total"]) != 12:
        raise ValueError("Supply monthly total Top 5 has the wrong shape")
    for month, ticker_rows in enumerate(top_monthly["total"]):
        _validate_top_pairs(ticker_rows, f"month {month + 1}", monthly["total"][month])
    top_peer_monthly = top_monthly["peer_groups"]
    if not isinstance(top_peer_monthly, list) or [row[0] for row in top_peer_monthly if isinstance(row, list) and len(row) == 2] != expected_peer_names:
        raise ValueError("Supply monthly peer Top 5 groups do not match")
    monthly_peer_totals = dict(peer_monthly)
    for name, months in top_peer_monthly:
        if not isinstance(months, list) or len(months) != 12:
            raise ValueError(f"Supply monthly peer Top 5 {name} has the wrong shape")
        for month, ticker_rows in enumerate(months):
            _validate_top_pairs(ticker_rows, f"month {month + 1} {name}", monthly_peer_totals[name][month])

    quality = data["quality"]
    if not isinstance(quality, dict) or set(quality) != {"date_corrections", "duplicate_cusip_groups"}:
        raise ValueError("Unexpected Supply quality fields")
    if any(not isinstance(quality[field], int) or quality[field] < 0 for field in quality):
        raise ValueError("Supply quality counts are invalid")
    return {
        "rows": data["row_count"],
        "date_corrections": quality["date_corrections"],
        "duplicate_cusip_groups": quality["duplicate_cusip_groups"],
    }


def validate_supply_drift(current: dict, previous: dict) -> None:
    validate_supply(current)
    validate_supply(previous)
    for field, label in (("row_count", "row count"), ("ytd_usd", "YTD volume")):
        baseline = previous[field]
        if baseline <= 0:
            raise ValueError(f"Previous Supply {label} is empty")
        ratio = current[field] / baseline
        if ratio < 0.8 or ratio > 1.2:
            raise ValueError(f"Supply {label} changed by more than ±20%; manual review is required")
