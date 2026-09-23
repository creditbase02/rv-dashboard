from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.extract_supply import extract, tenor_bucket
from scripts.validate_fast_supply import validate_fast_supply
from scripts.verify_supply_data_only_pr import verify as verify_supply_data_only_pr
from supply_data import LEGACY_TENOR_BUCKETS, MAX_PUBLISH_BYTES, RATING_ORDER, TENOR_BUCKETS, reconciled_percentages, validate_supply
from tests.make_supply_fixture import make_fixture


class SupplyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data_path = ROOT / "assets" / "supply-data.json"
        cls.data = json.loads(cls.data_path.read_text(encoding="utf-8"))
        cls.public = ROOT / "public"

    def test_legacy_schema_and_per_security_payloads_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "schema"):
            validate_supply({**self.data, "schema_version": 1})
        duplicate = copy.deepcopy(self.data)
        pairs = duplicate["top_tickers"]["ytd"]["industry"][0][1]
        pairs[-1] = list(pairs[0])
        with self.assertRaisesRegex(ValueError, "duplicate category"):
            validate_supply(duplicate)
        unordered = copy.deepcopy(self.data)
        rows = unordered["top_tickers"]["ytd"]["industry"][0][1]
        rows[0], rows[1] = rows[1], rows[0]
        with self.assertRaisesRegex(ValueError, "order is invalid"):
            validate_supply(unordered)
        leaked = copy.deepcopy(self.data)
        leaked["top_tickers"]["ytd"]["industry"][0][1][0].append("912828XX1")
        with self.assertRaisesRegex(ValueError, "wrong shape"):
            validate_supply(leaked)
        text = json.dumps(self.data)
        for field in ("CUSIP", "BB ID", "ISIN", "Tranche Size", "Pricing Date", "source_file", "workbook", ".xlsx"):
            self.assertNotIn(field, text)

    def test_initial_snapshot_matches_approved_acceptance_values(self):
        result = validate_supply(self.data)
        self.assertIn(self.data["schema_version"], (2, 3))
        self.assertEqual(self.data["date"], "2026-09-21")
        self.assertEqual(self.data["year"], 2026)
        self.assertEqual(self.data["row_count"], 1620)
        self.assertEqual(self.data["ytd_usd"], 1_628_675_719_000)
        self.assertEqual(self.data["mtd_usd"], 139_350_000_000)
        self.assertEqual(result["date_corrections"], 5)
        self.assertEqual(result["duplicate_cusip_groups"], 12)
        self.assertLess(self.data_path.stat().st_size, MAX_PUBLISH_BYTES)

    def test_top_tickers_are_compact_sorted_and_use_other_ig(self):
        self.assertNotIn("Others", json.dumps(self.data))
        self.assertEqual(self.data["breakdowns"]["peer_group"][-1][0], "Other IG")
        for scope in ("industry", "rating", "peer_group"):
            totals = dict(self.data["breakdowns"][scope])
            for category, pairs in self.data["top_tickers"]["ytd"][scope]:
                self.assertLessEqual(len(pairs), 5)
                self.assertEqual(len({ticker for ticker, _ in pairs}), len(pairs))
                self.assertEqual(pairs, sorted(pairs, key=lambda row: (-row[1], row[0].casefold())))
                self.assertLessEqual(sum(value for _, value in pairs), totals[category])
        monthly = self.data["top_tickers"]["monthly"]
        self.assertEqual(len(monthly["total"]), 12)
        for month, pairs in enumerate(monthly["total"]):
            self.assertLessEqual(sum(value for _, value in pairs), self.data["monthly"]["total"][month])
        peer_totals = dict(self.data["monthly"]["peer_groups"])
        for group, month_lists in monthly["peer_groups"]:
            self.assertEqual(len(month_lists), 12)
            for month, pairs in enumerate(month_lists):
                self.assertLessEqual(sum(value for _, value in pairs), peer_totals[group][month])

    def test_all_aggregate_views_reconcile_exactly(self):
        for name in ("industry", "rating", "tenor", "peer_group"):
            self.assertEqual(sum(value for _, value in self.data["breakdowns"][name]), self.data["ytd_usd"])
            self.assertEqual(sum(reconciled_percentages(self.data["breakdowns"][name], self.data["ytd_usd"])), 10_000)
        tenor_buckets = LEGACY_TENOR_BUCKETS if self.data["schema_version"] == 2 else TENOR_BUCKETS
        self.assertEqual(self.data["breakdowns"]["tenor"], [
            [name, dict(self.data["breakdowns"]["tenor"])[name]] for name in tenor_buckets
        ])
        positions = [RATING_ORDER.index(name) if name in RATING_ORDER else len(RATING_ORDER) for name, _ in self.data["breakdowns"]["rating"]]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(sum(self.data["monthly"]["total"]), self.data["ytd_usd"])
        for month in range(12):
            self.assertEqual(sum(values[month] for _, values in self.data["monthly"]["peer_groups"]), self.data["monthly"]["total"][month])

    def test_fixture_corrects_five_dates_and_keeps_duplicate_cusips(self):
        with tempfile.TemporaryDirectory() as directory:
            workbook, peers = make_fixture(Path(directory))
            data, audit = extract(workbook, peer_workbook=peers)
        self.assertEqual(data["date"], "2026-09-17")
        self.assertEqual(data["row_count"], 12)
        self.assertEqual(data["ytd_usd"], 1_300_000_000)
        self.assertEqual(data["mtd_usd"], 500_000_000)
        self.assertEqual(data["quality"], {"date_corrections": 5, "duplicate_cusip_groups": 1})
        self.assertEqual(len(audit["date_corrections"]), 5)
        self.assertEqual(dict(data["breakdowns"]["tenor"]), {
            "FRN": 100_000_000,
            "3yr & In (1.5–3.5yr)": 300_000_000,
            "5yr (3.5–6yr)": 200_000_000,
            "7yr (6–8yr)": 200_000_000,
            "10yr (8–12yr)": 100_000_000,
            "20yr (12–22yr)": 200_000_000,
            "30yr (22–32yr)": 100_000_000,
            ">32yr (>32yr)": 0,
            "Perpetual": 100_000_000,
        })

    def test_tenor_bucket_boundaries_keep_frn_and_ticker_perpetual(self):
        cases = (
            ("ABC FRN 2030", "bad", "FRN"),
            ("ABC PERP", "bad", "Perpetual"),
            ("ABC", 3.5, "3yr & In (1.5–3.5yr)"),
            ("ABC", 6, "5yr (3.5–6yr)"),
            ("ABC", 8, "7yr (6–8yr)"),
            ("ABC", 12, "10yr (8–12yr)"),
            ("ABC", 22, "20yr (12–22yr)"),
            ("ABC", 32, "30yr (22–32yr)"),
            ("ABC", 32.01, ">32yr (>32yr)"),
        )
        for security, tenor, expected in cases:
            with self.subTest(tenor=tenor):
                self.assertEqual(tenor_bucket(security, tenor, 2), expected)
        with self.assertRaisesRegex(ValueError, "invalid Tenor"):
            tenor_bucket("ABC", "#N/A Field Not Applicable", 2)

    def test_fixture_rejects_ambiguous_or_invalid_workbooks(self):
        cases = (
            ("missing-column", "exactly one worksheet"),
            ("no-match", "no same-ticker"),
            ("tie", "tied same-ticker"),
            ("bad-amount", "invalid Tranche Size"),
            ("bad-tenor", "invalid Tenor"),
            ("formula", "may not use formulas"),
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for variant, message in cases:
                with self.subTest(variant=variant):
                    workbook, peers = make_fixture(root / variant, variant)
                    with self.assertRaisesRegex(ValueError, message):
                        extract(workbook, peer_workbook=peers)

    def test_invalid_aggregate_snapshots_are_rejected(self):
        mutations = (
            lambda data: data["breakdowns"]["industry"][0].__setitem__(1, 0),
            lambda data: data["monthly"]["total"].__setitem__(0, -1),
            lambda data: data["breakdowns"]["tenor"].reverse(),
            lambda data: data["breakdowns"]["rating"].reverse(),
            lambda data: data["peer_definitions"][1]["tickers"].append(data["peer_definitions"][0]["tickers"][0]),
            lambda data: data["quality"].update(source_file="private.xlsx"),
            lambda data: data["top_tickers"]["ytd"]["industry"][0][1].reverse(),
            lambda data: data.update(schema_version=1),
        )
        for mutate in mutations:
            broken = copy.deepcopy(self.data)
            mutate(broken)
            with self.subTest(mutate=mutate), self.assertRaises((TypeError, ValueError)):
                validate_supply(broken)

    def test_fast_validation_allows_same_date_but_rejects_regression_and_drift(self):
        validate_fast_supply(self.data, copy.deepcopy(self.data), self.data_path, self.public)
        newer = copy.deepcopy(self.data)
        newer["date"] = "2026-09-16"
        with self.assertRaisesRegex(ValueError, "must not be earlier"):
            validate_fast_supply(newer, self.data, self.data_path, self.public)
        drift = copy.deepcopy(self.data)
        drift["row_count"] *= 2
        with self.assertRaisesRegex(ValueError, "20%"):
            validate_fast_supply(drift, self.data, self.data_path, self.public)

    def test_automated_pr_allows_only_supply_snapshot(self):
        verify_supply_data_only_pr(["assets/supply-data.json"])
        for changed in ([], ["assets/supply-data.json", "assets/supply.js"], ["assets/rv-data.json"]):
            with self.assertRaises(ValueError):
                verify_supply_data_only_pr(changed)

    def test_public_page_and_manifest_use_supply_date_without_changing_rv_date(self):
        public_data = json.loads((self.public / "assets" / "supply-data.json").read_text(encoding="utf-8"))
        manifest = json.loads((self.public / "integration-manifest.json").read_text(encoding="utf-8"))
        page = (self.public / "supply.html").read_text(encoding="utf-8")
        rv = json.loads((ROOT / "assets" / "rv-data.json").read_text(encoding="utf-8"))
        self.assertEqual(public_data, self.data)
        self.assertEqual(manifest["content_as_of"], rv["date"])
        self.assertEqual(manifest["datasets"]["supply"], {"content_as_of": self.data["date"], "asset": "assets/supply-data.json"})
        self.assertIn(f'datetime="{self.data["date"]}"', page)
        self.assertIn("重複 CUSIP 保留並全數計入", page)


if __name__ == "__main__":
    unittest.main()
