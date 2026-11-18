from pydantic import BaseModel, EmailStr, Field

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class ForgotPasswordRequest(BaseModel):
    email: EmailStr
    code_challenge: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    state: str = Field(pattern=r"^[A-Za-z0-9_-]{16,128}$")

class ResetPasswordRequest(BaseModel):
    code: str | None = None
    code_verifier: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    new_password: str