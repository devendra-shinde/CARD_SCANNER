"""CardVault iteration 6 tests — post-refactor regression + Excel perf + Google smoke.

Covers:
  * Regression across the modular routers (auth, contacts, ai, settings,
    templates, campaigns, analytics, billing, excel, whatsapp).
  * Excel import commit performance & correctness (email-dup, phone-suffix-dup,
    in-file dup, elapsed time).
  * Google Sign-In backend smoke (fake session_id → 401).
"""
from __future__ import annotations

import base64
import io
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "CARDVAULT_BASE_URL",
    "https://ocr-contacts-hub-1.preview.emergentagent.com/api",
).rstrip("/")

BASIC_EMAIL = "basictester@cardvault.dev"
FREE_EMAIL = "test2@cardvault.dev"
PRO_EMAIL = "p2@cardvault.dev"
SHARED_PASSWORD = "pass1234"


def _tiny_jpeg_b64() -> str:
    try:
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (60, 60), color=(255, 255, 255)).save(buf, format="JPEG")
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return (
            "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
            "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy"
            "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA"
            "AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA"
            "AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3"
            "ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm"
            "p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEB"
            "AAA/APn+iiigD//Z"
        )


def _login(session: requests.Session, email: str, password: str = SHARED_PASSWORD) -> dict:
    r = session.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def api() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def free_auth(api):
    data = _login(api, FREE_EMAIL)
    return {
        "token": data["access_token"],
        "user": data["user"],
        "headers": _auth_headers(data["access_token"]),
    }


@pytest.fixture(scope="session")
def basic_auth(api):
    data = _login(api, BASIC_EMAIL)
    headers = _auth_headers(data["access_token"])
    # login response doesn't include plan; verify via /billing/status
    r = api.get(f"{BASE_URL}/billing/status", headers=headers)
    assert r.status_code == 200, r.text
    plan = r.json().get("plan")
    assert plan in ("basic", "pro"), f"basictester expected basic/pro, got {plan}"
    return {"token": data["access_token"], "user": data["user"], "headers": headers}


# ────────── HEALTH ──────────
def test_root(api):
    r = api.get(f"{BASE_URL}/")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


# ────────── AUTH ──────────
class TestAuth:
    def test_login_ok(self, api, free_auth):
        assert free_auth["user"]["email"] == FREE_EMAIL

    def test_login_wrong_password(self, api):
        r = api.post(f"{BASE_URL}/auth/login", json={"email": FREE_EMAIL, "password": "nope-nope"})
        assert r.status_code == 401

    def test_me(self, api, free_auth):
        r = api.get(f"{BASE_URL}/auth/me", headers=free_auth["headers"])
        assert r.status_code == 200
        assert r.json()["email"] == FREE_EMAIL

    def test_me_no_token(self, api):
        r = api.get(f"{BASE_URL}/auth/me")
        assert r.status_code in (401, 403)

    def test_signup_returns_dev_otp(self, api):
        email = f"TEST_i6_{uuid.uuid4().hex[:8]}@cardvault.dev"
        r = api.post(f"{BASE_URL}/auth/signup",
                     json={"name": "T", "email": email, "password": SHARED_PASSWORD})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "dev_otp" in body, f"expected dev_otp in signup response, got {body}"
        otp = body["dev_otp"]
        r = api.post(f"{BASE_URL}/auth/verify-otp", json={"email": email, "otp": otp})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_resend_otp(self, api):
        email = f"TEST_i6_{uuid.uuid4().hex[:8]}@cardvault.dev"
        api.post(f"{BASE_URL}/auth/signup",
                 json={"name": "T", "email": email, "password": SHARED_PASSWORD})
        r = api.post(f"{BASE_URL}/auth/resend-otp", json={"email": email})
        assert r.status_code == 200, r.text
        # dev_otp may be echoed
        assert r.json().get("ok") is True or "dev_otp" in r.json()

    def test_forgot_and_reset(self, api):
        # use a throwaway account so we don't clobber the shared basictester password
        email = f"TEST_i6r_{uuid.uuid4().hex[:8]}@cardvault.dev"
        r = api.post(f"{BASE_URL}/auth/signup",
                     json={"name": "R", "email": email, "password": SHARED_PASSWORD})
        assert r.status_code == 200
        otp = r.json()["dev_otp"]
        api.post(f"{BASE_URL}/auth/verify-otp", json={"email": email, "otp": otp})

        r = api.post(f"{BASE_URL}/auth/forgot-password", json={"email": email})
        assert r.status_code == 200
        reset_otp = r.json().get("dev_otp")
        assert reset_otp, f"forgot-password did not include dev_otp: {r.json()}"
        r = api.post(f"{BASE_URL}/auth/reset-password",
                     json={"email": email, "otp": reset_otp, "new_password": "newpass9999"})
        assert r.status_code == 200
        r = api.post(f"{BASE_URL}/auth/login", json={"email": email, "password": "newpass9999"})
        assert r.status_code == 200

    def test_google_session_bogus_returns_401(self, api):
        r = api.post(f"{BASE_URL}/auth/google-session", json={"session_id": "fake-bogus-value-xyz"})
        # Expected: 401 "Session not recognised" from real network call, or 502 if provider unreachable
        assert r.status_code in (401, 502), f"expected 401/502 for bogus session_id, got {r.status_code}: {r.text}"


