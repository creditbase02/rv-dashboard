#!/usr/bin/env python3
"""Create small Supply and peer-mapping workbooks for strict extractor tests."""

from __future__ import annotations

import argparse
import html
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.extract_supply import REQUIRED


def address(column: int, row: int) -> str:
    letters = ""
    while column:
        column, remainder = divmod(column - 1, 26)
        letters = chr(65 + remainder) + letters
    return f"{letters}{row}"


def cell(column: int, row: int, value: object, formula: str | None = None) -> str:
    ref = address(column, row)
    formula_xml = f"<f>{html.escape(formula)}</f>" if formula else ""
    if isinstance(value, str):
        return f'<c r="{ref}" t="inlineStr">{formula_xml}<is><t>{html.escape(value)}</t></is></c>'
    return f'<c r="{ref}">{formula_xml}<v>{value}</v></c>'


def write_workbook(path: Path, sheet_name: str, headers: list[str], records: list[list[object]], formulas: set[tuple[int, int]] | None = None) -> Path:
    formulas = formulas or set()
    rows = [f'<row r="1">{"".join(cell(index, 1, value) for index, value in enumerate(headers, 1))}</row>']
    for row_number, values in enumerate(records, 2):
        contents = []
        for column, value in enumerate(values, 1):
            if value is None:
                continue
            contents.append(cell(column, row_number, value, "1+1" if (row_number, column) in formulas else None))
        rows.append(f'<row r="{row_number}">{"".join(contents)}</row>')
    sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' \
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' \
        + "".join(rows) + '</sheetData></worksheet>'
    workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' \
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' \
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' \
        f'<sheet name="{html.escape(sheet_name)}" sheetId="1" r:id="rId1"/></sheets></workbook>'
    workbook_rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' \
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' \
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' \
        '</Relationships>'
    content_types = '<?xml version="1.0" encoding="UTF-8"?>' \
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' \
        '<Default Extension="xml" ContentType="application/xml"/></Types>'
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)
    return path


def base_records() -> list[list[object]]:
    # Five stale-year rows sit beside the same-ticker current-year record. The
    # final two rows deliberately share a CUSIP and both must be counted.
    return [
        ["ID01", "CUSIP01", "AAA FLOAT 2028", "AAA", "02/20/24", 100_000_000, 2, "Banks", "A"],
        ["ID02", "CUSIP02", "AAA 4.0 2031", "AAA", "01/15/26", 100_000_000, 5, "Banks", "A"],
        ["ID03", "CUSIP03", "BBB 4.2 2034", "BBB", "08/17/05", 100_000_000, 8, "Utility", "BBB"],
        ["ID04", "CUSIP04", "BBB 4.4 2036", "BBB", "02/12/26", 100_000_000, 10, "Utility", "BBB"],
        ["ID05", "CUSIP05", "CCC PERP", "CCC", "07/27/29", 100_000_000, "PERP", "Finance", "#N/A"],
        ["ID06", "CUSIP06", "CCC 5.0 2056", "CCC", "03/10/26", 100_000_000, 30, "Finance", "AA-"],
        ["ID07", "CUSIP07", "DDD 4.0 2030", "DDD", "11/13/25", 100_000_000, 4, "Technology", "AA"],
        ["ID08", "CUSIP08", "DDD 4.5 2033", "DDD", "04/14/26", 100_000_000, 7, "Technology", "AA"],
        ["ID09", "CUSIP09", "EEE 5.0 2041", "EEE", "01/09/23", 100_000_000, 15, "Healthcare", "BBB+"],
        ["ID10", "CUSIP10", "EEE 5.0 2042", "EEE", "09/17/26", 100_000_000, 16, "Healthcare", "BBB+"],
        ["ID11", "DUPLICATE", "AAA 3.0 2029", "AAA", "09/17/26", 100_000_000, 3, "Banks", "A"],
        ["ID12", "DUPLICATE", "AAA 3.1 2029", "AAA", "09/17/26", 200_000_000, 3, "Banks", "A"],
    ]


def make_fixture(output: Path, variant: str = "valid") -> tuple[Path, Path]:
    output.mkdir(parents=True, exist_ok=True)
    headers = list(REQUIRED)
    records = base_records()
    formulas: set[tuple[int, int]] = set()
    if variant == "missing-column":
        headers[-1] = "Wrong Header"
    elif variant == "no-match":
        records[0][3] = "NO_MATCH"
    elif variant == "tie":
        # Stale row 3 is exactly one row from two current-year BBB candidates.
        records.insert(2, ["ID00", "CUSIP00", "BBB 4.0 2030", "BBB", "01/02/26", 50_000_000, 4, "Utility", "BBB"])
    elif variant == "bad-amount":
        records[0][5] = 0
    elif variant == "bad-tenor":
        records[1][6] = "UNKNOWN"
    elif variant == "formula":
        formulas.add((2, 6))
    supply = write_workbook(output / "supply.xlsx", "Supply", headers, records, formulas)
    peers = write_workbook(
        output / "peers.xlsx",
        "Peers",
        ["TICKER", "Peer Group"],
        [["AAA", "Banks"], ["BBB", "Regulated"], ["DDD", "Technology"]],
    )
    return supply, peers


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--variant", default="valid")
    arguments = parser.parse_args()
    supply, peers = make_fixture(arguments.out, arguments.variant)
    print(supply)
    print(peers)


if __name__ == "__main__":
    main()
