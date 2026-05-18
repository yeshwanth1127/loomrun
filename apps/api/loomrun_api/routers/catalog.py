from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from loomrun_api.catalog_csv import parse_catalog_rows
from loomrun_api.deps import OrgContext, get_org_context
from loomrun_api.prisma_client import prisma

router = APIRouter()


class CatalogItemOut(BaseModel):
    id: str
    name: str
    description: str | None
    unit_price: float
    sku: str | None
    created_at: str


class CatalogItemCreate(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    unit_price: float = Field(ge=0)
    sku: str | None = None


@router.get("/orgs/{org_id}/catalog")
async def list_catalog(org_id: str, ctx: OrgContext = Depends(get_org_context)) -> dict:
    items = await prisma.catalogitem.find_many(
        where={"organizationId": ctx.organization_id},
        order={"createdAt": "desc"},
    )
    return {
        "items": [
            {
                "id": item.id,
                "name": item.name,
                "description": item.description,
                "unit_price": float(item.unitPrice),
                "sku": item.sku,
                "created_at": item.createdAt.isoformat(),
            }
            for item in items
        ]
    }


@router.post("/orgs/{org_id}/catalog/items", status_code=status.HTTP_201_CREATED)
async def create_catalog_item(
    org_id: str,
    body: CatalogItemCreate,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    item = await prisma.catalogitem.create(
        data={
            "organizationId": ctx.organization_id,
            "name": body.name,
            "description": body.description,
            "unitPrice": body.unit_price,
            "sku": body.sku,
        }
    )
    return {
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "unit_price": float(item.unitPrice),
        "sku": item.sku,
        "created_at": item.createdAt.isoformat(),
    }


@router.delete("/orgs/{org_id}/catalog/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_catalog_item(
    org_id: str,
    item_id: str,
    ctx: OrgContext = Depends(get_org_context),
):
    item = await prisma.catalogitem.find_first(
        where={"id": item_id, "organizationId": ctx.organization_id}
    )
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Catalog item not found")
    await prisma.catalogitem.delete(where={"id": item_id})


@router.post("/orgs/{org_id}/catalog/upload-csv")
async def upload_catalog_csv(
    org_id: str,
    file: UploadFile,
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="File must be a CSV file")

    content = await file.read()
    if not content.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="CSV file is empty")

    items, column_mapping, warnings, errors = parse_catalog_rows(content)
    if not items and errors and not warnings:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=errors[0] if len(errors) == 1 else "; ".join(errors[:5]))

    items_created = 0
    for item in items:
        try:
            await prisma.catalogitem.create(
                data={
                    "organizationId": ctx.organization_id,
                    "name": item["name"],
                    "description": item.get("description"),
                    "unitPrice": item["unit_price"],
                    "sku": item.get("sku"),
                }
            )
            items_created += 1
        except Exception as e:
            errors.append(f"Could not save '{item.get('name', '?')}': {e}")

    return {
        "items_created": items_created,
        "errors": errors,
        "warnings": warnings,
        "column_mapping": column_mapping,
    }
