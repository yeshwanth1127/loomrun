import logging
import os
import tempfile
from datetime import datetime, timezone

from fastapi import HTTPException, status

from prisma import Prisma

from loomrun_api import baileys_client
from loomrun_api.config import settings
from loomrun_api.email_templates import EmailContext, build_email_content
from loomrun_api.prisma_client import prisma
from loomrun_api.prisma_json import json_meta

logger = logging.getLogger(__name__)

def _payload(data: dict):
    return json_meta(data)
from prisma.enums import LeadActivityType, LeadStage, OutboundChannel, OutboundMessageStatus

STAGE_ORDER = [
    LeadStage.NEW,
    LeadStage.CONTACTED,
    LeadStage.QUALIFICATION,
    LeadStage.QUOTATION,
    LeadStage.NEGOTIATION,
    LeadStage.SAMPLE,
    LeadStage.WON,
    LeadStage.LOST,
]


def _stage_rank(stage: LeadStage) -> int:
    try:
        return STAGE_ORDER.index(stage)
    except ValueError:
        return -1


def build_quotation_message(*, lead_title: str, number: str, total: float, org_name: str | None) -> str:
    org = org_name or "our team"
    return (
        f"Hi {lead_title},\n\n"
        f"Your quotation {number} is ready.\n"
        f"Total: ₹{total:,.2f}\n\n"
        f"Please log in to view and download the PDF.\n\n"
        f"Thanks,\n{org}"
    )


async def advance_lead_to_quotation(
    *,
    lead_id: str,
    user_id: str | None,
    quotation_number: str,
    channel: str,
    doc_type: str = "quotation",
) -> LeadStage:
    lead = await prisma.lead.find_unique(where={"id": lead_id})
    if not lead:
        return LeadStage.QUOTATION
    now = datetime.now(timezone.utc)
    channel_label = "WhatsApp" if channel == "whatsapp" else "Email"
    doc_label = "Invoice" if doc_type == "invoice" else "Quotation"

    if lead.stage in (LeadStage.WON, LeadStage.LOST):
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": user_id,
                "type": LeadActivityType.SYSTEM,
                "body": f"{doc_label} {quotation_number} sent via {channel_label} (stage unchanged)",
            }
        )
        await prisma.lead.update(where={"id": lead_id}, data={"lastActivityAt": now})
        return lead.stage

    target = LeadStage.QUOTATION
    if _stage_rank(lead.stage) < _stage_rank(target):
        await prisma.lead.update(
            where={"id": lead_id},
            data={"stage": target, "lastActivityAt": now},
        )
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": user_id,
                "type": LeadActivityType.STAGE_CHANGE,
                "body": f"Moved to Quoted — {doc_label.lower()} {quotation_number} sent via {channel_label}",
                "metadata": json_meta({"stage": "QUOTATION", "document_number": quotation_number, "doc_type": doc_type, "channel": channel}),
            },
        )
    else:
        await prisma.lead.update(where={"id": lead_id}, data={"lastActivityAt": now})
        await prisma.leadactivity.create(
            data={
                "leadId": lead_id,
                "userId": user_id,
                "type": LeadActivityType.SYSTEM,
                "body": f"{doc_label} {quotation_number} sent via {channel_label}",
            }
        )
    return target


async def advance_lead_to_negotiation(
    *,
    lead_id: str,
    user_id: str | None,
    quotation_number: str,
) -> LeadStage | None:
    """Move a Quoted lead to Negotiation after its quotation PDF is revised."""
    lead = await prisma.lead.find_unique(where={"id": lead_id})
    if not lead:
        return None
    if lead.stage in (LeadStage.WON, LeadStage.LOST):
        return lead.stage
    if lead.stage != LeadStage.QUOTATION:
        return lead.stage

    now = datetime.now(timezone.utc)
    await prisma.lead.update(
        where={"id": lead_id},
        data={"stage": LeadStage.NEGOTIATION, "lastActivityAt": now},
    )
    await prisma.leadactivity.create(
        data={
            "leadId": lead_id,
            "userId": user_id,
            "type": LeadActivityType.STAGE_CHANGE,
            "body": f"Moved to Negotiation — quotation {quotation_number} revised",
            "metadata": json_meta(
                {"stage": "NEGOTIATION", "document_number": quotation_number, "reason": "quotation_edited"}
            ),
        },
    )
    return LeadStage.NEGOTIATION


