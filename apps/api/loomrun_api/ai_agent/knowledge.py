"""Assemble a light org + Loomrun knowledge pack for the AI agent.

Mutable facts (specific leads, quotes, catalog lines) must come from tools.
This pack is a short identity snapshot so every turn does not re-pay thousands
of prompt tokens for roster samples the model should fetch live.
"""

from __future__ import annotations

from pathlib import Path

from loomrun_api.prisma_client import prisma
from prisma.enums import LeadStage

_LOOMRUN_MD = Path(__file__).with_name("loomrun_knowledge.md")

# Kept intentionally small — tools are the source of truth for live CRM data.
_BUDGET = {
    "minimal": 1800,
    "advanced": 2200,
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
        return _clip(_load_loomrun_docs(), budget)

    members = await prisma.membership.find_many(
        where={"organizationId": organization_id},
        include={"user": True},
        take=12,
    )
    lead_total = await prisma.lead.count(where={"organizationId": organization_id})
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
        "## Team (use list_team_members for ids)",
    ]
    for m in members:
        role = m.role.name if hasattr(m.role, "name") else str(m.role)
        email = m.user.email if m.user else "?"
        name = (m.user.name if m.user else None) or ""
        lines.append(f"- {email} ({name}) id={m.userId} — {role}")

    lines.append("")
    lines.append(f"## Lead pipeline counts (total {lead_total})")
    lines.append(
        "Counts only — call count_leads / search_leads for live lead details. "
        "Do not invent lead names from memory of prior turns."
    )
    if stage_counts:
        for stage, count in sorted(stage_counts.items()):
            lines.append(f"- {stage}: {count}")
    else:
        lines.append("- No leads")

    org_block = "\n".join(lines)
    loomrun = _load_loomrun_docs()

    loomrun_budget = max(600, int(budget * 0.35))
    org_budget = budget - loomrun_budget
    return (
        "# Organization knowledge\n"
        + _clip(org_block, org_budget)
        + "\n\n# Loomrun knowledge\n"
        + _clip(loomrun, loomrun_budget)
    )
