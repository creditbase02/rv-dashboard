"""Minimal read-only XLSX worksheet table reader shared by the extractors.

Only header-driven lookup tables are supported: the first row holds the header
names and every later row is a record. Cells keep their raw values so callers
stay responsible for the field rules of their own dataset.
"""

from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CELL = re.compile(r"^([A-Z]+)(\d+)$")
MAX_HEADER_COLUMN = 512


def column_number(address: str) -> int:
    match = CELL.match(address)
    if not match:
        raise ValueError(f"Invalid Excel address: {address}")
    result = 0
    for character in match.group(1):
        result = result * 26 + ord(character) - 64
    return result


def workbook_sheets(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relations = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {
        node.get("Id"): node.get("Target")
        for node in relations.findall(f"{{{PACKAGE_REL}}}Relationship")
    }
    result = []
    for node in workbook.findall(f".//{{{MAIN}}}sheet"):
        target = targets[node.get(f"{{{REL}}}id")].lstrip("/")
        path = target if target.startswith("xl/") else f"xl/{target}"
        result.append((node.get("name", ""), path.replace("/./", "/")))
    return result


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(node.itertext()) for node in root.findall(f"{{{MAIN}}}si")]


def sheet_cells(
    archive: zipfile.ZipFile, path: str, strings: list[str]
) -> tuple[dict[tuple[int, int], object], int, set[tuple[int, int]]]:
    root = ET.fromstring(archive.read(path))
    result: dict[tuple[int, int], object] = {}
    formulas: set[tuple[int, int]] = set()
    maximum_row = 0
    for cell in root.findall(f".//{{{MAIN}}}c"):
        address = cell.get("r", "")
        match = CELL.match(address)
        if not match:
            continue
        row, column = int(match.group(2)), column_number(address)
        maximum_row = max(maximum_row, row)
        if cell.find(f"{{{MAIN}}}f") is not None:
            formulas.add((row, column))
        cell_type = cell.get("t", "n")
        if cell_type == "inlineStr":
            value: object = "".join(node.text or "" for node in cell.findall(f".//{{{MAIN}}}t"))
        else:
            value_node = cell.find(f"{{{MAIN}}}v")
            if value_node is None or value_node.text in (None, ""):
                value = None
            elif cell_type == "s":
                value = strings[int(value_node.text)]
            elif cell_type in ("str", "e"):
                value = value_node.text
            else:
                try:
                    value = float(value_node.text)
                except ValueError as error:
                    raise ValueError(f"Invalid numeric cell {address}") from error
        result[(row, column)] = value
    return result, maximum_row, formulas


def find_table(
    path: Path, required: tuple[str, ...]
) -> tuple[dict[tuple[int, int], object], int, dict[str, int], set[tuple[int, int]]]:
    with zipfile.ZipFile(path) as archive:
        strings = shared_strings(archive)
        matches = []
        for name, sheet_path in workbook_sheets(archive):
            values, maximum, formulas = sheet_cells(archive, sheet_path, strings)
            headers: dict[str, int] = {}
            for column in range(1, MAX_HEADER_COLUMN):
                value = values.get((1, column))
                if isinstance(value, str) and value not in headers:
                    headers[value.strip()] = column
            if all(header in headers for header in required):
                matches.append((name, values, maximum, headers, formulas))
    if len(matches) != 1:
        raise ValueError(f"Workbook must contain exactly one worksheet with: {', '.join(required)}")
    _, values, maximum, headers, formulas = matches[0]
    return values, maximum, headers, formulas
