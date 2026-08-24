"""Default WhatsApp message templates seeded per organization.

Each org starts with one ready-to-use template per category. Users can edit
these, delete them, or add their own. Bodies may contain `{name}`, `{company}`
and `{org}` placeholders that are substituted with lead/org details when a
template is applied in the composer.
"""

from __future__ import annotations

from prisma.enums import WhatsAppTemplateCategory

# Ordered list of categories with human labels for the UI.
TEMPLATE_CATEGORIES: list[tuple[str, str]] = [
    ("GREETING", "Greeting"),
    ("QUOTATION", "Quotation"),
    ("INVOICE", "Invoice"),
    ("FOLLOW_UP", "Follow-up"),
    ("THANK_YOU", "Thank you"),
]

DEFAULT_TEMPLATES: list[dict[str, str]] = [
    {
        "category": "GREETING",
        "name": "Welcome greeting",
        "body": "Hi {name}, greetings from {org}! Thanks for getting in touch. How can we help you today?",
    },
    {
        "category": "QUOTATION",
        "name": "Quotation shared",
        "body": "Hi {name}, please find your quotation from {org} attached. Do let us know if you'd like to proceed or have any questions.",
    },
    {
        "category": "INVOICE",
        "name": "Invoice shared",
        "body": "Hi {name}, please find your invoice attached. Kindly clear the pending balance at your convenience. Thank you for your business!",
    },
    {
        "category": "FOLLOW_UP",
        "name": "Quotation follow-up",
        "body": "Hi {name}, just following up on the quotation we shared. Please let us know if you have any questions — we're happy to help!",
    },
    {
        "category": "THANK_YOU",
        "name": "Thank you",
        "body": "Hi {name}, thank you for choosing {org}! It was a pleasure working with you, and we look forward to serving you again.",
    },
]


async def seed_org_whatsapp_templates(db, org_id: str) -> None:
    """Create one default template per category for a fresh organization."""
    for tmpl in DEFAULT_TEMPLATES:
        await db.whatsapptemplate.create(
            data={
                "organizationId": org_id,
                "category": WhatsAppTemplateCategory[tmpl["category"]],
                "name": tmpl["name"],
                "body": tmpl["body"],
                "isDefault": True,
            }
        )


async def backfill_org_whatsapp_templates(db, org_id: str) -> None:
    """Seed defaults only if the org has no templates yet."""
    count = await db.whatsapptemplate.count(where={"organizationId": org_id})
    if count == 0:
        await seed_org_whatsapp_templates(db, org_id)
