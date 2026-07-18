"""Iteration 3 — new-feature backend tests.

Covers:
- OCR: no 'tesseract not installed' error; returns pincode key; Claude vision primary
- Contacts: tags normalized to lowercase + de-duped; case-insensitive filter
- Contacts: pincode field persists + returned
- /contacts/facets endpoint
- /ai/write-email (generate + shorten)
- Campaigns: multi-select filter_tags/industries/countries/states/cities resolve recipients
- /contacts/duplicates still works
"""
from __future__ import annotations

import base64
import io
import os
import re
import subprocess
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_BACKEND_URL", "https://ocr-contacts-hub-1.preview.emergentagent.com"
).rstrip("/") + "/api"
BACKEND_LOG = "/var/log/supervisor/backend.err.log"


def _fresh_email() -> str:
    return f"TEST_{uuid.uuid4().hex[:10]}@cardvault.dev"


def _fetch_otp(email: str, purpose: str = "signup", timeout_s: int = 6) -> str:
    pattern = re.compile(
        rf"OTP for {re.escape(email.lower())} \({re.escape(purpose)}\) = (\d{{6}})",
        re.IGNORECASE,
    )
    deadline = time.time() + timeout_s
    latest = None
    while time.time() < deadline:
        try:
            out = subprocess.check_output(
                ["tail", "-n", "500", BACKEND_LOG], stderr=subprocess.STDOUT
            ).decode("utf-8", errors="ignore")
        except Exception:
            out = ""
        for m in pattern.finditer(out):
            latest = m.group(1)
        if latest:
            return latest
        time.sleep(0.5)
    raise AssertionError(f"OTP for {email}/{purpose} not found")


def _tiny_jpeg_b64() -> str:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (400, 240), color=(255, 255, 255)).save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth(api):
    email = _fresh_email()
    password = "pass1234"
    r = api.post(f"{BASE_URL}/auth/signup",
                 json={"name": "T", "email": email, "password": password})
    assert r.status_code == 200, r.text
    body = r.json()
    otp = body.get("dev_otp") or _fetch_otp(email, "signup")
    r = api.post(f"{BASE_URL}/auth/verify-otp", json={"email": email, "otp": otp})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    return {
        "email": email,
        "token": tok,
        "headers": {"Authorization": f"Bearer {tok}"},
    }


# ────────── OCR ──────────
class TestOCRNoTesseractError:
    def test_ocr_scan_returns_pincode_key(self, api, auth):
        r = api.post(
            f"{BASE_URL}/ocr/scan",
            json={"image_b64": _tiny_jpeg_b64()},
            headers=auth["headers"],
            timeout=90,
        )
        # Must NOT be 500. Blank image → either 200 (vision returns empty JSON)
        # or 422 (friendly OcrError). Never the old 'tesseract not installed' 500.
        assert r.status_code in (200, 422), f"expected 200/422 got {r.status_code}: {r.text}"
        if r.status_code == 200:
            data = r.json()
            for k in ("raw_text", "name", "email", "phone", "website", "pincode"):
                assert k in data, f"missing key {k}"
        else:
            # 422 must have a friendly message, not tesseract error
            detail = (r.json().get("detail") or "").lower()
            assert "tesseract" not in detail, f"tesseract error leaked: {detail}"


