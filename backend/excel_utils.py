"""Excel import/export helpers using openpyxl.

We never store the Excel file — we work with in-memory workbooks and return
bytes that the client saves to disk.
"""
from __future__ import annotations

import io
from typing import Any, Dict, List, Tuple

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

# Columns exposed in the export/import template. Case sensitive header text.
COLUMNS: List[Tuple[str, str]] = [
    ("name", "Name"),
    ("designation", "Designation"),
    ("company", "Company"),
    ("email", "Email"),
    ("phone", "Phone"),
    ("website", "Website"),
    ("address", "Address"),
    ("city", "City"),
    ("state", "State"),
    ("country", "Country"),
    ("pincode", "Pincode"),
    ("industry", "Industry"),
    ("tags", "Tags"),
    ("notes", "Notes"),
    ("linkedin", "LinkedIn"),
    ("company_size", "Company Size"),
]

HEADER_FILL = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
HEADER_FONT = Font(color="FFFFFF", bold=True, size=12)
CENTER = Alignment(horizontal="left", vertical="center", wrap_text=True)


def _apply_header_style(ws) -> None:
    for cell in ws[1]:
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.freeze_panes = "A2"
    for idx, _ in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(idx)].width = 22


def build_export(contacts: List[Dict[str, Any]]) -> bytes:
    """Return an .xlsx binary of the provided contacts."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Contacts"
    ws.append([label for _, label in COLUMNS])
    _apply_header_style(ws)
    for c in contacts:
        row = []
        for key, _ in COLUMNS:
            v = c.get(key, "")
            if key == "tags" and isinstance(v, list):
                v = ", ".join(v)
            row.append(v if v is not None else "")
        ws.append(row)
        # style each row
        for cell in ws[ws.max_row]:
            cell.alignment = CENTER
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_template() -> bytes:
    """Return an .xlsx sample template with headers + one example row."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Contacts"
    ws.append([label for _, label in COLUMNS])
    _apply_header_style(ws)
    sample = {
        "name": "Jane Cooper", "designation": "Sales Manager", "company": "Acme Corp",
        "email": "jane@acme.com", "phone": "+91 9876543210", "website": "acme.com",
        "address": "123 Main St", "city": "Mumbai", "state": "MH", "country": "India",
        "pincode": "400001", "industry": "Software", "tags": "client, vip",
        "notes": "Met at Web Summit", "linkedin": "linkedin.com/in/jane", "company_size": "50-200",
    }
    ws.append([sample[key] for key, _ in COLUMNS])
    for cell in ws[ws.max_row]:
        cell.alignment = CENTER
    # Note sheet
    note = wb.create_sheet("README")
    note["A1"] = "How to import"
    note["A1"].font = Font(size=14, bold=True)
    lines = [
        "1. Fill the 'Contacts' sheet — one row per contact.",
        "2. All columns are provided. Leave blank if unknown, but Name+Email or Name+Phone is required.",
        "3. Tags are comma-separated and case-insensitive.",
        "4. Save the file and upload it back into CardVault (Contacts → Import).",
    ]
    for i, line in enumerate(lines, start=3):
        note.cell(row=i, column=1, value=line)
    note.column_dimensions["A"].width = 90

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def parse_workbook(binary: bytes) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Parse an uploaded .xlsx. Returns (rows, errors).

    Each row is validated: must have (name AND (email OR phone)).
    Unknown columns are ignored; header must match template.
    """
    errors: List[str] = []
    try:
        wb = load_workbook(io.BytesIO(binary), data_only=True)
    except Exception as e:
        return [], [f"Invalid Excel file: {e}"]

    if "Contacts" in wb.sheetnames:
        ws = wb["Contacts"]
    else:
        ws = wb.active

    header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None)
    if not header_row:
        return [], ["Empty file"]
    header_map: Dict[int, str] = {}
    label_to_key = {label: key for key, label in COLUMNS}
    for i, val in enumerate(header_row):
        if val is None:
            continue
        label = str(val).strip()
        if label in label_to_key:
            header_map[i] = label_to_key[label]
    if not header_map:
        return [], ["Header row does not match the template — download the sample and try again."]

    rows: List[Dict[str, Any]] = []
    for r_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not row or all(v is None or str(v).strip() == "" for v in row):
            continue
        d: Dict[str, Any] = {}
        for col_idx, key in header_map.items():
            if col_idx >= len(row):
                continue
            v = row[col_idx]
            if v is None:
                d[key] = ""
                continue
            if key == "tags":
                if isinstance(v, str):
                    d[key] = [t.strip().lower() for t in v.split(",") if t.strip()]
                else:
                    d[key] = []
            else:
                d[key] = str(v).strip()
        # Validate
        if not d.get("name"):
            errors.append(f"Row {r_idx}: missing Name")
            d["_error"] = "Missing Name"
        elif not d.get("email") and not d.get("phone"):
            errors.append(f"Row {r_idx}: needs Email or Phone")
            d["_error"] = "Need Email or Phone"
        d["_row"] = r_idx
        rows.append(d)
    return rows, errors
