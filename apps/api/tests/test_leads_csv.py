from loomrun_api.leads_csv import (
    detect_column_mapping,
    normalize_source,
    normalize_stage,
    parse_lead_date,
    parse_lead_rows,
    phone_dedupe_key,
)


def test_maps_common_export_headers():
    mapping = detect_column_mapping(
        ["Contact Name", "Mobile Number", "Company Name", "Lead Source", "Enquiry Date"]
    )
    assert mapping["title"] == "Contact Name"
    assert mapping["phone"] == "Mobile Number"
    assert mapping["company"] == "Company Name"
    assert mapping["source"] == "Lead Source"
    assert mapping["created_at"] == "Enquiry Date"


def test_parse_rows_and_aliases():
    csv = (
        "Name,Phone,Email,City,Source,Stage,Product,Qty,Notes,Value\n"
        "Rahul Sharma,+91 98765 43210,rahul@acme.com,Surat,IndiaMART,Quoted,Polo tshirts,500,Old buyer,25000\n"
        ",,,,\n"
        "Acme Textiles,9876543210,,Mumbai,whatsapp,new,Shirts,100,,\n"
    ).encode("utf-8")
    leads, mapping, warnings, errors = parse_lead_rows(csv)
    assert not errors
    assert mapping["title"] == "Name"
    assert len(leads) == 2
    assert leads[0]["title"] == "Rahul Sharma"
    assert leads[0]["source"] == "INDIAMART"
    assert leads[0]["stage"] == "QUOTATION"
    assert leads[0]["estimated_value"] == 25000
    assert "csv-import" in leads[0]["tags"]
    assert leads[1]["phone"] == "9876543210"


def test_requires_name_or_company():
    csv = b"Phone,Email\n9000000000,a@b.com\n"
    leads, mapping, warnings, errors = parse_lead_rows(csv)
    assert leads == []
    assert errors
    assert "name or company" in errors[0]


def test_company_used_as_title():
    csv = b"Company,Mobile\nLoom Mills,9123456789\n"
    leads, mapping, warnings, errors = parse_lead_rows(csv)
    assert not errors
    assert leads[0]["title"] == "Loom Mills"
    assert leads[0]["company"] == "Loom Mills"
    assert warnings


def test_phone_dedupe_and_enums():
    assert phone_dedupe_key("+91 98765-43210") == "9876543210"
    assert phone_dedupe_key("09876543210") == "9876543210"
    assert normalize_source("Facebook") == "META_ADS"
    assert normalize_stage("closed won") == "WON"
    assert parse_lead_date("15/08/2024").year == 2024
