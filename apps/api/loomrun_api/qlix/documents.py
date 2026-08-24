"""Render Loomrun records as AI Brain documents.

One document per record rather than one big dump. That is what makes Qlix's
replace-by-``externalId`` upsert useful: editing a lead replaces exactly that
lead's document and nothing else, and a citation points at a single record the
user can go and open.

External IDs are stable and namespaced (``loomrun:lead:<id>``) so re-ingesting
overwrites instead of accumulating duplicates.
"""

from __future__ import annotations

from collections import Counter
from decimal import Decimal
from typing import Any

from loomrun_api.prisma_client import prisma

# Entity types the sync queue understands.
ENTITY_LEAD = "lead"
ENTITY_QUOTATION = "quotation"
ENTITY_PRODUCTION = "production_order"
ENTITY_CATALOG = "catalog_item"
ENTITY_EXPENSE = "expense"
ENTITY_ORG_PROFILE = "org_profile"
ENTITY_TEAM = "team"
ENTITY_PIPELINE = "pipeline"
ENTITY_MEMORY = "memory"

# Rollups are rebuilt wholesale, so they use a fixed entity id.
SUMMARY_KEY = "summary"
SUMMARY_ENTITIES = (ENTITY_ORG_PROFILE, ENTITY_TEAM, ENTITY_PIPELINE, ENTITY_MEMORY)

# Per-record entities, in the order a first-time backfill should load them:
# org context first so early questions have something to stand on.
RECORD_ENTITIES = (
    ENTITY_CATALOG,
    ENTITY_LEAD,
    ENTITY_QUOTATION,
    ENTITY_PRODUCTION,
    ENTITY_EXPENSE,
)


def external_id(entity_type: str, entity_id: str) -> str:
    return f"loomrun:{entity_type}:{entity_id}"


def _enum(value: Any) -> str:
    return getattr(value, "name", None) or (str(value) if value is not None else "")


def _money(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, Decimal):
        return f"{value:,.2f}"
    return f"{float(value):,.2f}"


def _cents(value: int | None) -> str:
    return "—" if value is None else f"{value / 100:,.2f}"


def _date(value: Any) -> str:
    return value.date().isoformat() if value else "—"


def _line(label: str, value: Any) -> str | None:
    """Skip empty fields — blank labels are noise that dilutes retrieval."""
    if value in (None, "", "—", []):
        return None
    return f"- {label}: {value}"


def _join(parts: list[str | None]) -> str:
    return "\n".join(p for p in parts if p)


# ── Per-record renderers ──────────────────────────────────────────────────────

async def render_lead(organization_id: str, lead_id: str) -> dict[str, str] | None:
    lead = await prisma.lead.find_first(
        where={"id": lead_id, "organizationId": organization_id},
        include={"assignee": True, "quotations": True, "production": True},
    )
    if not lead:
        return None

    stage = _enum(lead.stage)
    title = f"Lead — {lead.title}" + (f" ({lead.company})" if lead.company else "")
    assignee = lead.assignee.email if lead.assignee else None

    body = _join([
        f"# {title}",
        "",
        _line("Lead id", lead.id),
        _line("Stage", stage),
        _line("Status", _enum(lead.leadStatus)),
        _line("Source", _enum(lead.source)),
        _line("Source detail", lead.sourceDetail),
        _line("Company", lead.company),
        _line("Contact phone", lead.phone),
        _line("Contact email", lead.email),
        _line("City", lead.city),
        _line("Product interest", lead.productInterest),
        _line("Quantity estimate", lead.quantityEstimate),
        _line("Estimated value", _money(lead.estimatedValue) if lead.estimatedValue else None),
        _line("Lead score", lead.leadScore),
        _line("Assigned to", assignee),
        _line("Next follow-up", _date(lead.nextFollowUpAt)),
        _line("Last activity", _date(lead.lastActivityAt)),
        _line("Tags", ", ".join(lead.tags) if lead.tags else None),
        _line("Created", _date(lead.createdAt)),
        "",
        f"## Notes\n{lead.notes}" if lead.notes else None,
        "",
        _quotation_lines(lead.quotations),
        _production_line(lead.production),
    ])

    return {"title": title, "body": body, "external_id": external_id(ENTITY_LEAD, lead.id)}


def _quotation_lines(quotations: list[Any] | None) -> str | None:
    if not quotations:
        return None
    rows = [
        f"- {q.number}: {_enum(q.status)}, total {_money(q.total)}"
        + (f", invoice {q.invoiceNumber}" if q.invoiceNumber else "")
        for q in quotations
    ]
    return "## Quotations\n" + "\n".join(rows)


def _production_line(production: Any | None) -> str | None:
    if not production:
        return None
    flag = " (flagged as delayed)" if production.delayFlag else ""
    return f"## Production\n- Stage: {_enum(production.stage)}{flag}"


