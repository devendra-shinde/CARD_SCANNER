# Tests for the OTP-delivery bug fix: when SYSTEM_SMTP_HOST is empty in backend .env,
# signup/resend-otp/forgot-password responses MUST include `dev_otp`, and login for an
# unverified user must return 403 with detail.dev_otp populated.

import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("EXPO_BACKEND_URL must be set")
API = f"{BASE_URL}/api"


def _rand_email() -> str:
    return f"bug_{uuid.uuid4().hex[:10]}@cardvault.dev"


@pytest.fixture(scope="module")
def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestDevOtpSignupFlow:
    """Bug verify: signup returns dev_otp when SMTP not configured, and it verifies."""

    def test_signup_returns_dev_otp_and_verifies(self, session):
        email = _rand_email()
        r = session.post(f"{API}/auth/signup", json={
            "name": "Bug Tester",
            "email": email,
            "password": "pass1234",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("email") == email.lower()
        assert "dev_otp" in body, f"dev_otp missing in signup response: {body}"
        otp = body["dev_otp"]
        assert isinstance(otp, str) and len(otp) == 6 and otp.isdigit()

        # verify-otp with returned dev_otp — must succeed and return an access_token
        vr = session.post(f"{API}/auth/verify-otp", json={"email": email, "otp": otp})
        assert vr.status_code == 200, vr.text
        vbody = vr.json()
        assert "access_token" in vbody and vbody["token_type"] == "bearer"
        assert vbody["user"]["email"] == email.lower()
        assert vbody["user"]["email_verified"] is True

    def test_resend_otp_returns_dev_otp_and_invalidates_old(self, session):
        # signup a fresh (unverified) user
        email = _rand_email()
        r = session.post(f"{API}/auth/signup", json={
            "name": "Resend Tester", "email": email, "password": "pass1234"
        })
        assert r.status_code == 200
        first_otp = r.json()["dev_otp"]

        # resend-otp
        rr = session.post(f"{API}/auth/resend-otp", json={"email": email})
        assert rr.status_code == 200, rr.text
        rbody = rr.json()
        assert "dev_otp" in rbody, f"dev_otp missing in resend response: {rbody}"
        new_otp = rbody["dev_otp"]
        assert new_otp != first_otp, "resend must issue a new OTP"

        # old OTP must no longer be valid
        old_v = session.post(f"{API}/auth/verify-otp", json={"email": email, "otp": first_otp})
        assert old_v.status_code == 400, f"expected old OTP to be invalid, got {old_v.status_code}"

        # new OTP verifies
        new_v = session.post(f"{API}/auth/verify-otp", json={"email": email, "otp": new_otp})
        assert new_v.status_code == 200, new_v.text
        assert "access_token" in new_v.json()


class TestForgotPassword:
    """Bug verify: forgot-password returns dev_otp; reset-password with it succeeds."""

    def test_forgot_password_returns_dev_otp_and_resets(self, session):
        # Create + verify a fresh user first
        email = _rand_email()
        old_password = "pass1234"
        new_password = "newpass9876"
        r = session.post(f"{API}/auth/signup", json={
            "name": "Forgot Tester", "email": email, "password": old_password
        })
        assert r.status_code == 200
        signup_otp = r.json()["dev_otp"]
        vr = session.post(f"{API}/auth/verify-otp", json={"email": email, "otp": signup_otp})
        assert vr.status_code == 200

        # forgot-password
        fr = session.post(f"{API}/auth/forgot-password", json={"email": email})
        assert fr.status_code == 200, fr.text
        fbody = fr.json()
        assert "dev_otp" in fbody, f"dev_otp missing in forgot-password response: {fbody}"
        reset_otp = fbody["dev_otp"]
        assert len(reset_otp) == 6 and reset_otp.isdigit()

        # reset-password with returned code
        pr = session.post(f"{API}/auth/reset-password", json={
            "email": email, "otp": reset_otp, "new_password": new_password
        })
        assert pr.status_code == 200, pr.text

        # login with new password succeeds
        lr = session.post(f"{API}/auth/login", json={"email": email, "password": new_password})
        assert lr.status_code == 200
        assert "access_token" in lr.json()

        # login with old password fails
        lr2 = session.post(f"{API}/auth/login", json={"email": email, "password": old_password})
        assert lr2.status_code == 401


class TestLogin403DevOtp:
    """Bug verify: login for unverified user returns 403 with detail.dev_otp."""

    def test_login_unverified_returns_403_with_dev_otp(self, session):
        email = _rand_email()
        password = "pass1234"
        r = session.post(f"{API}/auth/signup", json={
            "name": "Unverified", "email": email, "password": password
        })
        assert r.status_code == 200
        # do NOT verify — attempt login
        lr = session.post(f"{API}/auth/login", json={"email": email, "password": password})
        assert lr.status_code == 403, lr.text
        body = lr.json()
        # FastAPI wraps HTTPException.detail under "detail"
        detail = body.get("detail")
        assert isinstance(detail, dict), f"expected dict detail, got: {detail!r}"
        assert "dev_otp" in detail, f"dev_otp missing in 403 detail: {detail}"
        dev_otp = detail["dev_otp"]
        assert isinstance(dev_otp, str) and len(dev_otp) == 6 and dev_otp.isdigit()
        assert "message" in detail

        # The dev_otp from 403 should be the current valid one — verify it works
        vr = session.post(f"{API}/auth/verify-otp", json={"email": email, "otp": dev_otp})
        assert vr.status_code == 200, vr.text


class TestRegressionNoAuth:
    """Quick regression: root health + analytics-style unauth check still work."""

    def test_root_ok(self, session):
        r = session.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_protected_endpoint_requires_auth(self, session):
        # /contacts should reject anonymous requests
        r = session.get(f"{API}/contacts")
        assert r.status_code in (401, 403)


class TestRegressionAuthedFlow:
    """Regression: contacts CRUD + analytics still work end-to-end for a fresh user."""

    @pytest.fixture(scope="class")
    def auth(self, session):
        email = _rand_email()
        r = session.post(f"{API}/auth/signup", json={
            "name": "Regression", "email": email, "password": "pass1234"
        })
        assert r.status_code == 200
        otp = r.json()["dev_otp"]
        vr = session.post(f"{API}/auth/verify-otp", json={"email": email, "otp": otp})
        assert vr.status_code == 200
        token = vr.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    def test_create_and_get_contact(self, session, auth):
        payload = {
            "name": "TEST_Regression Contact",
            "email": "test_regression_contact@example.com",
            "phone": "+15551234567",
            "company": "TEST_Co",
            "title": "Engineer",
            "notes": "regression",
        }
        cr = session.post(f"{API}/contacts", json=payload, headers=auth)
        assert cr.status_code in (200, 201), cr.text
        cid = cr.json().get("id")
        assert cid

        gr = session.get(f"{API}/contacts/{cid}", headers=auth)
        assert gr.status_code == 200
        assert gr.json()["name"] == payload["name"]

        # cleanup
        dr = session.delete(f"{API}/contacts/{cid}", headers=auth)
        assert dr.status_code in (200, 204)

    def test_analytics(self, session, auth):
        r = session.get(f"{API}/analytics", headers=auth)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), dict)

    def test_campaigns_list(self, session, auth):
        r = session.get(f"{API}/campaigns", headers=auth)
        assert r.status_code == 200
        body = r.json()
        # server returns either a list or {items: [...]} — accept both
        items = body if isinstance(body, list) else body.get("items")
        assert isinstance(items, list)