# ────────── CONTACTS: tag normalization ──────────
class TestTagNormalization:
    def test_tags_lowercased_and_deduped(self, api, auth):
        r = api.post(
            f"{BASE_URL}/contacts",
            json={
                "name": "TEST_TagCase",
                "email": f"tagcase_{uuid.uuid4().hex[:6]}@example.com",
                "tags": ["Client", "CLIENT", "client", "vip"],
            },
            headers=auth["headers"],
        )
        assert r.status_code == 200, r.text
        c = r.json()
        assert sorted(c["tags"]) == ["client", "vip"], f"got {c['tags']}"
        cid = c["id"]
        try:
            # Case-insensitive filter — uppercase param must hit lowercase-stored tag
            r = api.get(f"{BASE_URL}/contacts", params={"tag": "Client"},
                        headers=auth["headers"])
            assert r.status_code == 200
            ids = [x["id"] for x in r.json()["items"]]
            assert cid in ids, "case-insensitive tag filter did not match"

            # Update path also normalizes
            r = api.put(f"{BASE_URL}/contacts/{cid}",
                        json={"tags": ["VIP", "Partner", "partner"]},
                        headers=auth["headers"])
            assert r.status_code == 200
            assert sorted(r.json()["tags"]) == ["partner", "vip"]
        finally:
            api.delete(f"{BASE_URL}/contacts/{cid}", headers=auth["headers"])


# ────────── CONTACTS: pincode ──────────
class TestPincodeField:
    def test_pincode_persists_and_returns(self, api, auth):
        r = api.post(
            f"{BASE_URL}/contacts",
            json={
                "name": "TEST_Pin",
                "email": f"pin_{uuid.uuid4().hex[:6]}@example.com",
                "pincode": "400001",
                "city": "Mumbai",
                "country": "India",
            },
            headers=auth["headers"],
        )
        assert r.status_code == 200, r.text
        assert r.json()["pincode"] == "400001"
        cid = r.json()["id"]
        try:
            r = api.get(f"{BASE_URL}/contacts/{cid}", headers=auth["headers"])
            assert r.status_code == 200
            assert r.json()["pincode"] == "400001"

            r = api.get(f"{BASE_URL}/contacts", headers=auth["headers"])
            assert r.status_code == 200
            matched = [x for x in r.json()["items"] if x["id"] == cid]
            assert matched and matched[0]["pincode"] == "400001"
        finally:
            api.delete(f"{BASE_URL}/contacts/{cid}", headers=auth["headers"])


# ────────── FACETS ──────────
class TestFacets:
    def test_facets_returns_grouped_counts(self, api, auth):
        # seed a couple contacts
        ids = []
        try:
            for country, tag, ind in [("India", "Client", "SaaS"), ("USA", "Client", "SaaS"), ("India", "Lead", "Retail")]:
                r = api.post(f"{BASE_URL}/contacts",
                             json={"name": f"TEST_F_{uuid.uuid4().hex[:5]}",
                                   "email": f"f_{uuid.uuid4().hex[:6]}@example.com",
                                   "country": country, "industry": ind,
                                   "state": "Maharashtra", "city": "Pune",
                                   "tags": [tag]},
                             headers=auth["headers"])
                assert r.status_code == 200
                ids.append(r.json()["id"])

            r = api.get(f"{BASE_URL}/contacts/facets", headers=auth["headers"])
            assert r.status_code == 200, r.text
            data = r.json()
            for k in ("country", "state", "city", "industry", "tag"):
                assert k in data, f"missing facet {k}"
                assert isinstance(data[k], list)
                if data[k]:
                    assert "value" in data[k][0] and "count" in data[k][0]
            # tag facet must show lowercase 'client'
            tag_values = [t["value"] for t in data["tag"]]
            assert "client" in tag_values
        finally:
            for cid in ids:
                api.delete(f"{BASE_URL}/contacts/{cid}", headers=auth["headers"])


