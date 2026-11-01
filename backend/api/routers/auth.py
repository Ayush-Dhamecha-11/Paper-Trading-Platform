import os
from fastapi import APIRouter, HTTPException, Depends
from db.supabase_client import supabase
from api.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    ForgotPasswordRequest,
    SendOtpRequest,
    VerifyOtpRequest,
    ResetPasswordRequest,
)
from api.dependencies.auth import get_current_user


router = APIRouter(
    prefix="/auth",
    tags=["auth"]
)

# REGISTER

@router.post("/register")
def register(payload: RegisterRequest):
    try:
        res = supabase.auth.sign_up({
            "email": payload.email,
            "password": payload.password,
            "options": {
                "email_redirect_to": "http://localhost:8000/login?verified=true"
            }
        })

        return {
            "message": "Check your email to confirm your account",
            "user": res.user
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# LOGIN

@router.post("/login")
def login(payload: LoginRequest):
    try:
        res = supabase.auth.sign_in_with_password({
            "email": payload.email,
            "password": payload.password
        })

        if not res.session:
            raise HTTPException(status_code=401, detail="Login failed. No session created.")

        return {
            "access_token": res.session.access_token,
            "refresh_token": res.session.refresh_token,
            "user": res.user
        }

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(status_code=401, detail="Invalid credentials")


# FORGOT PASSWORD

@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordRequest):
    try:
        supabase.auth.reset_password_for_email(
            payload.email
        )

        return {
            "message": "Password reset email sent"
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# RESET PASSWORD

@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest):
    try:
        supabase.auth.set_session(
            payload.access_token,
            payload.refresh_token
        )

        supabase.auth.update_user({"password": payload.new_password})

        return { "message": "Password updated successfully" }

    except Exception:
        raise HTTPException(status_code=400, detail="Could not reset password")

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# SEND OTP

@router.post("/send-otp")
def send_otp(payload: SendOtpRequest):
    try:
        supabase.auth.sign_in_with_otp({"email": payload.email})

        return {"message": "OTP sent to email"}

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# VERIFY OTP

@router.post("/verify-otp")
def verify_otp(payload: VerifyOtpRequest):
    try:
        res = supabase.auth.verify_otp({
            "email": payload.email,
            "token": payload.otp,
            "type": "email"
        })

        if not res.session:
            raise HTTPException(status_code=400, detail="OTP verification failed")

        return {
            "access_token": res.session.access_token,
            "refresh_token": res.session.refresh_token,
            "user": res.user
        }

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")


# GOOGLE OAUTH - LOGIN

@router.get("/google/login")
def google_login():
    redirect_url = os.getenv("GOOGLE_REDIRECT_URL_LOC")
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
def google_callback(code: str):
    try:
        res = supabase.auth.exchange_code_for_session({"auth_code": code})

        if not res.session:
            raise HTTPException(
                status_code=400,
                detail="Could not create session"
            )

        return {
            "access_token": res.session.access_token,
            "refresh_token": res.session.refresh_token,
            "user": res.user
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# LOGOUT

@router.post("/logout")
def logout(current_user=Depends(get_current_user)):
    """
    Logout endpoint.

    The get_current_user dependency ensures that the supplied
    Bearer token is valid before reaching this function.

    Since JWT access tokens are stateless, the backend does not
    need to maintain a server-side session here.

    The frontend should discard the access_token and
    refresh_token after receiving this response.
    """

    return {
        "message": "Logged out successfully"
    }