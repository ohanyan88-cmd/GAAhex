import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..security import verify_password, create_access_token, decode_token

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/login")


class LoginIn(BaseModel):
    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, s: AsyncSession = Depends(get_session)):
    user = (await s.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(str(user.id), {"tenant": str(user.tenant_id), "email": user.email})
    return TokenOut(access_token=token)


async def current_user(token: str = Depends(oauth2), s: AsyncSession = Depends(get_session)) -> User:
    try:
        payload = decode_token(token)
        uid = uuid.UUID(payload["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = (await s.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@router.get("/me")
async def me(user: User = Depends(current_user)):
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "tenant_id": str(user.tenant_id),
        "primary_node_id": str(user.primary_node_id) if user.primary_node_id else None,
    }