async def render_quotation(organization_id: str, quotation_id: str) -> dict[str, str] | None:
    q = await prisma.quotation.find_first(
        where={"id": quotation_id, "organizationId": organization_id},
        include={"lines": True, "lead": True, "author": True},
    )
    if not q:
        return None

    is_invoice = bool(q.invoiceNumber)
    kind = "Invoice" if is_invoice else "Quotation"
    number = q.invoiceNumber or q.number
    title = f"{kind} {number}" + (f" — {q.lead.title}" if q.lead else "")

    line_rows = [
        f"- {ln.description}: {ln.quantity} x {_money(ln.unitPrice)} = {_money(ln.lineTotal)}"
        for ln in (q.lines or [])
    ]

    body = _join([
        f"# {title}",
        "",
        _line("Quotation number", q.number),
        _line("Invoice number", q.invoiceNumber),
        _line("Status", _enum(q.status)),
        _line("Version", q.version),
        _line("Lead", f"{q.lead.title} (id={q.leadId})" if q.lead else None),
        _line("Prepared by", q.author.email if q.author else None),
        _line("Subtotal", _money(q.subtotal)),
        _line("Tax", _money(q.tax)),
        _line("Total", _money(q.total)),
        _line("Sent", _date(q.sentAt)),
        _line("Invoiced", _date(q.invoicedAt)),
        _line("Created", _date(q.createdAt)),
        "",
        ("## Line items\n" + "\n".join(line_rows)) if line_rows else None,
    ])

    return {
        "title": title,
        "body": body,
        "external_id": external_id(ENTITY_QUOTATION, q.id),
    }


async def render_production_order(
    organization_id: str, order_id: str
) -> dict[str, str] | None:
    order = await prisma.productionorder.find_first(
        where={"id": order_id, "organizationId": organization_id},
        include={"lead": True, "quotation": True},
    )
    if not order:
        return None

    name = order.name or (order.lead.title if order.lead else order.id)
    title = f"Production order — {name}"

    body = _join([
        f"# {title}",
        "",
        _line("Order id", order.id),
        _line("Stage", _enum(order.stage)),
        _line("Delayed", "yes" if order.delayFlag else None),
        _line("Lead", f"{order.lead.title} (id={order.leadId})" if order.lead else None),
        _line("Quotation", order.quotation.number if order.quotation else None),
        _line("Budget", _cents(order.budgetCents)),
        _line("Entered current stage", _date(order.stageEnteredAt)),
        _line("Created", _date(order.createdAt)),
    ])

    return {
        "title": title,
        "body": body,
        "external_id": external_id(ENTITY_PRODUCTION, order.id),
    }


async def render_catalog_item(organization_id: str, item_id: str) -> dict[str, str] | None:
    item = await prisma.catalogitem.find_first(
        where={"id": item_id, "organizationId": organization_id}
    )
    if not item:
        return None

    title = f"Catalog item — {item.name}"
    body = _join([
        f"# {title}",
        "",
        _line("Item id", item.id),
        _line("SKU", item.sku),
        _line("Unit price", _money(item.unitPrice)),
        "",
        f"## Description\n{item.description}" if item.description else None,
    ])
    return {
        "title": title,
        "body": body,
        "external_id": external_id(ENTITY_CATALOG, item.id),
    }


async def render_expense(organization_id: str, expense_id: str) -> dict[str, str] | None:
    exp = await prisma.expense.find_first(
        where={"id": expense_id, "organizationId": organization_id},
        include={"lead": True, "productionOrder": True},
    )
    if not exp:
        return None

    title = f"Expense — {_enum(exp.category)} {_cents(exp.amountCents)}"
    body = _join([
        f"# {title}",
        "",
        _line("Expense id", exp.id),
        _line("Category", _enum(exp.category)),
        _line("Subcategory", getattr(exp, "subcategory", None)),
        _line("Amount", _cents(exp.amountCents)),
        _line("Vendor", exp.vendor),
        _line("Incurred", _date(exp.incurredAt)),
        _line("Lead", exp.lead.title if exp.lead else None),
        _line(
            "Production order",
            exp.productionOrder.name or exp.productionOrderId if exp.productionOrder else None,
        ),
        "",
        f"## Description\n{exp.description}" if exp.description else None,
    ])
    return {
        "title": title,
        "body": body,
        "external_id": external_id(ENTITY_EXPENSE, exp.id),
    }


# ── Rollup renderers ──────────────────────────────────────────────────────────

async def render_org_profile(organization_id: str) -> dict[str, str] | None:
    org = await prisma.organization.find_unique(where={"id": organization_id})
    if not org:
        return None

    title = f"Organization profile — {org.name}"
    body = _join([
        f"# {title}",
        "",
        _line("Name", org.name),
        _line("Legal name", org.brandLegalName),
        _line("Plan", org.plan),
        _line("Phone", org.brandPhone),
        _line("Email", org.brandEmail),
        _line("Website", org.brandWebsite),
        _line("Address", org.brandAddress),
        _line("Tax id", org.brandTaxId),
        _line("Bank", org.brandBankName),
        _line("Bank branch", org.brandBankBranch),
    ])
    return {
        "title": title,
        "body": body,
        "external_id": external_id(ENTITY_ORG_PROFILE, SUMMARY_KEY),
    }


