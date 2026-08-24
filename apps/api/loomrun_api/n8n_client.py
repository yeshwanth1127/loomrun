"""HTTP client for the n8n REST API (self-hosted)."""

from __future__ import annotations

import logging

import httpx

from loomrun_api.config import settings

logger = logging.getLogger(__name__)


class N8nApiError(Exception):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


LOOMRUN_AUTOMATION_CREDENTIAL_NAME = "Loomrun Automation API"


class N8nClient:
    def __init__(self) -> None:
        base = settings.n8n_api_url.rstrip("/") if settings.n8n_api_url else ""
        self._base = f"{base}/api/v1" if base else ""
        self._key = settings.n8n_api_key

    @property
    def configured(self) -> bool:
        return bool(self._base and self._key)

    def _headers(self) -> dict[str, str]:
        return {
            "X-N8N-API-KEY": self._key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    async def _request(self, method: str, path: str, **kwargs) -> dict | list:
        if not self.configured:
            raise N8nApiError("n8n API not configured (set N8N_API_URL and N8N_API_KEY)")
        url = f"{self._base}{path}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.request(method, url, headers=self._headers(), **kwargs)
        if resp.status_code >= 400:
            logger.error("n8n API %s %s failed: %s", method, path, resp.text)
            raise N8nApiError(resp.text or f"n8n API error {resp.status_code}", resp.status_code)
        if not resp.content:
            return {}
        return resp.json()

    async def create_workflow(self, payload: dict) -> dict:
        body = {
            "name": payload["name"],
            "nodes": payload["nodes"],
            "connections": payload.get("connections", {}),
            "settings": payload.get("settings", {"executionOrder": "v1"}),
        }
        return await self._request("POST", "/workflows", json=body)  # type: ignore[return-value]

    async def activate_workflow(self, workflow_id: str) -> dict:
        try:
            return await self._request("POST", f"/workflows/{workflow_id}/activate")  # type: ignore[return-value]
        except N8nApiError:
            return await self._request("PATCH", f"/workflows/{workflow_id}", json={"active": True})  # type: ignore[return-value]

    async def try_activate_workflow(self, workflow_id: str) -> bool:
        """Activate when possible; return False if nodes still need credentials."""
        try:
            await self.activate_workflow(workflow_id)
            return True
        except N8nApiError as exc:
            logger.warning("Skipping activation for workflow %s: %s", workflow_id, exc)
            return False

    async def deactivate_workflow(self, workflow_id: str) -> dict:
        try:
            return await self._request("POST", f"/workflows/{workflow_id}/deactivate")  # type: ignore[return-value]
        except N8nApiError:
            return await self._request("PATCH", f"/workflows/{workflow_id}", json={"active": False})  # type: ignore[return-value]

    async def delete_workflow(self, workflow_id: str) -> None:
        await self._request("DELETE", f"/workflows/{workflow_id}")

    async def list_credentials(self) -> list[dict]:
        result = await self._request("GET", "/credentials")
        if isinstance(result, dict):
            data = result.get("data")
            return data if isinstance(data, list) else []
        return result if isinstance(result, list) else []

    async def create_credential(self, payload: dict) -> dict:
        return await self._request("POST", "/credentials", json=payload)  # type: ignore[return-value]

    async def update_credential(self, credential_id: str, payload: dict) -> dict:
        return await self._request("PATCH", f"/credentials/{credential_id}", json=payload)  # type: ignore[return-value]

    async def ensure_automation_credential(self, bearer_token: str) -> str:
        """Create or update the shared httpHeaderAuth credential used by LLM workflow nodes."""
        header_value = bearer_token if bearer_token.lower().startswith("bearer ") else f"Bearer {bearer_token}"
        body = {
            "name": LOOMRUN_AUTOMATION_CREDENTIAL_NAME,
            "type": "httpHeaderAuth",
            "data": {"name": "Authorization", "value": header_value},
        }
        for cred in await self.list_credentials():
            if cred.get("name") == LOOMRUN_AUTOMATION_CREDENTIAL_NAME and cred.get("type") == "httpHeaderAuth":
                cred_id = str(cred["id"])
                await self.update_credential(cred_id, body)
                return cred_id
        created = await self.create_credential(body)
        cred_id = str(created.get("id", ""))
        if not cred_id:
            raise N8nApiError("n8n did not return credential id for Loomrun Automation API")
        return cred_id

    def workflow_editor_url(self, workflow_id: str) -> str | None:
        public = settings.n8n_public_url.rstrip("/") if settings.n8n_public_url else ""
        if not public:
            return None
        return f"{public}/workflow/{workflow_id}"

    def production_webhook_url(self, path: str) -> str:
        return build_webhook_url(path)


def build_webhook_url(path: str) -> str:
    base = settings.n8n_webhook_base
    if not base:
        raise N8nApiError("Set N8N_WEBHOOK_URL (or N8N_PUBLIC_URL) in .env")
    clean = path.strip("/")
    return f"{base}/{clean}"


n8n_client = N8nClient()
