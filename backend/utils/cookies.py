from fastapi import Response

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"

def set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
):
    response.set_cookie(
        key=ACCESS_COOKIE,
        value=access_token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=60 * 60,
    )

    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh_token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=60 * 60 * 24 * 30,
    )

def clear_auth_cookies(response: Response):
    response.delete_cookie(
        key=ACCESS_COOKIE,
        httponly=True,
        secure=False,
        samesite="lax",
    )

    response.delete_cookie(
        key=REFRESH_COOKIE,
        httponly=True,
        secure=False,
        samesite="lax",
    )