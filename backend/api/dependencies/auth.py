import logging

from fastapi import Cookie, HTTPException, Response

from utils.cookies import set_auth_cookies
from db.supabase_client import supabase


logger = logging.getLogger(__name__)


def get_current_user(
    response: Response,
    access_token: str | None = Cookie(default=None),
    refresh_token: str | None = Cookie(default=None),
):

    if not access_token:
        logger.warning("get_current_user: access_token cookie missing")

        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        user_response = supabase.auth.get_user(access_token)

        user = user_response.user

        if not user:
            raise Exception("Supabase returned no user")

        logger.info("get_current_user: access token valid for user %s", user.id)

        return {
            "id": user.id,
            "email": user.email,
            "user_metadata": user.user_metadata or {}
        }

    except Exception as e:

        logger.warning("get_current_user: access token validation failed: %s", str(e))


    if not refresh_token:
        logger.warning("get_current_user: refresh_token cookie missing")
 
        raise HTTPException(status_code=401, detail="Session expired. Please login again.")

    try:

        logger.info("get_current_user: attempting token refresh")

        refresh_response = supabase.auth.refresh_session(refresh_token)

        if not refresh_response.session:
            logger.error("get_current_user: refresh_session returned no session")

            raise HTTPException(status_code=401, detail="Could not refresh session")

        session = refresh_response.session


        set_auth_cookies(
            response,
            session.access_token,
            session.refresh_token,
        )

        logger.info("get_current_user: session refreshed successfully")


        user_response = supabase.auth.get_user(session.access_token)

        user = user_response.user

        if not user:
            raise HTTPException(status_code=401, detail="Could not retrieve refreshed user")

        logger.info("get_current_user: refreshed user %s", user.id)

        return {
            "id": user.id,
            "email": user.email,
            "user_metadata": user.user_metadata or {}
        }

    except Exception as e:

        logger.exception("get_current_user: refresh failed: %s", str(e))

        raise HTTPException(status_code=401, detail="Invalid or expired session")