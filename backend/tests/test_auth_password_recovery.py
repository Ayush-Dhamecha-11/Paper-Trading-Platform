from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException

from api.routers import auth as auth_router
from api.schemas.auth import ForgotPasswordRequest, ResetPasswordRequest


def test_forgot_password_sends_pkce_challenge_and_state(monkeypatch):
    request_data = {}

    class FakeResponse:
        def raise_for_status(self):
            pass

    def fake_post(url, **kwargs):
        request_data.update(url=url, **kwargs)
        return FakeResponse()

    monkeypatch.setenv("FRONTEND_URL", "https://frontend.example")
    monkeypatch.setenv("SUPABASE_URL", "https://supabase.example")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(auth_router.httpx, "post", fake_post)

    result = auth_router.forgot_password(
        ForgotPasswordRequest(
            email="user@example.com",
            code_challenge="A" * 43,
            state="S" * 16,
        )
    )

    assert result["message"] == "Password reset email sent"
    assert request_data["url"] == "https://supabase.example/auth/v1/recover"
    assert request_data["json"] == {
        "email": "user@example.com",
        "code_challenge": "A" * 43,
        "code_challenge_method": "s256",
    }
    redirect_to = request_data["params"]["redirect_to"]
    assert parse_qs(urlparse(redirect_to).query) == {"state": ["S" * 16]}


def test_reset_password_exchanges_code_with_verifier(monkeypatch):
    calls = {}
    monkeypatch.setenv("SUPABASE_URL", "https://supabase.example")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")

    class FakeAuth:
        def exchange_code_for_session(self, params):
            calls["exchange"] = params
            return SimpleNamespace(session=object())

        def update_user(self, attributes):
            calls["update"] = attributes

    class FakeClient:
        auth = FakeAuth()

    def fake_create_client(url, key, options):
        calls["client"] = (url, key, options)
        return FakeClient()

    monkeypatch.setattr(auth_router, "create_client", fake_create_client)
    result = auth_router.reset_password(
        ResetPasswordRequest(
            code="one-time-code",
            code_verifier="v" * 43,
            new_password="new-password",
        )
    )

    assert result["message"] == "Password updated successfully"
    assert calls["exchange"] == {
        "auth_code": "one-time-code",
        "code_verifier": "v" * 43,
    }
    assert calls["update"] == {"password": "new-password"}
    assert calls["client"][2].persist_session is False


def test_reset_password_rejects_missing_recovery_credentials(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://supabase.example")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    try:
        auth_router.reset_password(
            ResetPasswordRequest(new_password="new-password")
        )
    except HTTPException as error:
        assert error.status_code == 400
        assert "Reset token is missing" in error.detail
    else:
        raise AssertionError("Expected missing reset credentials to be rejected")
