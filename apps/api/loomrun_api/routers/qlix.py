"""Activation, sync status and Brain documents for an org's Qlix agent."""

from __future__ import annotations

import logging
import re
import secrets

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from loomrun_api.config import settings
from loomrun_api.deps import OrgContext, get_org_context, require_roles
from loomrun_api.prisma_client import prisma
from loomrun_api.qlix import client as qlix
from loomrun_api.qlix import connection as conn
from loomrun_api.qlix import provisioner, sync

logger = logging.getLogger(__name__)

router = APIRouter()

# Formats worth indexing. Anything Qlix cannot extract text from is only noise
# in a knowledge base, so we reject it here rather than storing a dead file.
_ALLOWED_DOC_TYPES = {
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/csv": ".csv",
}
_MAX_DOC_BYTES = 25 * 1024 * 1024


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", (name or "").strip())[:120]
    return cleaned or "document"


def _document_item(row) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "file_name": row.fileName,
        "mime_type": row.mimeType,
        "size_bytes": row.sizeBytes,
        "status": row.status,
        "last_error": row.lastError,
        "created_at": row.createdAt.isoformat() if row.createdAt else None,
    }


# ── Connection ────────────────────────────────────────────────────────────────

@router.get("/orgs/{org_id}/qlix/status")
async def qlix_status(ctx: OrgContext = Depends(get_org_context)) -> dict:
    row = await conn.get_connection(ctx.organization_id)
    state = conn.public_state(row)
    state["configured"] = settings.qlix_ready
    if row and row.status == conn.STATUS_CONNECTED:
        state["sync"] = await sync.sync_progress(ctx.organization_id)
        # Flip the backfill flag the moment the initial load has drained, so
        # the UI can stop showing "still importing".
        await provisioner.mark_backfill_complete_if_drained(ctx.organization_id)
    return state


@router.post("/orgs/{org_id}/qlix/activate")
async def qlix_activate(ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    """One-click activation. The user supplies nothing."""
    if not settings.qlix_ready:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI agents are not configured on this server yet.",
        )
    try:
        return await provisioner.activate(organization_id=ctx.organization_id)
    except provisioner.ProvisionError as exc:
        # Never return 502 — Cloudflare in front of Loomrun treats origin 502
        # as a broken origin and replaces the JSON with an Error 520 page.
        message = str(exc)
        code = (
            status.HTTP_503_SERVICE_UNAVAILABLE
            if "could not reach qlix" in message.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(code, detail=message) from exc


@router.post("/orgs/{org_id}/qlix/deactivate")
async def qlix_deactivate(ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    return await provisioner.deactivate(ctx.organization_id)


@router.post("/orgs/{org_id}/qlix/resync")
async def qlix_resync(ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    """Force a full re-push of this org's data."""
    return await sync.sweep_org(ctx.organization_id, since=None)


@router.post("/orgs/{org_id}/qlix/resync-tools")
async def qlix_resync_tools(ctx: OrgContext = Depends(require_roles("OWNER"))) -> dict:
    """Re-apply per-tool approval rules on the org's agent.

    Repairs an agent whose read tools were left requiring approval — they hang
    waiting for a confirmation the user is never asked for.
    """
    return await provisioner.resync_tool_governance(ctx.organization_id)


# ── Documents the user uploads ────────────────────────────────────────────────

@router.get("/orgs/{org_id}/qlix/documents")
async def list_qlix_documents(ctx: OrgContext = Depends(get_org_context)) -> dict:
    rows = await prisma.qlixdocument.find_many(
        where={"organizationId": ctx.organization_id}, order={"createdAt": "desc"}
    )
    return {"items": [_document_item(r) for r in rows], "count": len(rows)}


@router.post("/orgs/{org_id}/qlix/documents", status_code=status.HTTP_201_CREATED)
async def upload_qlix_document(
    ctx: OrgContext = Depends(require_roles("OWNER")),
    file: UploadFile = File(...),
) -> dict:
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = _ALLOWED_DOC_TYPES.get(ctype)
    if not ext:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Upload a PDF, Word, Excel, CSV, Markdown or text file.",
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="That file is empty.")
    if len(raw) > _MAX_DOC_BYTES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Documents must be 25MB or smaller."
        )

    try:
        connection, api_key = await conn.require_api_key(ctx.organization_id)
    except conn.NotConnectedError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Activate the AI agent before adding documents.",
        ) from exc

    org_id = ctx.organization_id
    file_name = _safe_name(file.filename or f"document{ext}")
    title = file_name.rsplit(".", 1)[0].replace("_", " ")[:200] or "Document"
    # A random suffix keeps two uploads of the same filename apart, both on
    # disk and as separate Brain documents.
    external_id = f"loomrun:upload:{secrets.token_urlsafe(9)}"

    dest_dir = settings.storage_dir / org_id / "qlix"
    dest_dir.mkdir(parents=True, exist_ok=True)
    rel = f"{org_id}/qlix/{external_id.rsplit(':', 1)[-1]}_{file_name}"
    (settings.storage_dir / rel).write_bytes(raw)

    row = await prisma.qlixdocument.create(
        data={
            "organizationId": org_id,
            "userId": ctx.membership.userId,
            "title": title,
            "fileName": file_name,
            "mimeType": ctype,
            "sizeBytes": len(raw),
            "storagePath": rel,
            "externalId": external_id,
            "status": "uploading",
        }
    )

    # Hand Qlix the raw file — it extracts and chunks better than we would.
    try:
        result = await qlix.upload_document_file(
            api_key,
            collection_id=connection.collectionId or "",
            file_name=file_name,
            content=raw,
            mime_type=ctype,
            title=title,
            external_id=external_id,
        )
    except qlix.QlixError as exc:
        await prisma.qlixdocument.update(
            where={"id": row.id},
            data={"status": "failed", "lastError": str(exc)[:2000]},
        )
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    row = await prisma.qlixdocument.update(
        where={"id": row.id},
        data={
            "qlixDocumentId": result.get("id"),
            "status": result.get("ingestStatus") or "pending",
        },
    )
    return _document_item(row)


