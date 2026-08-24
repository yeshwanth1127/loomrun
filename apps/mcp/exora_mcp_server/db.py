import json
from typing import Optional

import asyncpg

from exora_mcp_server.config import DATABASE_URL

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    return _pool


async def get_org_tokens(org_id: str, service_name: str) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT credentials, status FROM automation_connections "
        "WHERE organization_id=$1 AND service_name=$2",
        org_id,
        service_name,
    )
    if not row or row["status"] != "connected":
        return None
    creds = row["credentials"]
    if isinstance(creds, str):
        creds = json.loads(creds)
    return creds


async def update_org_tokens(org_id: str, service_name: str, new_creds: dict) -> None:
    pool = await get_pool()
    await pool.execute(
        "UPDATE automation_connections "
        "SET credentials=$1::jsonb, updated_at=NOW() "
        "WHERE organization_id=$2 AND service_name=$3",
        json.dumps(new_creds),
        org_id,
        service_name,
    )
