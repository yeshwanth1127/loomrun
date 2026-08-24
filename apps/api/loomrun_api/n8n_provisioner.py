"""Clone Loomrun n8n workflow templates per organization."""

from __future__ import annotations

import copy
import json
import logging
import re
import uuid
from pathlib import Path
from typing import Any

from loomrun_api.config import settings
from loomrun_api.n8n_client import LOOMRUN_AUTOMATION_CREDENTIAL_NAME, N8nApiError, n8n_client

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).resolve().parents[3] / "n8n" / "workflows"
_BUNDLE_FILE = "loomrun-automations.json"

_SLUG_RE = re.compile(r"[^a-z0-9-]+")


def _safe_slug(slug: str) -> str:
    return _SLUG_RE.sub("-", slug.lower().strip())[:48].strip("-") or "org"


def _load_workflow_templates() -> list[tuple[dict[str, Any], str, bool]]:
    path = _TEMPLATES_DIR / _BUNDLE_FILE
    if not path.is_file():
        raise N8nApiError(f"Workflow bundle missing: {path}")
    bundle = json.loads(path.read_text())
    items: list[tuple[dict[str, Any], str, bool]] = []
    for entry in bundle.get("workflows", []):
        key = entry.get("key")
        if not key:
            continue
        template = {
            "name": entry["name"],
            "nodes": entry["nodes"],
            "connections": entry.get("connections", {}),
            "settings": entry.get("settings", {"executionOrder": "v1"}),
        }
        has_webhook = bool(entry.get("has_webhook", False))
        items.append((template, key, has_webhook))
    if not items:
        raise N8nApiError(f"No workflows found in bundle: {path}")
    return items


def _regenerate_node_ids(workflow: dict[str, Any]) -> dict[str, Any]:
    wf = copy.deepcopy(workflow)
    for node in wf.get("nodes", []):
        old_id = node.get("id")
        if old_id:
            node["id"] = str(uuid.uuid4())
    return wf


def _strip_credentials(workflow: dict[str, Any]) -> dict[str, Any]:
    wf = copy.deepcopy(workflow)
    for node in wf.get("nodes", []):
        node.pop("credentials", None)
    return wf


def _prefix_webhook_paths(workflow: dict[str, Any], org_slug: str) -> dict[str, Any]:
    wf = copy.deepcopy(workflow)
    prefix = _safe_slug(org_slug)
    for node in wf.get("nodes", []):
        if node.get("type") != "n8n-nodes-base.webhook":
            continue
        params = node.setdefault("parameters", {})
        old_path = params.get("path", "")
        if old_path.startswith("loomrun-"):
            suffix = old_path[len("loomrun-") :]
            new_path = f"loomrun-{prefix}-{suffix}"
        else:
            new_path = f"loomrun-{prefix}-{old_path}" if old_path else f"loomrun-{prefix}-events"
        params["path"] = new_path
        node["webhookId"] = new_path
    return wf


def _rename_workflow(workflow: dict[str, Any], org_name: str) -> dict[str, Any]:
    wf = copy.deepcopy(workflow)
    base_name = wf.get("name", "Loomrun Workflow")
    wf["name"] = f"{base_name} — {org_name}"
    wf.pop("active", None)
    return wf


_PLACEHOLDER_KEYS = frozenset({
    "",
    "<openssl rand -hex 32>",
    "your-long-random-secret",
    "change-me",
})


def _validate_automation_key(key: str) -> str:
    cleaned = key.strip()
    if cleaned.lower() in _PLACEHOLDER_KEYS or cleaned.startswith("<"):
        raise N8nApiError(
            "Set a real LOOMRUN_AUTOMATION_API_KEY in Loomrun .env (generate: openssl rand -hex 32)"
        )
    return cleaned


def _has_loomrun_llm_node(workflow: dict[str, Any]) -> bool:
    for node in workflow.get("nodes", []):
        if node.get("type") == "n8n-nodes-base.httpRequest" and "Loomrun" in str(node.get("name", "")):
            return True
    return False


