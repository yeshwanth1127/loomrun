import logging
import re

import httpx

from loomrun_api.config import settings

logger = logging.getLogger(__name__)
GRAPH_API = "https://graph.facebook.com/v20.0"


def _normalize_phone(phone: str) -> str:
    """Strip non-digits; prepend India country code if 10-digit."""
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        digits = "91" + digits
    return digits


async def send_whatsapp_text(to_phone: str, message: str) -> bool:
    """Send a plain-text WhatsApp message via Meta Cloud API. Returns True on success."""
    if not settings.whatsapp_access_token or not settings.whatsapp_phone_number_id:
        logger.warning("WhatsApp not configured (missing token or phone_number_id) — skipped send to %s", to_phone)
        return False

    phone = _normalize_phone(to_phone)
    if len(phone) < 10:
        logger.warning("WhatsApp send skipped — invalid phone '%s'", to_phone)
        return False

    url = f"{GRAPH_API}/{settings.whatsapp_phone_number_id}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "text",
        "text": {"body": message, "preview_url": False},
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {settings.whatsapp_access_token}"},
            )
        if resp.status_code == 200:
            logger.info("WhatsApp sent to %s", phone)
            return True
        logger.warning("WhatsApp API %s: %s", resp.status_code, resp.text[:300])
        return False
    except Exception as exc:
        logger.error("WhatsApp send error: %s", exc)
        return False
