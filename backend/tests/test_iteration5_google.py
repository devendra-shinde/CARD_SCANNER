"""Iteration 5 — Google Sign-In (Emergent-managed) + regression."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://ocr-contacts-hub-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ────────── Google Session (new endpoint) ──────────
class TestGoogleSession:
    def test_missing_body_returns_422(self, sess):
        r = sess.post(f"{API}/auth/google-session", data="")
        assert r.status_code == 422, r.text

    def test_missing_field_returns_422(self, sess):
        r = sess.post(f"{API}/auth/google-session", json={})
        assert r.status_code == 422, r.text

    def test_bogus_session_returns_401(self, sess):
        r = sess.post(f"{API}/auth/google-session", json={"session_id": "BOGUS"})
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"
        body = r.json()
        assert "Session not recognised" in str(body.get("detail", "")), body

    def test_empty_session_id_returns_401(self, sess):
        r = sess.post(f"{API}/auth/google-session", json={"session_id": ""})
        # Empty string still hits Emergent (returns 401/400/404) — should not be 500.
        assert r.status_code in (400, 401, 422), r.text
        assert r.status_code != 500


# ────────── Auth regression ──────────
class TestAuthRegression:
    def test_login_free_user(self, sess):
        r = sess.post(f"{API}/auth/login", json={
            "email": "test2@cardvault.dev", "password": "pass1234"
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data and data["user"]["email"] == "test2@cardvault.dev"
        pytest.free_token = data["access_token"]

    def test_me_returns_user(self, sess):
        tok = pytest.free_token
        r = sess.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        assert r.json()["email"] == "test2@cardvault.dev"

    def test_signup_returns_dev_otp(self, sess):
        email = f"TEST_g_{uuid.uuid4().hex[:8]}@cardvault.dev"
        r = sess.post(f"{API}/auth/signup", json={
            "name": "TG", "email": email, "password": "pass1234",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert "dev_otp" in body and len(body["dev_otp"]) == 6
        pytest.new_email = email
        pytest.new_otp = body["dev_otp"]

    def test_verify_otp_issues_token(self, sess):
        r = sess.post(f"{API}/auth/verify-otp", json={
            "email": pytest.new_email, "otp": pytest.new_otp,
        })
        assert r.status_code == 200, r.text
        assert "access_token" in r.json()

    def test_login_bad_password(self, sess):
        r = sess.post(f"{API}/auth/login", json={
            "email": "test2@cardvault.dev", "password": "wrong"
        })
        assert r.status_code == 401


# ────────── Contacts + Analytics regression ──────────
class TestContactsAnalytics:
    @classmethod
    def _tok(cls, sess):
        r = sess.post(f"{API}/auth/login", json={
            "email": "test2@cardvault.dev", "password": "pass1234"
        })
        return r.json()["access_token"]

    def test_contacts_crud(self, sess):
        tok = self._tok(sess)
        h = {"Authorization": f"Bearer {tok}"}
        # Create
        payload = {"name": "TEST_gauth Jane", "email": f"TEST_g_{uuid.uuid4().hex[:6]}@x.co", "company": "Acme"}
        r = sess.post(f"{API}/contacts", json=payload, headers=h)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        # Get
        r = sess.get(f"{API}/contacts/{cid}", headers=h)
        assert r.status_code == 200 and r.json()["name"] == "TEST_gauth Jane"
        # Update
        r = sess.put(f"{API}/contacts/{cid}", json={"designation": "CEO"}, headers=h)
        assert r.status_code == 200 and r.json()["designation"] == "CEO"
        # List
        r = sess.get(f"{API}/contacts", headers=h)
        assert r.status_code == 200 and any(c["id"] == cid for c in r.json()["items"])
        # Delete
        r = sess.delete(f"{API}/contacts/{cid}", headers=h)
        assert r.status_code == 200
        r = sess.get(f"{API}/contacts/{cid}", headers=h)
        assert r.status_code == 404

    def test_analytics(self, sess):
        tok = self._tok(sess)
        r = sess.get(f"{API}/analytics", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        d = r.json()
        for k in ("contacts_total", "scans_this_month", "campaigns_total", "emails_sent", "industries", "countries", "growth"):
            assert k in d, f"missing {k}"
