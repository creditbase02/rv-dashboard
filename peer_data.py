"""Shared Peer Group mapping rules for the LUAC and Supply snapshots.

The source is an optional Excel workbook with TICKER and Peer Group columns.
Both datasets embed the accepted mapping in their own published snapshot, so
the published JSON stays the single data asset of each page.
"""

from __future__ import annotations

from pathlib import Path

from xlsx_table import find_table

MAX_GROUP_NAME = 160
MAX_TICKER = 32


def require_peer_text(value: object, field: str, row: int, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ValueError(f"Peer mapping row {row} has invalid {field}")
    return value.strip()


def validate_peer_definitions(definitions: object) -> None:
    if not isinstance(definitions, list) or not definitions:
        raise ValueError("Peer definitions must be a non-empty list")
    names: set[str] = set()
    tickers: set[str] = set()
    for definition in definitions:
        if not isinstance(definition, dict) or set(definition) != {"name", "tickers"}:
            raise ValueError("Peer definition must contain only name and tickers")
        name, members = definition["name"], definition["tickers"]
        if not isinstance(name, str) or not name.strip() or len(name) > MAX_GROUP_NAME or name in names:
            raise ValueError("Peer definition name is invalid")
        if not isinstance(members, list) or not members:
            raise ValueError("Peer definition tickers are invalid")
        names.add(name)
        for ticker in members:
            if not isinstance(ticker, str) or not ticker or ticker != ticker.strip().upper() or len(ticker) > MAX_TICKER:
                raise ValueError("Peer definition ticker is invalid")
            if ticker in tickers:
                raise ValueError(f"Duplicate peer ticker: {ticker}")
            tickers.add(ticker)


def peer_group_map(definitions: object) -> dict[str, str]:
    validate_peer_definitions(definitions)
    return {
        ticker: definition["name"]
        for definition in definitions
        for ticker in definition["tickers"]
    }


def parse_peer_definitions(path: Path) -> list[dict[str, object]]:
    values, maximum, headers, formulas = find_table(path, ("TICKER", "Peer Group"))
    ticker_column, group_column = headers["TICKER"], headers["Peer Group"]
    definitions: list[dict[str, object]] = []
    by_name: dict[str, list[str]] = {}
    seen: set[str] = set()
    for row in range(2, maximum + 1):
        ticker_value, group_value = values.get((row, ticker_column)), values.get((row, group_column))
        if ticker_value in (None, "") and group_value in (None, ""):
            continue
        if (row, ticker_column) in formulas or (row, group_column) in formulas:
            raise ValueError(f"Peer mapping row {row} may not use formulas")
        ticker = require_peer_text(ticker_value, "TICKER", row, MAX_TICKER).upper()
        group = require_peer_text(group_value, "Peer Group", row, MAX_GROUP_NAME)
        if ticker in seen:
            raise ValueError(f"Duplicate peer ticker: {ticker}")
        seen.add(ticker)
        if group not in by_name:
            by_name[group] = []
            definitions.append({"name": group, "tickers": by_name[group]})
        by_name[group].append(ticker)
    validate_peer_definitions(definitions)
    return definitions
