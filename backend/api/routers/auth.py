import os
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Depends, Response, Cookie
from fastapi.responses import RedirectResponse
from db.supabase_client import supabase, admin_supabase
from supabase import create_client
from supabase.lib.client_options import SyncClientOptions
from api.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
)
from api.dependencies.auth import get_current_user
from utils.cookies import set_auth_cookies, clear_auth_cookies


router = APIRouter(
    prefix="/auth",
    tags=["auth"]
) 

# REGISTER
@router.post("/register")
def register(payload: RegisterRequest):
    try:
        # Check whether email is already registered
        users = admin_supabase.auth.admin.list_users()

        email_exists = any(
            user.email and user.email.lower() == payload.email.lower()
            for user in users
        )

        if email_exists:
            raise HTTPException(
                status_code=409,
                detail="Email is already registered. Please login."
            )

        redirect_url = os.getenv("FRONTEND_URL")
        # Register new user
        res = supabase.auth.sign_up({
            "email": payload.email,
            "password": payload.password,
            "options": {
                "email_redirect_to": f"{redirect_url}/register/callback"
            }
        })

        return {
            "message": "Check your email to confirm your account",
            "user": res.user
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=str(e)
        )


@router.post("/register/callback")
def register_callback(body: dict, response: Response):

    access_token = body.get("access_token", None)
    refresh_token = body.get("refresh_token", None) 

    if not access_token or not refresh_token:
        raise HTTPException(status_code=400, detail="Missing access_token or refresh_token")

    set_auth_cookies(
        response,
        access_token,
        refresh_token,
    )

    return {
        "message": "Registration successful",
    }

# LOGIN

@router.post("/login")
def login(payload: LoginRequest, response: Response):
    try:
        res = supabase.auth.sign_in_with_password({
            "email": payload.email,
            "password": payload.password
        })

        if not res.session:
            raise HTTPException(status_code=401, detail="Login failed. No session created.")

        set_auth_cookies(
            response,
            res.session.access_token,
            res.session.refresh_token,
        )

        return {
            #"access_token": res.session.access_token,
            #"refresh_token": res.session.refresh_token,
            "user": res.user
        }

    except Exception:
        raise HTTPException(status_code=401, detail="Invalid credentials")


# FORGOT PASSWORD

@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordRequest):
    try:
        frontend_url = os.getenv("FRONTEND_URL")
        supabase_url = os.getenv("SUPABASE_URL")
        anon_key = os.getenv("SUPABASE_ANON_KEY")
        if not frontend_url or not supabase_url or not anon_key:
            raise HTTPException(status_code=500, detail="Password recovery is not configured.")

        redirect_to = (
            f"{frontend_url.rstrip('/')}/reset-password?"
            f"{urlencode({'state': payload.state})}"
        )
        # The Python helper does not expose the PKCE challenge fields required for code exchange.
        response = httpx.post(
            f"{supabase_url.rstrip('/')}/auth/v1/recover",
            params={"redirect_to": redirect_to},
            headers={"apikey": anon_key},
            json={
                "email": payload.email,
                "code_challenge": payload.code_challenge,
                "code_challenge_method": "s256",
            },
            timeout=10,
        )
        response.raise_for_status()

        return { "message": "Password reset email sent"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# RESET PASSWORD

@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest):
    try:
        supabase_url = os.getenv("SUPABASE_URL")
        anon_key = os.getenv("SUPABASE_ANON_KEY")
        if not supabase_url or not anon_key:
            raise HTTPException(status_code=500, detail="Password recovery is not configured.")

        recovery_client = create_client(
            supabase_url,
            anon_key,
            SyncClientOptions(
                auto_refresh_token=False,
                persist_session=False,
                flow_type="pkce",
            ),
        )

        if payload.code and payload.code_verifier:
            exchange = recovery_client.auth.exchange_code_for_session({
                "auth_code": payload.code,
                "code_verifier": payload.code_verifier,
            })
            if not exchange.session:
                raise HTTPException(status_code=400, detail="Could not verify the password reset link.")
        elif payload.access_token and payload.refresh_token:
            recovery_client.auth.set_session(
                payload.access_token,
                payload.refresh_token,
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Reset token is missing. Please use the link from your email.",
            )

        recovery_client.auth.update_user({"password": payload.new_password})

        return { 
            "message": "Password updated successfully", 
            }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# GOOGLE OAUTH - LOGIN

@router.get("/google/login")
def google_login():
    redirect_url = os.getenv("GOOGLE_REDIRECT_URL")
    try:
        res = supabase.auth.sign_in_with_oauth({
            "provider": "google",
            "options": {"redirect_to": redirect_url}
        })

        return { "url": res.url }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# GOOGLE OAUTH - CALLBACK

@router.get("/google/callback")
def google_callback(code: str, response: Response):
    try:

        res = supabase.auth.exchange_code_for_session({"auth_code": code})

        if not res.session:
            raise HTTPException(
                status_code=400,
                detail="Could not create session"
            )

        frontend_url = f"{os.getenv('FRONTEND_URL')}/auth/google/callback"

        response1 = RedirectResponse(
            url=frontend_url,
            status_code=302,
        )

        set_auth_cookies(
            response,
            res.session.access_token,
            res.session.refresh_token,
        )

        return {
            #"access_token": res.session.access_token,
            #"refresh_token": res.session.refresh_token,
            "user": res.user
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    

@router.post("/refresh")
def refresh_token(response: Response, refresh_token: str | None = Cookie(default=None)):
    
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token")

    try:
        res = supabase.auth.refresh_session(refresh_token)

        if not res.session:
            raise HTTPException(status_code=401, detail="Could not refresh session")

        set_auth_cookies(
            response,
            res.session.access_token,
            res.session.refresh_token,
        )

        return {"message": "Session refreshed"}

    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

# LOGOUT

@router.post("/logout")
def logout(response: Response):
    """
    Logout endpoint.

    The get_current_user dependency ensures that the supplied
    Bearer token is valid before reaching this function.

    Since JWT access tokens are stateless, the backend does not
    need to maintain a server-side session here.

    The frontend should discard the access_token and
    refresh_token after receiving this response.
    """
    clear_auth_cookies(response)

    return {
        "message": "Logged out successfully"
    }