async def deliver_quotation(
    *,
    organization_id: str,
    quotation,
    lead,
    org_name: str | None,
    channel: str,
    user_id: str | None,
    doc_type: str = "quotation",
    attachment: tuple[str, bytes] | None = None,
    db: Prisma | None = None,
) -> dict:
    """Deliver a quotation/invoice over the given channel.

    `doc_type` ("quotation" | "invoice" | …) selects the email template and the
    document number used in the message. `attachment` is an optional
    (filename, bytes) PDF prepared by the caller for the right variant.
    """
    client = db or prisma
    document_number = (
        quotation.invoiceNumber if doc_type == "invoice" and quotation.invoiceNumber else quotation.number
    )

    if channel == "whatsapp":
        outbound_channel = OutboundChannel.WHATSAPP
        if not lead.phone:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="This lead has no phone number on file",
            )
        message = build_quotation_message(
            lead_title=lead.title,
            number=document_number,
            total=float(quotation.total),
            org_name=org_name,
        )
        # Use 424 (not 502): Cloudflare rewrites origin 502 bodies into a generic
        # "invalid or incomplete response" page, which hides the real reason.
        sent = await baileys_client.send_text(organization_id, lead.phone, message)
        if not sent:
            detail = sent.error or "WhatsApp is not connected for this organization."
            if "not connected" in detail.lower() or "conflict" in detail.lower():
                detail = (
                    f"{detail} Reconnect WhatsApp in Connectors "
                    "(close other WhatsApp Web sessions if you see a conflict)."
                )
            raise HTTPException(status.HTTP_424_FAILED_DEPENDENCY, detail=detail)
        document_sent = False
        if attachment is not None:
            filename, content = attachment
            document_sent = await _send_whatsapp_document(
                organization_id, lead.phone, filename, content
            )
        payload = {
            "text": message,
            "quotation_id": quotation.id,
            "document_number": document_number,
            "doc_type": doc_type,
            "to": lead.phone,
            "document_sent": document_sent,
        }
        delivery = {"channel": "whatsapp", "to": lead.phone, "document_sent": document_sent}
        status_value = OutboundMessageStatus.SENT
    elif channel == "email":
        outbound_channel = OutboundChannel.EMAIL
        if not lead.email:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="This lead has no email address on file",
            )
        content = build_email_content(
            doc_type,
            EmailContext(
                lead_title=lead.title,
                org_name=org_name,
                document_number=document_number,
                total=float(quotation.total),
            ),
        )
        sent = await _send_document_email(
            organization_id=organization_id,
            quotation=quotation,
            to_email=lead.email,
            subject=content.subject,
            body=content.body,
            attachment=attachment,
        )
        payload = {
            "subject": content.subject,
            "text": content.body,
            "to": lead.email,
            "quotation_id": quotation.id,
            "document_number": document_number,
            "doc_type": doc_type,
            "gmail_message_id": sent.message_id,
            "gmail_thread_id": sent.thread_id,
            "stub": False,
        }
        delivery = {
            "channel": "email",
            "to": lead.email,
            "gmail_message_id": sent.message_id,
            "stub": False,
        }
        status_value = OutboundMessageStatus.SENT
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="channel must be whatsapp or email")

    outbound = await client.outboundmessage.create(
        data={
            "organizationId": organization_id,
            "leadId": lead.id,
            "channel": outbound_channel,
            "payload": _payload(payload),
            "status": status_value,
        }
    )
    delivery["outbound_id"] = outbound.id
    return delivery


async def _send_whatsapp_document(
    organization_id: str,
    phone: str,
    filename: str,
    content: bytes,
) -> bool:
    """Write the PDF to a temp file the sidecar can read, then send it over WhatsApp."""
    tmp = tempfile.NamedTemporaryFile(prefix="loomrun_wa_", suffix=".pdf", delete=False)
    try:
        tmp.write(content)
        tmp.close()
        result = await baileys_client.send_document(
            organization_id, phone, tmp.name, filename, "application/pdf"
        )
        if not result:
            logger.warning(
                "WhatsApp document attach failed org=%s to=%s: %s",
                organization_id,
                phone,
                result.error,
            )
        return bool(result)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


async def _send_document_email(
    *,
    organization_id: str,
    quotation,
    to_email: str,
    subject: str,
    body: str,
    attachment: tuple[str, bytes] | None = None,
):
    """Send the email via the org's connected Gmail, attaching the document PDF.

    Uses the caller-provided `attachment` (correct variant) when present,
    otherwise falls back to the quotation's stored PDF.
    """
    from loomrun_api.gmail_automation import Attachment, send_email

    attachments: list = []
    if attachment is not None:
        filename, content = attachment
        attachments.append(Attachment(filename=filename, content=content, mime_type="application/pdf"))
    elif quotation.pdfUrl:
        pdf_path = settings.storage_dir / quotation.pdfUrl
        if pdf_path.exists():
            attachments.append(
                Attachment(
                    filename=f"{quotation.number}.pdf",
                    content=pdf_path.read_bytes(),
                    mime_type="application/pdf",
                )
            )
        else:
            logger.warning("Quotation PDF missing on disk: %s", pdf_path)

    try:
        return await send_email(
            organization_id,
            to=to_email,
            subject=subject,
            body=body,
            attachments=attachments,
        )
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Gmail is not connected for this organization. Connect Gmail in Integrations to send emails.",
        ) from exc
    except Exception as exc:
        logger.exception("Document email send failed org=%s: %s", organization_id, exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to send email: {exc}",
        ) from exc