# ────────── CONTACTS (basic user for full CRUD) ──────────
class TestContacts:
    _cid: str = ""

    def test_create_then_get(self, api, basic_auth):
        payload = {
            "name": "TEST_i6_Alice", "email": f"alice_i6_{uuid.uuid4().hex[:6]}@example.com",
            "phone": "+1 555 111 2233", "company": "AcmeI6", "industry": "Software",
            "country": "USA", "tags": ["lead"], "favorite": True,
        }
        r = api.post(f"{BASE_URL}/contacts", json=payload, headers=basic_auth["headers"])
        assert r.status_code == 200, r.text
        c = r.json()
        TestContacts._cid = c["id"]
        assert c["favorite"] is True
        r2 = api.get(f"{BASE_URL}/contacts/{c['id']}", headers=basic_auth["headers"])
        assert r2.status_code == 200
        assert r2.json()["name"] == "TEST_i6_Alice"

    def test_list_and_facets(self, api, basic_auth):
        r = api.get(f"{BASE_URL}/contacts", params={"search": "TEST_i6"}, headers=basic_auth["headers"])
        assert r.status_code == 200
        assert isinstance(r.json().get("items"), list)

        r = api.get(f"{BASE_URL}/contacts/facets", headers=basic_auth["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        # Route returns per-field facet buckets keyed by singular field names
        for k in ("industry", "country", "tag"):
            assert k in body, f"facets missing key {k}, got keys={list(body.keys())}"

    def test_recipient_status_and_duplicates(self, api, basic_auth):
        r = api.get(f"{BASE_URL}/contacts/recipient-status", headers=basic_auth["headers"])
        assert r.status_code == 200, r.text

        r = api.get(f"{BASE_URL}/contacts/duplicates", headers=basic_auth["headers"])
        assert r.status_code == 200
        assert isinstance(r.json().get("groups"), list)

    def test_update_and_delete(self, api, basic_auth):
        cid = TestContacts._cid
        r = api.put(f"{BASE_URL}/contacts/{cid}", json={"designation": "CEO"}, headers=basic_auth["headers"])
        assert r.status_code == 200
        assert r.json()["designation"] == "CEO"
        r = api.delete(f"{BASE_URL}/contacts/{cid}", headers=basic_auth["headers"])
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/contacts/{cid}", headers=basic_auth["headers"])
        assert r.status_code == 404


# ────────── AI / OCR / ENRICH ──────────
class TestAI:
    def test_ocr_shape(self, api, free_auth):
        r = api.post(f"{BASE_URL}/ocr/scan",
                     json={"image_b64": _tiny_jpeg_b64()},
                     headers=free_auth["headers"], timeout=60)
        # Tiny blank JPEG: server may reject with 422 ("couldn't read card") — that's fine,
        # we just need to confirm it never crashes with 5xx and the shape is a JSON body.
        assert r.status_code in (200, 422), f"unexpected {r.status_code}: {r.text}"
        if r.status_code == 200:
            body = r.json()
            for k in ["raw_text", "name", "email", "phone", "confidence"]:
                assert k in body
        else:
            assert "detail" in r.json()

    def test_ai_write_email(self, api, free_auth):
        r = api.post(f"{BASE_URL}/ai/write-email",
                     json={"action": "generate", "prompt": "Say hi to Alice"},
                     headers=free_auth["headers"], timeout=60)
        # Emergent LLM key may be missing → 503 is acceptable
        assert r.status_code in (200, 402, 503), f"got {r.status_code}: {r.text}"

    def test_enrich_requires_input(self, api, free_auth):
        r = api.post(f"{BASE_URL}/enrich", json={}, headers=free_auth["headers"])
        assert r.status_code == 400


# ────────── EMAIL SETTINGS ──────────
class TestEmailSettings:
    def test_legacy_config_roundtrip(self, api, basic_auth):
        r = api.get(f"{BASE_URL}/settings/email", headers=basic_auth["headers"])
        assert r.status_code == 200
        cfg = {
            "provider": "custom", "smtp_host": "smtp.invalid.example.com", "smtp_port": 587,
            "smtp_user": "u@example.com", "smtp_pass": "bad", "from_name": "T", "use_tls": True,
        }
        r = api.post(f"{BASE_URL}/settings/email", json=cfg, headers=basic_auth["headers"])
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/settings/email", headers=basic_auth["headers"])
        assert r.status_code == 200
        got = r.json()
        assert got.get("smtp_host") == cfg["smtp_host"]
        assert "smtp_pass" not in got

    def test_legacy_smtp_test_returns_400_not_500(self, api, basic_auth):
        r = api.post(f"{BASE_URL}/settings/email/test",
                     json={"to": "receiver@example.com"},
                     headers=basic_auth["headers"], timeout=45)
        assert r.status_code == 400, f"want 400, got {r.status_code}: {r.text}"

    def test_multi_account_crud(self, api, basic_auth):
        payload = {
            "label": "TEST_i6_acct", "provider": "custom",
            "smtp_host": "smtp.invalid.example.com", "smtp_port": 587,
            "smtp_user": "u@example.com", "smtp_pass": "bad",
            "from_name": "T", "use_tls": True, "is_default": False,
        }
        r = api.post(f"{BASE_URL}/settings/emails", json=payload, headers=basic_auth["headers"])
        assert r.status_code == 200, r.text
        acct = r.json()
        aid = acct["id"]

        r = api.get(f"{BASE_URL}/settings/emails", headers=basic_auth["headers"])
        assert r.status_code == 200
        assert any(a["id"] == aid for a in r.json()["items"])

        r = api.post(f"{BASE_URL}/settings/emails/{aid}/default", headers=basic_auth["headers"])
        assert r.status_code == 200

        r = api.post(f"{BASE_URL}/settings/emails/{aid}/test",
                     json={"to": "receiver@example.com"},
                     headers=basic_auth["headers"], timeout=45)
        assert r.status_code == 400  # invalid SMTP

        r = api.delete(f"{BASE_URL}/settings/emails/{aid}", headers=basic_auth["headers"])
        assert r.status_code == 200


# ────────── TEMPLATES ──────────
class TestTemplates:
    def test_crud(self, api, basic_auth):
        r = api.post(f"{BASE_URL}/templates",
                     json={"name": "TEST_i6_tpl", "subject": "Hi {{name}}", "body_html": "<p>hi</p>"},
                     headers=basic_auth["headers"])
        assert r.status_code == 200
        tid = r.json()["id"]
        r = api.get(f"{BASE_URL}/templates", headers=basic_auth["headers"])
        assert r.status_code == 200
        assert any(t["id"] == tid for t in r.json()["items"])
        r = api.delete(f"{BASE_URL}/templates/{tid}", headers=basic_auth["headers"])
        assert r.status_code == 200


# ────────── CAMPAIGNS ──────────
class TestCampaigns:
    def test_create_list_get_send(self, api, basic_auth):
        r = api.post(f"{BASE_URL}/contacts",
                     json={"name": "TEST_i6_R", "email": f"r_{uuid.uuid4().hex[:6]}@example.com"},
                     headers=basic_auth["headers"])
        assert r.status_code == 200
        contact_id = r.json()["id"]

        r = api.post(f"{BASE_URL}/campaigns",
                     json={"name": "TEST_i6_Camp", "subject": "Hi",
                           "body_html": "<p>x</p>", "recipient_ids": [contact_id]},
                     headers=basic_auth["headers"])
        assert r.status_code == 200
        camp = r.json()
        cid = camp["id"]
        assert camp["recipient_count"] == 1

        r = api.get(f"{BASE_URL}/campaigns", headers=basic_auth["headers"])
        assert r.status_code == 200
        assert any(c["id"] == cid for c in r.json()["items"])

        r = api.get(f"{BASE_URL}/campaigns/{cid}", headers=basic_auth["headers"])
        assert r.status_code == 200

        r = api.post(f"{BASE_URL}/campaigns/{cid}/send",
                     headers=basic_auth["headers"], timeout=60)
        assert r.status_code in (200, 400), f"got {r.status_code}: {r.text}"

        api.delete(f"{BASE_URL}/contacts/{contact_id}", headers=basic_auth["headers"])


# ────────── ANALYTICS ──────────
class TestAnalytics:
    def test_shape(self, api, free_auth):
        r = api.get(f"{BASE_URL}/analytics", headers=free_auth["headers"])
        assert r.status_code == 200
        data = r.json()
        for k in ["contacts_total", "scans_this_month", "campaigns_total",
                  "emails_sent", "industries", "countries", "growth"]:
            assert k in data


# ────────── BILLING ──────────
class TestBilling:
    def test_status(self, api, free_auth):
        r = api.get(f"{BASE_URL}/billing/status", headers=free_auth["headers"])
        assert r.status_code == 200
        assert "plan" in r.json()

    def test_checkout_returns_503(self, api, free_auth):
        r = api.post(f"{BASE_URL}/billing/checkout",
                     json={"plan": "basic", "cycle": "monthly"},
                     headers=free_auth["headers"])
        # EXPECTED: 503 when RAZORPAY_KEY_ID is not configured
        assert r.status_code == 503, f"want 503, got {r.status_code}: {r.text}"

    def test_history(self, api, free_auth):
        r = api.get(f"{BASE_URL}/billing/history", headers=free_auth["headers"])
        assert r.status_code == 200
        assert "items" in r.json()


# ────────── EXCEL: perf + correctness ──────────
class TestExcelImport:
    """Seed contacts, upload a workbook, check counters and elapsed time."""

    def _wipe_test_contacts(self, api, headers):
        """Remove any TEST_i6ex_* contacts left over from previous runs."""
        r = api.get(f"{BASE_URL}/contacts",
                    params={"search": "TEST_i6ex"},
                    headers=headers)
        if r.status_code == 200:
            for c in r.json().get("items", []):
                api.delete(f"{BASE_URL}/contacts/{c['id']}", headers=headers)

    def _seed_existing(self, api, headers, count: int = 15):
        """Create existing contacts we'll try to dedupe against."""
        existing_emails, existing_phones = [], []
        for i in range(count):
            em = f"seed_i6ex_{i}_{uuid.uuid4().hex[:4]}@example.com"
            ph = f"+91 98765{i:05d}"
            r = api.post(f"{BASE_URL}/contacts",
                         json={"name": f"TEST_i6ex_seed_{i}", "email": em, "phone": ph},
                         headers=headers)
            assert r.status_code == 200, r.text
            existing_emails.append(em)
            existing_phones.append(ph)
        return existing_emails, existing_phones

    def _build_workbook(self, existing_emails, existing_phones,
                        new_rows: int, email_dups: int, phone_dups: int, in_file_dups: int):
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Contacts"
        # Header (must exactly match /excel_utils.COLUMNS labels)
        headers = ["Name", "Designation", "Company", "Email", "Phone", "Website",
                   "Address", "City", "State", "Country", "Pincode", "Industry",
                   "Tags", "Notes", "LinkedIn", "Company Size"]
        ws.append(headers)
        row_specs = []
        # 1. Purely new rows
        for i in range(new_rows):
            row_specs.append((
                f"TEST_i6ex_new_{i}",
                f"new_i6ex_{i}_{uuid.uuid4().hex[:4]}@example.com",
                f"+91 77777{i:05d}",
            ))
        # 2. Rows duplicating an existing email
        for i in range(email_dups):
            row_specs.append((
                f"TEST_i6ex_edup_{i}",
                existing_emails[i],
                f"+91 66666{i:05d}",   # different phone
            ))
        # 3. Rows duplicating existing phone (last-10-digit suffix match) but different email
        for i in range(phone_dups):
            row_specs.append((
                f"TEST_i6ex_pdup_{i}",
                f"pdup_i6ex_{i}_{uuid.uuid4().hex[:4]}@example.com",
                existing_phones[i],   # will match by last-10-digits
            ))
        # 4. In-file duplicates: same email as an earlier NEW row in this file
        for i in range(in_file_dups):
            base_new = row_specs[i]  # earlier new row
            row_specs.append((
                f"TEST_i6ex_infile_{i}",
                base_new[1],  # SAME email as an earlier new row → should be treated as update
                f"+91 55555{i:05d}",
            ))
        # Write rows
        for (name, email, phone) in row_specs:
            ws.append([name, "", "TestCoI6", email, phone, "", "", "", "", "", "", "", "", "", "", ""])

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue(), row_specs

    def test_import_commit_correctness_and_perf(self, api, basic_auth):
        headers = basic_auth["headers"]
        self._wipe_test_contacts(api, headers)

        SEED_N = 15
        NEW_ROWS = 20
        EMAIL_DUPS = 6
        PHONE_DUPS = 6
        IN_FILE_DUPS = 4
        TOTAL_ROWS = NEW_ROWS + EMAIL_DUPS + PHONE_DUPS + IN_FILE_DUPS

        existing_emails, existing_phones = self._seed_existing(api, headers, SEED_N)

        wb_bytes, row_specs = self._build_workbook(
            existing_emails, existing_phones,
            NEW_ROWS, EMAIL_DUPS, PHONE_DUPS, IN_FILE_DUPS,
        )
        content_b64 = base64.b64encode(wb_bytes).decode("ascii")

        # ── PREVIEW
        r = api.post(f"{BASE_URL}/contacts/import/preview",
                     json={"content_b64": content_b64},
                     headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        prev = r.json()
        assert prev["total"] == TOTAL_ROWS, f"preview total mismatch: got {prev['total']}"
        # `new` counts rows that don't dup existing DB rows.
        # In-file dups will be flagged as new in PREVIEW (existing-set only knows DB rows).
        assert prev["updated"] >= EMAIL_DUPS + PHONE_DUPS, \
            f"preview updated={prev['updated']} < {EMAIL_DUPS + PHONE_DUPS}"

        # ── COMMIT + perf timing
        t0 = time.time()
        r = api.post(f"{BASE_URL}/contacts/import/commit",
                     json={"content_b64": content_b64, "duplicate_strategy": "merge"},
                     headers=headers, timeout=60)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        res = r.json()

        # Correctness: imported should be the # of PURELY new rows (in-file dups should NOT double-insert).
        assert res["total"] == TOTAL_ROWS
        assert res["imported"] == NEW_ROWS, (
            f"imported={res['imported']} != expected {NEW_ROWS} — "
            f"in-file dedup regressed? full={res}"
        )
        assert res["updated"] == EMAIL_DUPS + PHONE_DUPS + IN_FILE_DUPS, (
            f"updated={res['updated']} != expected {EMAIL_DUPS + PHONE_DUPS + IN_FILE_DUPS} — full={res}"
        )
        assert res["failed"] == 0, f"unexpected failures: {res}"

        # Perf: << 5s. Allow up to 5s round-trip since preview API isn't tested there.
        assert elapsed < 5.0, f"import commit took {elapsed:.2f}s (expected < 5s)"

        # ── Verify persistence via /contacts
        r = api.get(f"{BASE_URL}/contacts",
                    params={"search": "TEST_i6ex_new", "limit": 200},
                    headers=headers)
        assert r.status_code == 200
        got_new = [c for c in r.json()["items"] if c["name"].startswith("TEST_i6ex_new_")]
        assert len(got_new) == NEW_ROWS, f"expected {NEW_ROWS} new contacts, got {len(got_new)}"

        # cleanup
        self._wipe_test_contacts(api, headers)

    def test_import_template_download(self, api, basic_auth):
        r = api.get(f"{BASE_URL}/contacts/import/template", headers=basic_auth["headers"])
        assert r.status_code == 200
        b = r.json()
        assert "content_b64" in b and len(b["content_b64"]) > 100

    def test_export_contacts(self, api, basic_auth):
        r = api.post(f"{BASE_URL}/contacts/export", json={}, headers=basic_auth["headers"])
        assert r.status_code == 200
        b = r.json()
        assert "content_b64" in b and b["mime_type"].endswith("spreadsheetml.sheet")

    def test_excel_import_blocked_for_free(self, api, free_auth):
        r = api.post(f"{BASE_URL}/contacts/import/preview",
                     json={"content_b64": base64.b64encode(b"nope").decode()},
                     headers=free_auth["headers"])
        assert r.status_code == 402


# ────────── WHATSAPP ──────────
class TestWhatsApp:
    def test_list_templates_free(self, api, free_auth):
        r = api.get(f"{BASE_URL}/whatsapp/templates", headers=free_auth["headers"])
        assert r.status_code == 200
        assert isinstance(r.json().get("items"), list)

    def test_create_template_free_402(self, api, free_auth):
        r = api.post(f"{BASE_URL}/whatsapp/templates",
                     json={"name": "TEST_wa", "body": "hi {{name}}"},
                     headers=free_auth["headers"])
        assert r.status_code == 402

    def test_generate_links_free_402(self, api, free_auth):
        r = api.post(f"{BASE_URL}/whatsapp/generate-links",
                     json={"body": "hi", "contact_ids": []},
                     headers=free_auth["headers"])
        assert r.status_code == 402