async def render_team(organization_id: str) -> dict[str, str] | None:
    members = await prisma.membership.find_many(
        where={"organizationId": organization_id}, include={"user": True}
    )
    org = await prisma.organization.find_unique(where={"id": organization_id})
    if not org:
        return None

    rows = []
    for m in members:
        email = m.user.email if m.user else "?"
        name = (m.user.name if m.user else None) or ""
        rows.append(f"- {email} ({name}) id={m.userId} — {_enum(m.role)}")

    title = f"Team — {org.name}"
    body = _join([
        f"# {title}",
        "",
        f"{len(members)} member(s).",
        "",
        "\n".join(rows) if rows else "- No members",
    ])
    return {
        "title": title,
        "body": body,
        "external_id": external_id(ENTITY_TEAM, SUMMARY_KEY),
    }


async def render_pipeline(organization_id: str) -> dict[str, str] | None:
    org = await prisma.organization.find_unique(where={"id": organization_id})
    if not org:
        return None

    leads = await prisma.lead.find_many(where={"organizationId": organization_id})
    stage_counts = Counter(_enum(lead.stage) for lead in leads)
    status_counts = Counter(_enum(lead.leadStatus) for lead in leads)

    quotations = await prisma.quotation.find_many(
        where={"organizationId": organization_id}
    )
    quote_counts = Counter(_enum(q.status) for q in quotations)
    invoiced = sum(1 for q in quotations if q.invoiceNumber)
    total_quoted = sum((q.total for q in quotations), Decimal(0))

    orders = await prisma.productionorder.find_many(
        where={"organizationId": organization_id}
    )
    prod_counts = Counter(_enum(o.stage) for o in orders)
    delayed = sum(1 for o in orders if o.delayFlag)

    title = f"Pipeline summary — {org.name}"
    body = _join([
        f"# {title}",
        "",
        "Counts across the whole organization. Use the CRM tools for live "
        "detail on any individual record.",
        "",
        f"## Leads ({len(leads)} total)",
        *[f"- {stage}: {count}" for stage, count in sorted(stage_counts.items())],
        "",
        "### Lead status",
        *[f"- {s}: {c}" for s, c in sorted(status_counts.items())],
        "",
        f"## Quotations ({len(quotations)} total, {invoiced} invoiced)",
        *[f"- {s}: {c}" for s, c in sorted(quote_counts.items())],
        f"- Total value quoted: {_money(total_quoted)}",
        "",
        f"## Production ({len(orders)} orders, {delayed} flagged delayed)",
        *[f"- {s}: {c}" for s, c in sorted(prod_counts.items())],
    ])
    return {
        "title": title,
        "body": body,
        "external_id": external_id(ENTITY_PIPELINE, SUMMARY_KEY),
    }


async def render_memory(organization_id: str) -> dict[str, str] | None:
    """Mirror Loomrun's own org memory into the Brain.

    Memory stays authoritative in Loomrun — this is a copy so the agent can
    retrieve it, not a migration.
    """
    from loomrun_api.ai_agent.memory import get_org_memory

    memory = await get_org_memory(organization_id)
    summary = (memory.get("summary") or "").strip()
    facts = memory.get("facts") or {}
    if not summary and not facts:
        return None

    title = "Organization memory"
    body = _join([
        f"# {title}",
        "",
        "Durable facts learned from earlier conversations with this org.",
        "",
        summary or None,
        "",
        "## Facts",
        *[f"- {k}: {v}" for k, v in sorted(facts.items())],
    ])
    return {
        "title": title,
        "body": body,
        "external_id": external_id(ENTITY_MEMORY, SUMMARY_KEY),
    }


_RECORD_RENDERERS = {
    ENTITY_LEAD: render_lead,
    ENTITY_QUOTATION: render_quotation,
    ENTITY_PRODUCTION: render_production_order,
    ENTITY_CATALOG: render_catalog_item,
    ENTITY_EXPENSE: render_expense,
}

_SUMMARY_RENDERERS = {
    ENTITY_ORG_PROFILE: render_org_profile,
    ENTITY_TEAM: render_team,
    ENTITY_PIPELINE: render_pipeline,
    ENTITY_MEMORY: render_memory,
}


async def render(
    *, organization_id: str, entity_type: str, entity_id: str
) -> dict[str, str] | None:
    """Render one queued item. ``None`` means the record no longer exists."""
    if entity_type in _SUMMARY_RENDERERS:
        return await _SUMMARY_RENDERERS[entity_type](organization_id)
    renderer = _RECORD_RENDERERS.get(entity_type)
    if not renderer:
        return None
    return await renderer(organization_id, entity_id)
