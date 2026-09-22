#!/usr/bin/env python3
"""Validate a trusted Supply data-only update without the full site suite."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from supply_data import MAX_PUBLISH_BYTES, validate_supply, validate_supply_drift


def load_json(path: Path) -> dict:
    def reject_constant(value: str):
        raise ValueError(f"Invalid JSON number: {value}")
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=reject_constant)


def validate_fast_supply(current: dict, previous: dict, current_path: Path, public_root: Path) -> None:
    result = validate_supply(current)
    validate_supply(previous)
    if current["date"] < previous["date"]:
        raise ValueError(f"Data date {current['date']} must not be earlier than {previous['date']}")
    validate_supply_drift(current, previous)
    if current_path.stat().st_size > MAX_PUBLISH_BYTES:
        raise ValueError("Supply snapshot exceeds the 256 KiB publish limit")
    if load_json(public_root / "assets" / "supply-data.json") != current:
        raise ValueError("Built public Supply snapshot does not match assets/supply-data.json")
    manifest = load_json(public_root / "integration-manifest.json")
    expected = {"content_as_of": current["date"], "asset": "assets/supply-data.json"}
    if manifest.get("datasets", {}).get("supply") != expected:
        raise ValueError("Built manifest Supply dataset is incorrect")
    page = (public_root / "supply.html").read_text(encoding="utf-8")
    if f'datetime="{current["date"]}"' not in page or current["date"].replace("-", "/") not in page:
        raise ValueError("Built Supply page has the wrong snapshot date")
    print(f"Fast Supply validation PASS: date={current['date']} rows={result['rows']} ytd_usd={current['ytd_usd']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--current", type=Path, required=True)
    parser.add_argument("--previous", type=Path, required=True)
    parser.add_argument("--public-root", type=Path, required=True)
    arguments = parser.parse_args()
    validate_fast_supply(load_json(arguments.current), load_json(arguments.previous), arguments.current, arguments.public_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
