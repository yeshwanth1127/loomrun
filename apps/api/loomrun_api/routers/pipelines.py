"""HTTP API for sales pipeline workspaces, stages, routing rules, and overview."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field

from loomrun_api.deps import OrgContext, get_org_context, require_roles
from loomrun_api.services import pipelines as pipeline_svc

router = APIRouter()


class PipelineCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: str = "GENERAL"
    copy_default_stages: bool = True
    is_default: bool = False


class PipelineUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    type: str | None = None
    is_default: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class PipelineDeleteBody(BaseModel):
    move_leads_to_pipeline_id: str | None = None


class StageInput(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = None
    kind: str = "OPEN"
    probability: int | None = Field(None, ge=0, le=100)
    system_key: str | None = None


class StagesReplace(BaseModel):
    stages: list[StageInput] = Field(min_length=1)


class RoutingRuleInput(BaseModel):
    pipeline_id: str
    priority: int | None = None
    is_active: bool = True
    source: str | None = None
    campaign_id: str | None = None
    campaign_name: str | None = None
    region: str | None = None
    product_interest: str | None = None
    sector: str | None = None


class RoutingRulesReplace(BaseModel):
    rules: list[RoutingRuleInput]


class RoutingRuleMatchBody(BaseModel):
    pipeline_id: str | None = None
    source: str | None = None
    campaign_id: str | None = None
    campaign_name: str | None = None
    region: str | None = None
    product_interest: str | None = None
    sector: str | None = None
    rule_id: str | None = None


@router.get("/orgs/{org_id}/pipelines")
async def list_pipelines(
    org_id: str,
    include_archived: bool = Query(True),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    return await pipeline_svc.list_pipelines(
        organization_id=ctx.organization_id,
        include_archived=include_archived,
    )


@router.get("/orgs/{org_id}/pipelines/routing-rules")
async def list_routing_rules(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    return await pipeline_svc.list_routing_rules(organization_id=ctx.organization_id)


@router.put("/orgs/{org_id}/pipelines/routing-rules")
async def replace_routing_rules(
    org_id: str,
    body: RoutingRulesReplace,
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES")),
) -> dict:
    return await pipeline_svc.replace_routing_rules(
        organization_id=ctx.organization_id,
        rules=[r.model_dump() for r in body.rules],
        user_id=ctx.membership.userId,
        migrate_existing_campaign_leads=True,
    )


@router.post("/orgs/{org_id}/pipelines/routing-rules/preview-replace")
async def preview_routing_rules_replace(
    org_id: str,
    body: RoutingRulesReplace,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    return await pipeline_svc.preview_routing_rules_replace(
        organization_id=ctx.organization_id,
        rules=[r.model_dump() for r in body.rules],
    )


@router.post("/orgs/{org_id}/pipelines/routing-rules/preview-matches")
async def preview_routing_rule_matches(
    org_id: str,
    body: RoutingRuleMatchBody,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    return await pipeline_svc.preview_routing_rule_matches(
        organization_id=ctx.organization_id,
        rule=body.model_dump(),
        pipeline_id=body.pipeline_id,
    )


@router.post("/orgs/{org_id}/pipelines/routing-rules/apply")
async def apply_routing_rule(
    org_id: str,
    body: RoutingRuleMatchBody,
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES")),
) -> dict:
    return await pipeline_svc.apply_routing_rule_to_existing(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        rule=body.model_dump(),
        pipeline_id=body.pipeline_id,
        rule_id=body.rule_id,
    )


@router.post("/orgs/{org_id}/pipelines/routing-rules/{rule_id}/apply")
async def apply_saved_routing_rule(
    org_id: str,
    rule_id: str,
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES")),
) -> dict:
    return await pipeline_svc.apply_routing_rule_to_existing(
        organization_id=ctx.organization_id,
        user_id=ctx.membership.userId,
        rule={},
        rule_id=rule_id,
    )


@router.post("/orgs/{org_id}/pipelines", status_code=status.HTTP_201_CREATED)
async def create_pipeline(
    org_id: str,
    body: PipelineCreate,
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES")),
) -> dict:
    return await pipeline_svc.create_pipeline(
        organization_id=ctx.organization_id,
        name=body.name,
        type=body.type,
        copy_default_stages=body.copy_default_stages,
        is_default=body.is_default,
    )


@router.patch("/orgs/{org_id}/pipelines/{pipeline_id}")
async def update_pipeline(
    org_id: str,
    pipeline_id: str,
    body: PipelineUpdate,
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES")),
) -> dict:
    return await pipeline_svc.update_pipeline(
        organization_id=ctx.organization_id,
        pipeline_id=pipeline_id,
        name=body.name,
        type=body.type,
        is_default=body.is_default,
        is_active=body.is_active,
        sort_order=body.sort_order,
    )


@router.delete("/orgs/{org_id}/pipelines/{pipeline_id}")
async def delete_pipeline(
    org_id: str,
    pipeline_id: str,
    body: PipelineDeleteBody | None = None,
    ctx: OrgContext = Depends(require_roles("OWNER")),
) -> dict:
    return await pipeline_svc.delete_pipeline(
        organization_id=ctx.organization_id,
        pipeline_id=pipeline_id,
        move_leads_to_pipeline_id=(body.move_leads_to_pipeline_id if body else None),
    )


@router.put("/orgs/{org_id}/pipelines/{pipeline_id}/stages")
async def replace_stages(
    org_id: str,
    pipeline_id: str,
    body: StagesReplace,
    ctx: OrgContext = Depends(require_roles("OWNER", "SALES")),
) -> dict:
    return await pipeline_svc.replace_stages(
        organization_id=ctx.organization_id,
        pipeline_id=pipeline_id,
        stages=[s.model_dump() for s in body.stages],
    )


@router.get("/orgs/{org_id}/pipelines/{pipeline_id}/overview")
async def pipeline_overview(
    org_id: str,
    pipeline_id: str,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    return await pipeline_svc.pipeline_overview(
        organization_id=ctx.organization_id,
        pipeline_id=pipeline_id,
    )
