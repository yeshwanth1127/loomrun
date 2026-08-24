"""
Dynamic email content per trigger kind.

Each trigger (quotation send, invoice send, …) maps to a builder that turns an
`EmailContext` into a subject + body. Add a new kind by writing a builder and
registering it in `EMAIL_TEMPLATES` — no changes needed at the call sites.
"""

from collections.abc import Callable
from dataclasses import dataclass, field


@dataclass
class EmailContext:
    lead_title: str
    org_name: str | None = None
    document_number: str | None = None
    total: float | None = None
    extra: dict = field(default_factory=dict)


@dataclass
class EmailContent:
    subject: str
    body: str


def _signoff(ctx: EmailContext) -> str:
    return ctx.org_name or "our team"


def _quotation_email(ctx: EmailContext) -> EmailContent:
    total = f"₹{ctx.total:,.2f}" if ctx.total is not None else "—"
    return EmailContent(
        subject=f"Quotation {ctx.document_number}",
        body=(
            f"Hi {ctx.lead_title},\n\n"
            f"Please find your quotation {ctx.document_number} attached.\n"
            f"Total: {total}\n\n"
            f"Let us know if you'd like to proceed or have any questions.\n\n"
            f"Thanks,\n{_signoff(ctx)}"
        ),
    )


def _invoice_email(ctx: EmailContext) -> EmailContent:
    total = f"₹{ctx.total:,.2f}" if ctx.total is not None else "—"
    return EmailContent(
        subject=f"Invoice {ctx.document_number}",
        body=(
            f"Hi {ctx.lead_title},\n\n"
            f"Please find your invoice {ctx.document_number} attached.\n"
            f"Amount due: {total}\n\n"
            f"Thank you for your business.\n\n"
            f"Thanks,\n{_signoff(ctx)}"
        ),
    )


def _generic_email(ctx: EmailContext) -> EmailContent:
    """Fallback for kinds without a dedicated template."""
    return EmailContent(
        subject=ctx.extra.get("subject", "A message from your team"),
        body=ctx.extra.get(
            "body",
            f"Hi {ctx.lead_title},\n\n{ctx.extra.get('message', '')}\n\nThanks,\n{_signoff(ctx)}",
        ),
    )


# Registry: trigger kind → builder. Extend this to add new email types.
EMAIL_TEMPLATES: dict[str, Callable[[EmailContext], EmailContent]] = {
    "quotation": _quotation_email,
    "invoice": _invoice_email,
    "generic": _generic_email,
}

DEFAULT_KIND = "quotation"


def build_email_content(kind: str, ctx: EmailContext) -> EmailContent:
    """Return subject + body for a trigger kind, falling back to the default."""
    builder = EMAIL_TEMPLATES.get(kind) or EMAIL_TEMPLATES[DEFAULT_KIND]
    return builder(ctx)
