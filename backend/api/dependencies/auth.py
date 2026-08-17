import os
import jwt

from fastapi import Cookie, HTTPException


JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")


def get_current_user(access_token: str | None = Cookie(default=None)):
    
    # Check JWT secret configuration
    if not JWT_SECRET:
        raise HTTPException(status_code=500, detail="SUPABASE_JWT_SECRET is not configured")

    # Check whether user has an authentication cookie
    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(
            access_token,
            JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated"
        )

        return {
            "id": payload["sub"],
            "email": payload.get("email")
        }

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Access token has expired")

    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication token")