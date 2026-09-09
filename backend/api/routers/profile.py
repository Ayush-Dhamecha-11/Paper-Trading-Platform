import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Cookie
from sqlalchemy import select
from sqlalchemy.orm import Session
from api.dependencies.auth import get_current_user
from db.database import get_db
from db.supabase_client import supabase, admin_supabase
from db.models import UserPreference

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["profile"])

def get_session_from_cookies(
    access_token: str | None,
    refresh_token: str | None
):
    if not access_token or not refresh_token:
        raise HTTPException(
            status_code=401,
            detail="Authentication cookies are missing"
        )

    try:
        response = supabase.auth.set_session(
            access_token,
            refresh_token
        )

        if not response.user:
            raise HTTPException(
                status_code=401,
                detail="Invalid session"
            )

        return response.user

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired session"
        )


# GET CURRENT USER
@router.get("/profile")
def get_user_profile(db: Session = Depends(get_db),
    access_token: str | None = Cookie(default=None),
    refresh_token: str | None = Cookie(default=None),
):
    user = get_session_from_cookies(
        access_token,
        refresh_token
    )

    metadata = user.user_metadata or {}

    preference = db.execute(
        select(UserPreference).where(
        UserPreference.user_id == user.id
        )
    ).scalar_one_or_none()

    return {
        "name": metadata.get("name"),
        "email": user.email,
        "preference": {
            "theme": preference.theme if preference else "Light",
            "auto_trade": preference.auto_trade if preference else False
        }
    }


# CHANGE NAME
@router.post("/name")
def change_name(
    data: dict,
    access_token: str | None = Cookie(default=None),
    refresh_token: str | None = Cookie(default=None),
):
    user = get_session_from_cookies(
        access_token,
        refresh_token
    )

    new_name = data.get("new_name")

    if not new_name or not new_name.strip():
        raise HTTPException(
            status_code=400,
            detail="New name is required"
        )

    new_name = new_name.strip()

    metadata = user.user_metadata or {}
    metadata["name"] = new_name

    try:
        admin_supabase.auth.admin.update_user_by_id(
            user.id,
            {
                "user_metadata": metadata
            }
        )

        return {
            "message": "Name updated successfully",
            "name": new_name
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update name: {str(e)}"
        )


# CHANGE PASSWORD

@router.post("/password")
def change_password(
    data: dict,
    access_token: str | None = Cookie(default=None),
    refresh_token: str | None = Cookie(default=None),
):
    user = get_session_from_cookies(
        access_token,
        refresh_token
    )

    old_password = data.get("old_password")
    new_password = data.get("new_password")

    if not old_password or not new_password:
        raise HTTPException(
            status_code=400,
            detail="Old password and new password are required"
        )

    if len(new_password) < 6:
        raise HTTPException(
            status_code=400,
            detail="New password must be at least 6 characters"
        )

    if old_password == new_password:
        raise HTTPException(
            status_code=400,
            detail="New password must be different from old password"
        )

    # Verify old password
    try:
        login_response = supabase.auth.sign_in_with_password({
            "email": user.email,
            "password": old_password
        })

        if not login_response.user:
            raise HTTPException(
                status_code=401,
                detail="Old password is incorrect"
            )

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Old password is incorrect"
        )

    # Update password
    try:
        admin_supabase.auth.admin.update_user_by_id(
            user.id,
            {
                "password": new_password
            }
        )

        return {
            "message": "Password updated successfully"
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update password: {str(e)}"
        )


# UPDATE PREFERENCES
@router.post("/preferences")
def update_preferences(
    data: dict,
    access_token: str | None = Cookie(default=None),
    refresh_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    user = get_session_from_cookies(
        access_token,
        refresh_token,
    )

    theme = data.get("theme")
    auto_trade = data.get("auto_trade")

    if theme is None:
        raise HTTPException(
            status_code=400,
            detail="Theme is required",
        )

    if auto_trade is None:
        raise HTTPException(
            status_code=400,
            detail="auto_trade is required",
        )

    if theme not in ["Light", "Dark"]:
        raise HTTPException(
            status_code=400,
            detail="Theme must be either 'Light' or 'Dark'",
        )

    if not isinstance(auto_trade, bool):
        raise HTTPException(
            status_code=400,
            detail="auto_trade must be a boolean",
        )

    # Find user's preference row
    preference = db.execute(
        select(UserPreference).where(
            UserPreference.user_id == user.id
        )
    ).scalar_one_or_none()

    # Update existing row
    if preference:
        preference.theme = theme
        preference.auto_trade = auto_trade

    # Create row if it doesn't exist
    else:
        preference = UserPreference(
            user_id=user.id,
            theme=theme,
            auto_trade=auto_trade,
        )

        db.add(preference)

    try:
        db.commit()

    except Exception:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="Failed to update user preferences",
        )

    return {
        "message": "Preferences updated successfully",
        "theme": theme,
        "auto_trade": auto_trade,
    }