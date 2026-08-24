from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, field_validator, model_validator


class PageConfig(BaseModel):
    size: Literal["letter", "A4"] = "letter"
    margin: float = Field(default=40, ge=20, le=80)


class ThemeConfig(BaseModel):
    primary_color: str = Field(default="#111827", alias="primaryColor")
    accent_color: str = Field(default="#374151", alias="accentColor")
    font_family: Literal["Helvetica", "Times-Roman", "Courier"] = Field(
        default="Helvetica", alias="fontFamily"
    )
    currency_symbol: str = Field(default="₹", alias="currencySymbol")

    model_config = {"populate_by_name": True}


class SectionBase(BaseModel):
    type: str
    enabled: bool = True


class HeaderSection(SectionBase):
    type: Literal["header"] = "header"
    layout: Literal["logo_left_company_right", "logo_center", "company_only", "invoice_like"] = "logo_left_company_right"
    show_tax_id: bool = Field(default=False, alias="showTaxId")

    model_config = {"populate_by_name": True}


class DocTitleSection(SectionBase):
    type: Literal["doc_title"] = "doc_title"
    custom_title: str | None = Field(default=None, alias="customTitle")

    model_config = {"populate_by_name": True}


class MetaSection(SectionBase):
    type: Literal["meta"] = "meta"
    fields: list[Literal["number", "date", "invoice_number", "valid_until"]] = Field(
        default_factory=lambda: ["number", "date"]
    )


class BillToSection(SectionBase):
    type: Literal["bill_to"] = "bill_to"
    label: str = "Bill To"
    show_company: bool = Field(default=False, alias="showCompany")
    show_phone: bool = Field(default=False, alias="showPhone")
    show_email: bool = Field(default=False, alias="showEmail")

    model_config = {"populate_by_name": True}


class LineItemsSection(SectionBase):
    type: Literal["line_items"] = "line_items"
    style: Literal["plain", "invoice_table"] = "plain"
    columns: list[
        Literal["sl", "description", "qty", "unit_price", "line_total", "sku", "hsn"]
    ] = Field(default_factory=lambda: ["description", "qty", "unit_price", "line_total"])


class TotalsSection(SectionBase):
    type: Literal["totals"] = "totals"
    show_subtotal: bool = Field(default=True, alias="showSubtotal")
    show_tax: bool = Field(default=True, alias="showTax")
    show_discount: bool = Field(default=False, alias="showDiscount")
    tax_label: str = Field(default="Tax", alias="taxLabel")

    model_config = {"populate_by_name": True}


class PaymentSection(SectionBase):
    type: Literal["payment"] = "payment"
    show_upi_qr: bool = Field(default=False, alias="showUpiQr")
    payment_note: str = Field(default="", alias="paymentNote")

    model_config = {"populate_by_name": True}


class TermsSection(SectionBase):
    type: Literal["terms"] = "terms"
    text: str = ""


class SignatureSection(SectionBase):
    type: Literal["signature"] = "signature"
    label: str = "Authorized Signatory"


class FooterSection(SectionBase):
    type: Literal["footer"] = "footer"
    text: str = ""
    show_page_number: bool = Field(default=False, alias="showPageNumber")

    model_config = {"populate_by_name": True}


SectionConfig = Annotated[
    Union[
        HeaderSection,
        DocTitleSection,
        MetaSection,
        BillToSection,
        LineItemsSection,
        TotalsSection,
        PaymentSection,
        TermsSection,
        SignatureSection,
        FooterSection,
    ],
    Field(discriminator="type"),
]


class TemplateLayout(BaseModel):
    page: PageConfig = Field(default_factory=PageConfig)
    theme: ThemeConfig = Field(default_factory=ThemeConfig)
    sections: list[SectionConfig]

    @field_validator("sections")
    @classmethod
    def require_core_sections(cls, sections: list) -> list:
        enabled_types = {s.type for s in sections if s.enabled}
        if "line_items" not in enabled_types or "totals" not in enabled_types:
            raise ValueError("layout must enable line_items and totals sections")
        return sections

    @model_validator(mode="after")
    def unique_section_types(self) -> TemplateLayout:
        types = [s.type for s in self.sections]
        if len(types) != len(set(types)):
            raise ValueError("each section type may appear only once")
        return self


class TemplateCreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9-]+$")
    doc_type: Literal["QUOTATION", "INVOICE"]
    layout: TemplateLayout


class TemplateUpdateBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    layout: TemplateLayout | None = None


class TemplateCloneBody(BaseModel):
    source_template_id: str
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9-]+$")


class TemplatePreviewBody(BaseModel):
    layout: TemplateLayout
    doc_type: Literal["QUOTATION", "INVOICE"] = "QUOTATION"