def _inject_loomrun_llm_config(
    workflow: dict[str, Any],
    *,
    org_slug: str,
    automation_credential_id: str | None,
) -> dict[str, Any]:
    """Bake Loomrun LLM URL + auth credential into cloned workflows (from server .env)."""
    if not _has_loomrun_llm_node(workflow):
        return workflow

    api_base = settings.public_api_url.strip()
    if not api_base:
        raise N8nApiError("Set PUBLIC_API_URL in Loomrun .env to clone LLM workflows")
    if not automation_credential_id:
        raise N8nApiError(
            "Loomrun automation credential was not created in n8n. Check N8N_API_KEY permissions."
        )

    model = settings.openrouter_default_model.strip() or "openai/gpt-4o-mini"
    wf = copy.deepcopy(workflow)
    base = api_base.rstrip("/")

    for node in wf.get("nodes", []):
        if node.get("type") != "n8n-nodes-base.httpRequest":
            continue
        if "Loomrun" not in str(node.get("name", "")):
            continue
        params = node.setdefault("parameters", {})
        params["url"] = f"{base}/v1/automation/llm/chat"
        params["authentication"] = "genericCredentialType"
        params["genericAuthType"] = "httpHeaderAuth"
        params["sendHeaders"] = True
        params["specifyHeaders"] = "keypair"
        params["headerParameters"] = {
            "parameters": [{"name": "Content-Type", "value": "application/json"}],
        }
        params["jsonBody"] = (
            "={{ JSON.stringify({ prompt: $json.analysisPrompt, model: '"
            + model
            + "', temperature: 0.2, organization_slug: '"
            + org_slug
            + "' }) }}"
        )
        node["credentials"] = {
            "httpHeaderAuth": {
                "id": automation_credential_id,
                "name": LOOMRUN_AUTOMATION_CREDENTIAL_NAME,
            }
        }
    return wf


def prepare_workflow_clone(
    template: dict[str, Any],
    *,
    org_name: str,
    org_slug: str,
    automation_credential_id: str | None = None,
) -> dict[str, Any]:
    wf = _rename_workflow(template, org_name)
    wf = _prefix_webhook_paths(wf, org_slug)
    wf = _regenerate_node_ids(wf)
    wf = _strip_credentials(wf)
    wf = _inject_loomrun_llm_config(
        wf,
        org_slug=_safe_slug(org_slug),
        automation_credential_id=automation_credential_id,
    )
    return wf


def _extract_webhook_path(workflow: dict[str, Any]) -> str | None:
    for node in workflow.get("nodes", []):
        if node.get("type") == "n8n-nodes-base.webhook":
            return node.get("parameters", {}).get("path")
    return None


async def provision_org_workflows(
    *,
    organization_id: str,
    organization_slug: str,
    organization_name: str,
    sender_email: str,
) -> dict[str, Any]:
    if not n8n_client.configured:
        raise N8nApiError(
            "n8n provisioning is not configured. Set N8N_API_URL and N8N_API_KEY in .env"
        )

    slug = _safe_slug(organization_slug)
    automation_key = _validate_automation_key(settings.loomrun_automation_api_key)
    automation_credential_id = await n8n_client.ensure_automation_credential(automation_key)

    created: list[dict[str, Any]] = []
    primary_webhook_path: str | None = None

    for template, key, _has_webhook in _load_workflow_templates():
        clone = prepare_workflow_clone(
            template,
            org_name=organization_name,
            org_slug=slug,
            automation_credential_id=automation_credential_id,
        )
        result = await n8n_client.create_workflow(clone)
        workflow_id = str(result.get("id", ""))
        if not workflow_id:
            raise N8nApiError(f"n8n did not return workflow id for template {key}")

        activated = await n8n_client.try_activate_workflow(workflow_id)

        webhook_path = _extract_webhook_path(clone)

        created.append({
            "template": key,
            "n8n_id": workflow_id,
            "name": clone["name"],
            "webhook_path": webhook_path,
            "editor_url": n8n_client.workflow_editor_url(workflow_id),
            "active": activated,
        })

        if key == "gmail-send" and webhook_path:
            primary_webhook_path = webhook_path

    if not primary_webhook_path:
        for entry in created:
            if entry.get("webhook_path"):
                primary_webhook_path = entry["webhook_path"]
                break

    if not primary_webhook_path:
        raise N8nApiError("No webhook workflow was provisioned for this org")

    return {
        "organization_id": organization_id,
        "organization_slug": slug,
        "sender_email": sender_email,
        "webhook_path": primary_webhook_path,
        "workflows": created,
    }


async def teardown_org_workflows(workflows: list[dict[str, Any]]) -> None:
    if not n8n_client.configured:
        return
    for wf in workflows:
        wf_id = wf.get("n8n_id")
        if not wf_id:
            continue
        try:
            await n8n_client.deactivate_workflow(str(wf_id))
            await n8n_client.delete_workflow(str(wf_id))
        except N8nApiError:
            logger.exception("Failed to delete n8n workflow %s", wf_id)