@router.get("/orgs/{org_id}/qlix/documents/{document_id}")
async def get_qlix_document(
    document_id: str, ctx: OrgContext = Depends(get_org_context)
) -> dict:
    row = await prisma.qlixdocument.find_first(
        where={"id": document_id, "organizationId": ctx.organization_id}
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document not found")

    # Indexing is asynchronous, so refresh from Qlix while it is still pending.
    if row.status == "pending" and row.qlixDocumentId:
        try:
            _, api_key = await conn.require_api_key(ctx.organization_id)
            remote = await qlix.get_document(api_key, row.qlixDocumentId)
            remote_status = remote.get("ingestStatus")
            if remote_status and remote_status != row.status:
                row = await prisma.qlixdocument.update(
                    where={"id": row.id}, data={"status": remote_status}
                )
        except (conn.NotConnectedError, qlix.QlixError):
            # Status stays pending; the next poll tries again.
            logger.debug("Could not refresh Qlix document %s", document_id)

    return _document_item(row)


@router.delete(
    "/orgs/{org_id}/qlix/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_qlix_document(
    document_id: str, ctx: OrgContext = Depends(require_roles("OWNER"))
) -> None:
    row = await prisma.qlixdocument.find_first(
        where={"id": document_id, "organizationId": ctx.organization_id}
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document not found")

    try:
        _, api_key = await conn.require_api_key(ctx.organization_id)
        await qlix.delete_document_by_external_id(api_key, row.externalId)
    except conn.NotConnectedError:
        pass
    except qlix.QlixError as exc:
        if exc.status_code != 404:
            # Refuse rather than leave the agent citing a document the user
            # believes they deleted.
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    stored = settings.storage_dir / row.storagePath
    try:
        stored.unlink(missing_ok=True)
    except OSError:
        logger.warning("Could not remove stored document %s", row.storagePath)

    await prisma.qlixdocument.delete(where={"id": row.id})
