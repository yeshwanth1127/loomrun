"""Assemble a lighter org + Loomrun knowledge pack for the AI agent.

Mutable facts (specific leads, quotes) should come from tools; this pack is a snapshot summary.
"""

from __future__ import annotations

from pathlib import Path

from loomrun_api.prisma_client import prisma
from prisma.enums import LeadStage

_LOOMRUN_MD = Path(__file__).with_name("loomrun_knowledge.md")

_BUDGET = {
    "minimal": 4000,
    "advanced": 7000,
}


def _load_loomrun_docs() -> str:
    try:
        return _LOOMRUN_MD.read_text(encoding="utf-8").strip()
    except OSError:
        return "Loomrun is a manufacturing CRM and operations platform."


def _clip(text: str, budget: int) -> str:
    if len(text) <= budget:
        return text
    return text[: budget - 20].rstrip() + "\n…(truncated)"


async def build_knowledge_pack(*, organization_id: str, mode: str) -> str:
    budget = _BUDGET.get(mode, _BUDGET["minimal"])
    org = await prisma.organization.find_unique(where={"id": organization_id})
    if not org:
        return _load_loomrun_docs()

    members = await prisma.membership.find_many(
        where={"organizationId": organization_id},
        include={"user": True},
        take=20,
    )
    catalog = await prisma.catalogitem.find_many(
        where={"organizationId": organization_id},
        take=15 if mode == "advanced" else 8,
        order={"updatedAt": "desc"},
    )
    lead_take = 12 if mode == "advanced" else 8
    lead_total = await prisma.lead.count(where={"organizationId": organization_id})
    # Newest-created first, so the sample's own order matches what "recent"
    # means to the user. Ordering by updatedAt put an old lead that happened to
    # be edited at the top and made this block actively misleading.
    leads = await prisma.lead.find_many(
        where={"organizationId": organization_id},
        take=lead_take,
        order={"createdAt": "desc"},
    )
    stage_counts: dict[str, int] = {}
    for stage in LeadStage:
        n = await prisma.lead.count(
            where={"organizationId": organization_id, "stage": stage},
        )
        if n:
            stage_counts[stage.name] = n

    lines: list[str] = [
        f"## Organization: {org.name}",
        f"Slug: {org.slug}",
        f"Plan: {org.plan}",
        f"Legal name: {org.brandLegalName or '—'}",
        f"Phone: {org.brandPhone or '—'}",
        f"Email: {org.brandEmail or '—'}",
        "",
        "## Team (use list_team_members for full list / ids)",
    ]
    for m in members:
        role = m.role.name if hasattr(m.role, "name") else str(m.role)
        email = m.user.email if m.user else "?"
        name = (m.user.name if m.user else None) or ""
        lines.append(f"- {email} ({name}) id={m.userId} — {role}")

    lines.append("")
    lines.append(f"## Lead pipeline counts (total {lead_total})")
    if stage_counts:
        for stage, count in sorted(stage_counts.items()):
            lines.append(f"- {stage}: {count}")
    else:
        lines.append("- No leads")

    lines.append("")
    lines.append(
        f"## Recent leads (sample of {len(leads)} of {lead_total}, newest created first)"
    )
    lines.append(
        "This is a truncated sample, not the roster. Do NOT answer 'how many' from it "
        "— call count_leads. Do NOT name the latest/newest lead from it — call "
        "search_leads with sort='newest', limit=1. Each line carries its creation "
        "date so the order never has to be guessed."
    )
    for lead in leads:
        stage = getattr(lead.stage, "name", None) or str(lead.stage)
        created = lead.createdAt.strftime("%Y-%m-%d %H:%M") if lead.createdAt else "unknown"
        lines.append(
            f"- created {created} | id={lead.id} [{stage}] {lead.title}"
            + (f" | {lead.company}" if lead.company else "")
        )

    lines.append("")
    lines.append("## Catalog sample (use list_catalog for more)")
    if catalog:
        for c in catalog:
            sku = f" ({c.sku})" if c.sku else ""
            lines.append(f"- {c.name}{sku}: ₹{c.unitPrice}")
    else:
        lines.append("- No catalog items")

    org_block = "\n".join(lines)
    loomrun = _load_loomrun_docs()

    loomrun_budget = max(1000, int(budget * 0.4))
    org_budget = budget - loomrun_budget
    return (
        "# Organization knowledge\n"
        + _clip(org_block, org_budget)
        + "\n\n# Loomrun knowledge\n"
        + _clip(loomrun, loomrun_budget)
    )