# ────────── AI EMAIL ──────────
class TestAiWriteEmail:
    def test_generate_returns_subject_and_body(self, api, auth):
        r = api.post(f"{BASE_URL}/ai/write-email",
                     json={"action": "generate",
                           "prompt": "Introduce our SaaS product for CRM",
                           "tone": "professional"},
                     headers=auth["headers"], timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "subject" in data and "body" in data
        assert isinstance(data["subject"], str) and data["subject"].strip()
        assert isinstance(data["body"], str) and len(data["body"].strip()) > 10

    def test_shorten_returns_subject_and_body(self, api, auth):
        long_body = ("Hi {name}, I wanted to reach out because I noticed your company "
                     "has been growing rapidly and we help companies just like yours "
                     "scale their CRM operations with ease using our platform. We have "
                     "worked with many similar companies and have delivered great results. "
                     "Would you be open to a quick call sometime this week to discuss?")
        r = api.post(f"{BASE_URL}/ai/write-email",
                     json={"action": "shorten",
                           "subject": "Grow your CRM",
                           "body": long_body},
                     headers=auth["headers"], timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("subject") and data.get("body")

    def test_unknown_action_400(self, api, auth):
        r = api.post(f"{BASE_URL}/ai/write-email",
                     json={"action": "delete_universe"},
                     headers=auth["headers"])
        assert r.status_code == 400


# ────────── CAMPAIGNS multi-select filters ──────────
class TestCampaignMultiFilter:
    def test_multi_filter_resolves_recipients(self, api, auth):
        ids = []
        try:
            # matches
            r = api.post(f"{BASE_URL}/contacts",
                         json={"name": "TEST_C1", "email": f"c1_{uuid.uuid4().hex[:5]}@example.com",
                               "country": "India", "state": "Karnataka", "city": "Bengaluru",
                               "industry": "SaaS", "tags": ["client"]},
                         headers=auth["headers"])
            assert r.status_code == 200
            ids.append(r.json()["id"])
            # different country → excluded
            r = api.post(f"{BASE_URL}/contacts",
                         json={"name": "TEST_C2", "email": f"c2_{uuid.uuid4().hex[:5]}@example.com",
                               "country": "USA", "state": "CA", "city": "SF",
                               "industry": "SaaS", "tags": ["client"]},
                         headers=auth["headers"])
            ids.append(r.json()["id"])
            # matches (India + SaaS + client)
            r = api.post(f"{BASE_URL}/contacts",
                         json={"name": "TEST_C3", "email": f"c3_{uuid.uuid4().hex[:5]}@example.com",
                               "country": "India", "state": "Maharashtra", "city": "Mumbai",
                               "industry": "SaaS", "tags": ["Client"]},
                         headers=auth["headers"])
            ids.append(r.json()["id"])

            r = api.post(f"{BASE_URL}/campaigns",
                         json={"name": "TEST_MF", "subject": "Hi", "body_html": "<p>x</p>",
                               "filter_countries": ["India"],
                               "filter_industries": ["SaaS"],
                               "filter_tags": ["client"]},
                         headers=auth["headers"])
            assert r.status_code == 200, r.text
            camp = r.json()
            # Should include the 2 India + SaaS contacts, exclude the USA one
            assert camp["recipient_count"] == 2, f"got {camp['recipient_count']} ids={camp.get('recipient_ids')}"
            assert ids[0] in camp["recipient_ids"]
            assert ids[2] in camp["recipient_ids"]
            assert ids[1] not in camp["recipient_ids"]
        finally:
            for cid in ids:
                api.delete(f"{BASE_URL}/contacts/{cid}", headers=auth["headers"])


# ────────── DUPLICATES ──────────
class TestDuplicatesEndpoint:
    def test_duplicates_by_email(self, api, auth):
        email = f"dup_it3_{uuid.uuid4().hex[:6]}@example.com"
        r1 = api.post(f"{BASE_URL}/contacts",
                      json={"name": "TEST_D1", "email": email, "company": "A"},
                      headers=auth["headers"])
        r2 = api.post(f"{BASE_URL}/contacts",
                      json={"name": "TEST_D2", "email": email, "company": "B"},
                      headers=auth["headers"])
        ids = [r1.json()["id"], r2.json()["id"]]
        try:
            r = api.get(f"{BASE_URL}/contacts/duplicates", headers=auth["headers"])
            assert r.status_code == 200
            groups = r.json().get("groups", [])
            found = any({ids[0], ids[1]}.issubset({c["id"] for c in g}) for g in groups)
            assert found
        finally:
            for cid in ids:
                api.delete(f"{BASE_URL}/contacts/{cid}", headers=auth["headers"])
