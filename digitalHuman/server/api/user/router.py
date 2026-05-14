# -*- coding: utf-8 -*-
"""
User management API router - MySQL version
"""
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Union

import aiomysql
import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Header, Request

from digitalHuman.database import get_db

router = APIRouter()

JWT_SECRET = os.getenv("DHC_JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24


# ─── Pydantic Models ──────────────────────────────────────────────────────────

from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreateRequest(BaseModel):
    username: str
    password: str
    name: str
    age: Optional[int] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    avatar: Optional[str] = None
    role: Optional[str] = "user"


class UserUpdateRequest(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    avatar: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None


class GuardianRequest(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    dingtalk: Optional[str] = None
    wechat: Optional[str] = None
    is_global: Optional[int] = 0


class GuardianLinkRequest(BaseModel):
    """通过已有监护人用户ID关联监护人"""
    guardian_user_id: int


class MyGuardianRequest(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    dingtalk: Optional[str] = None
    wechat: Optional[str] = None


class NotificationConfigRequest(BaseModel):
    enabled: int
    config_json: Optional[Union[str, dict, Any]] = "{}"

    def get_config_json_str(self) -> str:
        """兼容前端传 dict 或 str，统一转为 JSON 字符串存库"""
        if isinstance(self.config_json, dict):
            return json.dumps(self.config_json, ensure_ascii=False)
        if self.config_json is None:
            return "{}"
        return str(self.config_json)


class GuardianNotificationConfigRequest(BaseModel):
    enabled: int = 1
    config_json: Optional[Union[str, dict, Any]] = "{}"

    def get_config_json_str(self) -> str:
        if isinstance(self.config_json, dict):
            return json.dumps(self.config_json, ensure_ascii=False)
        if self.config_json is None:
            return "{}"
        return str(self.config_json)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def _verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def _create_token(user_id: int, username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {"sub": str(user_id), "username": username, "role": role, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已过期")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token 无效")


async def get_current_user(request: Request) -> dict:
    """从 Authorization header 解析 JWT，返回 {user_id, username, role}"""
    authorization = request.headers.get("Authorization")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="缺少认证 Token")
    token = authorization[len("Bearer "):]
    payload = _decode_token(token)
    return {
        "user_id": int(payload["sub"]),
        "username": payload.get("username", ""),
        "role": payload.get("role", "user"),
    }


async def _get_current_user_id(authorization: str = Header(None)) -> int:
    """兼容旧代码的 Depends 方式"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="缺少认证 Token")
    token = authorization[len("Bearer "):]
    payload = _decode_token(token)
    return int(payload["sub"])


def RoleChecker(allowed_roles: list):
    """FastAPI Depends 风格的角色权限检查器"""
    async def check(request: Request) -> dict:
        user = await get_current_user(request)
        if user["role"] not in allowed_roles:
            raise HTTPException(status_code=403, detail="权限不足")
        return user
    return check


def AnyAuthenticated():
    """任意已认证用户"""
    async def check(request: Request) -> dict:
        return await get_current_user(request)
    return check


def _row_to_dict(row) -> dict:
    if row is None:
        return None
    return dict(row)


# ─── Startup: ensure admin account exists ─────────────────────────────────────

async def ensure_default_admin():
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT id, role FROM users WHERE username = 'admin'")
            row = await cur.fetchone()
            if row is None:
                pwd_hash = _hash_password("admin123")
                await cur.execute(
                    "INSERT INTO users (username, password_hash, name, role) VALUES (%s, %s, %s, %s)",
                    ("admin", pwd_hash, "管理员", "super_admin"),
                )
            elif row.get("role") != "super_admin":
                # 确保 admin 用户为 super_admin
                await cur.execute(
                    "UPDATE users SET role = 'super_admin' WHERE username = 'admin'"
                )


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/user/login")
async def login(req: LoginRequest):
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, username, password_hash, name, age, gender, address, avatar, role, created_at FROM users WHERE username = %s",
                (req.username,),
            )
            row = await cur.fetchone()
    if row is None or not _verify_password(req.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    user = _row_to_dict(row)
    user.pop("password_hash", None)
    role = user.get("role", "user") or "user"
    token = _create_token(user["id"], user["username"], role)
    return {"code": 0, "token": token, "user": user}


@router.get("/user/profile")
async def get_profile(request: Request):
    current = await get_current_user(request)
    user_id = current["user_id"]
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, username, name, age, gender, address, avatar, role, created_at FROM users WHERE id = %s",
                (user_id,),
            )
            row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"code": 0, "user": _row_to_dict(row)}


@router.get("/user/list")
async def list_users(current: dict = Depends(RoleChecker(["super_admin"]))):
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, username, name, age, gender, address, avatar, role, created_at FROM users ORDER BY id"
            )
            rows = await cur.fetchall()
    return {"code": 0, "users": [_row_to_dict(r) for r in rows]}


@router.post("/user/create")
async def create_user(req: UserCreateRequest, current: dict = Depends(RoleChecker(["super_admin"]))):
    pool = await get_db()
    pwd_hash = _hash_password(req.password)
    role = req.role if req.role in ("super_admin", "guardian", "user") else "user"
    try:
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "INSERT INTO users (username, password_hash, name, age, gender, address, avatar, role) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (req.username, pwd_hash, req.name, req.age, req.gender, req.address, req.avatar, role),
                )
                await cur.execute("SELECT id FROM users WHERE username = %s", (req.username,))
                row = await cur.fetchone()
    except Exception as e:
        if "Duplicate entry" in str(e) or "1062" in str(e):
            raise HTTPException(status_code=409, detail="用户名已存在")
        raise HTTPException(status_code=500, detail=str(e))
    return {"code": 0, "user_id": row["id"]}


@router.put("/user/{user_id}")
async def update_user(user_id: int, req: UserUpdateRequest, current: dict = Depends(RoleChecker(["super_admin"]))):
    fields, values = [], []
    if req.name is not None:
        fields.append("name = %s"); values.append(req.name)
    if req.age is not None:
        fields.append("age = %s"); values.append(req.age)
    if req.gender is not None:
        fields.append("gender = %s"); values.append(req.gender)
    if req.address is not None:
        fields.append("address = %s"); values.append(req.address)
    if req.avatar is not None:
        fields.append("avatar = %s"); values.append(req.avatar)
    if req.password is not None:
        fields.append("password_hash = %s"); values.append(_hash_password(req.password))
    if req.role is not None:
        # 只有 super_admin 可修改角色，且角色值必须合法
        if req.role not in ("super_admin", "guardian", "user"):
            raise HTTPException(status_code=400, detail="角色值不合法")
        fields.append("role = %s"); values.append(req.role)
    if not fields:
        raise HTTPException(status_code=400, detail="无更新字段")
    values.append(user_id)
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"UPDATE users SET {', '.join(fields)} WHERE id = %s", values
            )
    return {"code": 0, "message": "更新成功"}


@router.delete("/user/{user_id}")
async def delete_user(user_id: int, current: dict = Depends(RoleChecker(["super_admin"]))):
    import logging
    _logger = logging.getLogger(__name__)

    # 1. 删除 MySQL 用户数据
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("DELETE FROM users WHERE id = %s", (user_id,))

    # 2. 清理 Milvus 向量记忆（失败不影响主流程）
    try:
        import asyncio
        from digitalHuman.memory.milvus_store import MilvusStore
        store = MilvusStore()
        await store.connect()
        deleted_count = await asyncio.to_thread(store.delete_user_memories, user_id)
        _logger.info(f"Cleaned {deleted_count} Milvus memories for deleted user {user_id}")
    except Exception as e:
        _logger.warning(f"Failed to clean Milvus data for user {user_id}: {e}")

    return {"code": 0, "message": "删除成功"}


@router.post("/user/{user_id}/guardian")
async def add_guardian(user_id: int, req: GuardianRequest, current: dict = Depends(RoleChecker(["super_admin"]))):
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO guardians (user_id, name, phone, email, dingtalk, wechat, is_global) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (user_id, req.name, req.phone, req.email, req.dingtalk, req.wechat, req.is_global),
            )
    return {"code": 0, "message": "监护人添加成功"}


@router.post("/user/{user_id}/guardian-link")
async def add_guardian_link(user_id: int, req: GuardianLinkRequest, current: dict = Depends(RoleChecker(["super_admin"]))):
    """通过已有监护人用户ID关联监护人（从users表读取姓名）"""
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            # 验证目标用户存在且角色为 guardian
            await cur.execute(
                "SELECT id, name, role FROM users WHERE id = %s",
                (req.guardian_user_id,)
            )
            guardian_user = await cur.fetchone()
            if guardian_user is None:
                raise HTTPException(status_code=404, detail="用户不存在")
            if guardian_user["role"] not in ("guardian", "super_admin"):
                raise HTTPException(status_code=400, detail="该用户不是监护人角色")
            # 检查是否已关联
            await cur.execute(
                "SELECT id FROM guardians WHERE user_id = %s AND guardian_user_id = %s",
                (user_id, req.guardian_user_id)
            )
            existing = await cur.fetchone()
            if existing:
                raise HTTPException(status_code=409, detail="该监护人已关联")
            # 插入关联记录
            await cur.execute(
                "INSERT INTO guardians (user_id, guardian_user_id, name) VALUES (%s, %s, %s)",
                (user_id, req.guardian_user_id, guardian_user["name"])
            )
    return {"code": 0, "message": "监护人关联成功"}


@router.delete("/user/{user_id}/guardian/{guardian_id}")
async def delete_guardian(user_id: int, guardian_id: int, current: dict = Depends(RoleChecker(["super_admin"]))):
    """管理员删除用户的监护人关联"""
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id FROM guardians WHERE id = %s AND user_id = %s",
                (guardian_id, user_id)
            )
            row = await cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="监护人记录不存在")
            await cur.execute(
                "DELETE FROM guardians WHERE id = %s AND user_id = %s",
                (guardian_id, user_id)
            )
    return {"code": 0, "message": "监护人删除成功"}


@router.get("/user/{user_id}/guardians")
async def get_guardians(user_id: int, current: dict = Depends(RoleChecker(["super_admin", "guardian"]))):
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM guardians WHERE user_id = %s OR is_global = 1 ORDER BY is_global DESC, id",
                (user_id,),
            )
            rows = await cur.fetchall()
    return {"code": 0, "guardians": [_row_to_dict(r) for r in rows]}


@router.get("/user/conversations/{user_id}")
async def get_user_conversations(user_id: int, current: dict = Depends(RoleChecker(["super_admin"]))):
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM conversations WHERE user_id = %s ORDER BY started_at DESC",
                (user_id,),
            )
            rows = await cur.fetchall()
    return {"code": 0, "conversations": [_row_to_dict(r) for r in rows]}


@router.get("/user/crisis-reports")
async def get_crisis_reports(user_id: Optional[int] = None, current: dict = Depends(RoleChecker(["super_admin", "guardian"]))):
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            if user_id:
                await cur.execute(
                    "SELECT * FROM crisis_reports WHERE user_id = %s ORDER BY created_at DESC",
                    (user_id,),
                )
            else:
                await cur.execute(
                    "SELECT * FROM crisis_reports ORDER BY created_at DESC"
                )
            rows = await cur.fetchall()
    return {"code": 0, "reports": [_row_to_dict(r) for r in rows]}


# ─── 普通用户自助管理监护人 ────────────────────────────────────────────────────

@router.get("/user/my-guardians")
async def get_my_guardians(request: Request):
    """普通用户获取自己的监护人列表"""
    current = await get_current_user(request)
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM guardians WHERE user_id = %s ORDER BY id",
                (current["user_id"],),
            )
            rows = await cur.fetchall()
    return {"code": 0, "guardians": [_row_to_dict(r) for r in rows]}


@router.post("/user/my-guardian")
async def add_my_guardian(req: MyGuardianRequest, request: Request):
    """普通用户添加自己的监护人"""
    current = await get_current_user(request)
    if not any([req.phone, req.email, req.dingtalk, req.wechat]):
        raise HTTPException(status_code=400, detail="至少需要提供一种联系方式")
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO guardians (user_id, name, phone, email, dingtalk, wechat) VALUES (%s, %s, %s, %s, %s, %s)",
                (current["user_id"], req.name, req.phone, req.email, req.dingtalk, req.wechat),
            )
    return {"code": 0, "message": "监护人添加成功"}


@router.delete("/user/my-guardian/{guardian_id}")
async def delete_my_guardian(guardian_id: int, request: Request):
    """普通用户删除自己的监护人（只能删自己的）"""
    current = await get_current_user(request)
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # 先验证该监护人属于当前用户
            await cur.execute(
                "SELECT id FROM guardians WHERE id = %s AND user_id = %s",
                (guardian_id, current["user_id"]),
            )
            row = await cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="监护人不存在或无权删除")
            await cur.execute("DELETE FROM guardians WHERE id = %s AND user_id = %s", (guardian_id, current["user_id"]))
    return {"code": 0, "message": "监护人删除成功"}


# ─── 监护人/管理员通知配置 API ─────────────────────────────────────────────────

@router.get("/guardian/notification-config/{user_id}")
async def get_guardian_notification_config(user_id: int, request: Request):
    """获取指定用户(监护人/管理员)的通知配置"""
    current = await get_current_user(request)
    if current["role"] == "user":
        raise HTTPException(status_code=403, detail="权限不足")
    if current["role"] == "guardian" and current["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="只能查看自己的配置")

    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM guardian_notification_config WHERE user_id = %s",
                (user_id,),
            )
            rows = await cur.fetchall()

    configs = []
    for c in rows:
        d = _row_to_dict(c)
        if isinstance(d.get("config_json"), str):
            try:
                d["config_json"] = json.loads(d["config_json"]) if d["config_json"] else {}
            except Exception:
                d["config_json"] = {}
        configs.append(d)
    return {"code": 0, "configs": configs}


@router.put("/guardian/notification-config/{user_id}/{channel}")
async def update_guardian_notification_config(
    user_id: int, channel: str, req: GuardianNotificationConfigRequest, request: Request
):
    """更新指定用户的某个通知渠道配置"""
    current = await get_current_user(request)
    if current["role"] == "user":
        raise HTTPException(status_code=403, detail="权限不足")
    if current["role"] == "guardian" and current["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="只能修改自己的配置")

    config_json_str = req.get_config_json_str()
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """INSERT INTO guardian_notification_config (user_id, channel, enabled, config_json)
                   VALUES (%s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE enabled=%s, config_json=%s, updated_at=CURRENT_TIMESTAMP""",
                (user_id, channel, req.enabled, config_json_str, req.enabled, config_json_str),
            )
            await conn.commit()
    return {"code": 0, "message": "配置更新成功"}


# ─── 管理员查看所有监护人用户 ──────────────────────────────────────────────────

@router.get("/admin/guardians")
async def get_all_guardians_with_users(current: dict = Depends(RoleChecker(["super_admin"]))):
    """获取所有角色为 guardian/super_admin 的用户列表（超级管理员用）"""
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, username, name, role, created_at FROM users WHERE role IN ('guardian', 'super_admin') ORDER BY id"
            )
            rows = await cur.fetchall()
    return {"code": 0, "guardians": [_row_to_dict(r) for r in rows]}


# ─── 系统通知配置（保留原有接口）─────────────────────────────────────────────

@router.get("/notification/config")
async def get_notification_config(current: dict = Depends(RoleChecker(["super_admin"]))):
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM notification_config ORDER BY id")
            rows = await cur.fetchall()
    return {"code": 0, "configs": [_row_to_dict(r) for r in rows]}


@router.put("/notification/config/{channel}")
async def update_notification_config(channel: str, req: NotificationConfigRequest, current: dict = Depends(RoleChecker(["super_admin"]))):
    pool = await get_db()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """INSERT INTO notification_config (channel, enabled, config_json)
                   VALUES (%s, %s, %s)
                   ON DUPLICATE KEY UPDATE
                       enabled = VALUES(enabled),
                       config_json = VALUES(config_json),
                       updated_at = CURRENT_TIMESTAMP""",
                (channel, req.enabled, req.get_config_json_str()),
            )
    return {"code": 0, "message": "配置更新成功"}
