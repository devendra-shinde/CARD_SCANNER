"""CardVault backend integration tests (pytest).

Covers: auth (signup, OTP via log, verify, login, forgot/reset, me), contacts CRUD +
filters + duplicates + merge, OCR scan, enrich, email settings + SMTP test error,
templates, campaigns (create + send with no SMTP), analytics.
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

BASE_URL = "https://ocr-contacts-hub-1.preview.emergentagent.com/api"
BACKEND_LOG = "/var/log/supervisor/backend.err.log"


# ────────── helpers ──────────
def _fresh_email() -> str:
    return f"TEST_{uuid.uuid4().hex[:10]}@cardvault.dev"


def _fetch_otp(email: str, purpose: str = "signup", timeout_s: int = 6) -> str:
    """Grep OTP from backend stderr log."""
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
    raise AssertionError(f"OTP for {email}/{purpose} not found in {BACKEND_LOG}")


def _tiny_jpeg_b64() -> str:
    """1x1 white JPEG (valid enough for PIL/tesseract to run)."""
    try:
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (200, 100), color=(255, 255, 255)).save(buf, format="JPEG")
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        # Fallback constant 1x1 JPEG
        return (
            "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
            "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy"
            "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA"
            "AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA"
            "AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3"
            "ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm"
            "p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEB"
            "AAA/APn+iiigD//Z"
        )


# ────────── fixtures ──────────
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth(api):
    """Signup a fresh test user, verify OTP, return {token, user, email, password}."""
    email = _fresh_email()
    password = "pass1234"
    r = api.post(
        f"{BASE_URL}/auth/signup",
        json={"name": "T User", "email": email, "password": password, "organization": "T"},
    )
    assert r.status_code == 200, r.text
    otp = _fetch_otp(email, "signup")
    r = api.post(f"{BASE_URL}/auth/verify-otp", json={"email": email, "otp": otp})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data and "user" in data
    return {
        "token": data["access_token"],
        "user": data["user"],
        "email": email,
        "password": password,
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
    }


# ────────── health ──────────
def test_health(api):
    r = api.get(f"{BASE_URL}/")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


# ────────── auth ──────────
class TestAuth:
    def test_login_after_verification(self, api, auth):
        r = api.post(f"{BASE_URL}/auth/login", json={"email": auth["email"], "password": auth["password"]})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["email"] == auth["email"].lower()

    def test_login_wrong_password(self, api, auth):
        r = api.post(f"{BASE_URL}/auth/login", json={"email": auth["email"], "password": "wrong-pass"})
        assert r.status_code == 401

    def test_me_with_token(self, api, auth):
        r = api.get(f"{BASE_URL}/auth/me", headers=auth["headers"])
        assert r.status_code == 200
        assert r.json()["email"] == auth["email"].lower()

    def test_me_without_token(self, api):
        r = api.get(f"{BASE_URL}/auth/me")
        assert r.status_code in (401, 403)

    def test_forgot_and_reset_password(self, api, auth):
        r = api.post(f"{BASE_URL}/auth/forgot-password", json={"email": auth["email"]})
        assert r.status_code == 200
        otp = _fetch_otp(auth["email"], "reset")
        new_pw = "newpass1234"
        r = api.post(
            f"{BASE_URL}/auth/reset-password",
            json={"email": auth["email"], "otp": otp, "new_password": new_pw},
        )
        assert r.status_code == 200
        # Login with new password
        r = api.post(f"{BASE_URL}/auth/login", json={"email": auth["email"], "password": new_pw})
        assert r.status_code == 200
        # restore original password so other tests are unaffected
        r = api.post(f"{BASE_URL}/auth/forgot-password", json={"email": auth["email"]})
        otp = _fetch_otp(auth["email"], "reset")
        r = api.post(
            f"{BASE_URL}/auth/reset-password",
            json={"email": auth["email"], "otp": otp, "new_password": auth["password"]},
        )
        assert r.status_code == 200


# ────────── contacts ──────────
class TestContacts:
    def test_create_get_update_delete(self, api, auth):
        payload = {
            "name": "TEST_Alice",
            "email": "alice_test@example.com",
            "phone": "+1 555 111 2222",
            "company": "Acme",
            "industry": "Software",
            "country": "USA",
            "tags": ["lead"],
            "favorite": True,
        }
        r = api.post(f"{BASE_URL}/contacts", json=payload, headers=auth["headers"])
        assert r.status_code == 200, r.text
        c = r.json()
        cid = c["id"]
        assert c["email"] == payload["email"]
        assert c["favorite"] is True

        # GET verifies persistence
        r = api.get(f"{BASE_URL}/contacts/{cid}", headers=auth["headers"])
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Alice"

        # UPDATE
        r = api.put(
            f"{BASE_URL}/contacts/{cid}",
            json={"designation": "CEO", "favorite": False},
            headers=auth["headers"],
        )
        assert r.status_code == 200
        assert r.json()["designation"] == "CEO"
        assert r.json()["favorite"] is False

        # LIST with search
        r = api.get(f"{BASE_URL}/contacts", params={"search": "Alice"}, headers=auth["headers"])
        assert r.status_code == 200
        body = r.json()
        assert body["count"] >= 1
        ids = [c["id"] for c in body["items"]]
        assert cid in ids

        # LIST with tag filter
        r = api.get(f"{BASE_URL}/contacts", params={"tag": "lead"}, headers=auth["headers"])
        assert r.status_code == 200
        assert any(c["id"] == cid for c in r.json()["items"])

        # LIST with industry filter + sort=name
        r = api.get(
            f"{BASE_URL}/contacts",
            params={"industry": "Software", "sort": "name"},
            headers=auth["headers"],
        )
        assert r.status_code == 200

        # DELETE
        r = api.delete(f"{BASE_URL}/contacts/{cid}", headers=auth["headers"])
        assert r.status_code == 200
        r = api.get(f"{BASE_URL}/contacts/{cid}", headers=auth["headers"])
        assert r.status_code == 404

    def test_duplicates_and_merge(self, api, auth):
        # Create two contacts with same email
        base = {"email": "dup_test@example.com", "phone": "+1-555-999-0000"}
        r1 = api.post(
            f"{BASE_URL}/contacts",
            json={**base, "name": "TEST_Dup A", "company": "Alpha"},
            headers=auth["headers"],
        )
        r2 = api.post(
            f"{BASE_URL}/contacts",
            json={**base, "name": "TEST_Dup B", "designation": "Manager"},
            headers=auth["headers"],
        )
        assert r1.status_code == 200 and r2.status_code == 200
        id_a = r1.json()["id"]
        id_b = r2.json()["id"]

        # Duplicates should surface
        r = api.get(f"{BASE_URL}/contacts/duplicates", headers=auth["headers"])
        assert r.status_code == 200, r.text
        groups = r.json().get("groups", [])
        found = any({id_a, id_b}.issubset({c["id"] for c in g}) for g in groups)
        assert found, "duplicates endpoint did not return the pair"

        # Merge B into A
        r = api.post(
            f"{BASE_URL}/contacts/merge",
            json={"primary_id": id_a, "duplicate_ids": [id_b]},
            headers=auth["headers"],
        )
        assert r.status_code == 200, r.text
        merged = r.json()
        assert merged["id"] == id_a
        # B's designation merged into A
        assert merged.get("designation") == "Manager"

        # B is deleted
        r = api.get(f"{BASE_URL}/contacts/{id_b}", headers=auth["headers"])
        assert r.status_code == 404

        # cleanup
        api.delete(f"{BASE_URL}/contacts/{id_a}", headers=auth["headers"])


# ────────── OCR ──────────
class TestOCR:
    def test_scan_returns_expected_keys(self, api, auth):
        r = api.post(
            f"{BASE_URL}/ocr/scan",
            json={"image_b64": _tiny_jpeg_b64()},
            headers=auth["headers"],
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for k in [
            "raw_text", "name", "email", "phone", "website", "address",
            "city", "state", "country", "pincode", "industry",
            "all_emails", "all_phones", "all_websites", "confidence",
        ]:
            assert k in data, f"missing key {k}"


# ────────── ENRICH ──────────
class TestEnrich:
    def test_enrich_stripe(self, api, auth):
        r = api.post(
            f"{BASE_URL}/enrich",
            json={"website": "https://stripe.com"},
            headers=auth["headers"],
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "description" in data
        assert "industry_guess" in data
        assert "socials" in data

    def test_enrich_requires_input(self, api, auth):
        r = api.post(f"{BASE_URL}/enrich", json={}, headers=auth["headers"])
        assert r.status_code == 400


# ────────── EMAIL SETTINGS ──────────
class TestEmailSettings:
    def test_get_empty_then_post_then_test_smtp_invalid(self, api, auth):
        r = api.get(f"{BASE_URL}/settings/email", headers=auth["headers"])
        assert r.status_code == 200

        cfg = {
            "provider": "custom",
            "smtp_host": "smtp.invalid.example.com",
            "smtp_port": 587,
            "smtp_user": "user@example.com",
            "smtp_pass": "bad-pass",
            "from_name": "Test",
            "use_tls": True,
        }
        r = api.post(f"{BASE_URL}/settings/email", json=cfg, headers=auth["headers"])
        assert r.status_code == 200

        r = api.get(f"{BASE_URL}/settings/email", headers=auth["headers"])
        assert r.status_code == 200
        got = r.json()
        assert got.get("smtp_host") == cfg["smtp_host"]
        assert "smtp_pass" not in got  # secret is redacted

        # Test SMTP with invalid creds — must be 400 not 500
        r = api.post(
            f"{BASE_URL}/settings/email/test",
            json={"to": "receiver@example.com"},
            headers=auth["headers"],
            timeout=45,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


# ────────── TEMPLATES ──────────
class TestTemplates:
    def test_create_list_delete(self, api, auth):
        r = api.post(
            f"{BASE_URL}/templates",
            json={"name": "TEST_Welcome", "subject": "Hi {{name}}", "body_html": "<p>Hello</p>"},
            headers=auth["headers"],
        )
        assert r.status_code == 200
        tid = r.json()["id"]

        r = api.get(f"{BASE_URL}/templates", headers=auth["headers"])
        assert r.status_code == 200
        assert any(t["id"] == tid for t in r.json()["items"])

        r = api.delete(f"{BASE_URL}/templates/{tid}", headers=auth["headers"])
        assert r.status_code == 200

        r = api.delete(f"{BASE_URL}/templates/{tid}", headers=auth["headers"])
        assert r.status_code == 404


# ────────── CAMPAIGNS ──────────
class TestCampaigns:
    def test_create_list_get_send_no_smtp(self, api, auth):
        # Create a contact so campaigns have a recipient
        r = api.post(
            f"{BASE_URL}/contacts",
            json={"name": "TEST_Recipient", "email": "recv_test@example.com"},
            headers=auth["headers"],
        )
        assert r.status_code == 200
        contact_id = r.json()["id"]

        # Create draft campaign
        r = api.post(
            f"{BASE_URL}/campaigns",
            json={
                "name": "TEST_Camp",
                "subject": "Hello",
                "body_html": "<p>Hi</p>",
                "recipient_ids": [contact_id],
            },
            headers=auth["headers"],
        )
        assert r.status_code == 200, r.text
        camp = r.json()
        cid = camp["id"]
        assert camp["recipient_count"] == 1
        assert camp["status"] == "draft"

        # List
        r = api.get(f"{BASE_URL}/campaigns", headers=auth["headers"])
        assert r.status_code == 200
        assert any(c["id"] == cid for c in r.json()["items"])

        # Get detail
        r = api.get(f"{BASE_URL}/campaigns/{cid}", headers=auth["headers"])
        assert r.status_code == 200
        assert r.json()["id"] == cid

        # Send — with invalid SMTP saved (from prior test) will actually try to send
        # and fail with 400 (or might succeed depending). We accept 200 or 400 but NOT 500.
        r = api.post(f"{BASE_URL}/campaigns/{cid}/send", headers=auth["headers"], timeout=60)
        assert r.status_code in (200, 400), f"got {r.status_code}: {r.text}"

        # cleanup contact
        api.delete(f"{BASE_URL}/contacts/{contact_id}", headers=auth["headers"])

    def test_send_no_smtp_config(self, api):
        """Fresh user with NO smtp config → send returns 400."""
        email = _fresh_email()
        password = "pass1234"
        r = api.post(
            f"{BASE_URL}/auth/signup",
            json={"name": "NoSmtp", "email": email, "password": password},
        )
        assert r.status_code == 200
        otp = _fetch_otp(email, "signup")
        r = api.post(f"{BASE_URL}/auth/verify-otp", json={"email": email, "otp": otp})
        assert r.status_code == 200
        token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        # create contact
        r = api.post(
            f"{BASE_URL}/contacts",
            json={"name": "TEST_R", "email": "r_test@example.com"},
            headers=h,
        )
        assert r.status_code == 200
        r = api.post(
            f"{BASE_URL}/campaigns",
            json={
                "name": "TEST_NoSmtp",
                "subject": "S",
                "body_html": "<p>x</p>",
                "recipient_ids": [r.json()["id"]],
            },
            headers=h,
        )
        assert r.status_code == 200
        cid = r.json()["id"]
        r = api.post(f"{BASE_URL}/campaigns/{cid}/send", headers=h)
        assert r.status_code == 400, r.text


# ────────── ANALYTICS ──────────
class TestAnalytics:
    def test_analytics_shape(self, api, auth):
        r = api.get(f"{BASE_URL}/analytics", headers=auth["headers"])
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["contacts_total", "scans_this_month", "campaigns_total",
                  "emails_sent", "industries", "countries", "growth"]:
            assert k in data
        assert isinstance(data["industries"], list)
        assert isinstance(data["countries"], list)
        assert isinstance(data["growth"], list)
