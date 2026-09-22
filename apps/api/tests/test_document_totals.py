"""Unit tests for document GST totals and versioning helpers."""

from decimal import Decimal

import pytest

from loomrun_api.document_totals import compute_document_totals, normalize_tax_rate
from loomrun_api.quotation_versions import is_commercially_issued
from types import SimpleNamespace


class TestDocumentTotals:
    def test_gst_18_percent(self):
        t = compute_document_totals(
            lines=[{"description": "Polos", "quantity": 100, "unit_price": 1000}],
            tax_enabled=True,
            tax_rate=18,
        )
        assert t["subtotal"] == Decimal("100000.00")
        assert t["tax"] == Decimal("18000.00")
        assert t["total"] == Decimal("118000.00")
        assert t["tax_rate"] == Decimal("18.00")

    def test_gst_disabled(self):
        t = compute_document_totals(
            lines=[{"description": "A", "quantity": 1, "unit_price": 100}],
            tax_enabled=False,
            tax_rate=18,
        )
        assert t["tax"] == Decimal("0.00")
        assert t["total"] == Decimal("100.00")
        assert t["tax_rate"] is None

    def test_gst_zero(self):
        t = compute_document_totals(
            lines=[{"description": "A", "quantity": 1, "unit_price": 100}],
            tax_enabled=True,
            tax_rate=0,
        )
        assert t["tax"] == Decimal("0.00")
        assert t["total"] == Decimal("100.00")

    @pytest.mark.parametrize("rate,expected_tax", [
        (5, "5.00"),
        (12, "12.00"),
        (18, "18.00"),
        (28, "28.00"),
        (7.5, "7.50"),
    ])
    def test_gst_rates(self, rate, expected_tax):
        t = compute_document_totals(
            lines=[{"description": "A", "quantity": 1, "unit_price": 100}],
            tax_enabled=True,
            tax_rate=rate,
        )
        assert t["tax"] == Decimal(expected_tax)

    def test_multiple_lines(self):
        t = compute_document_totals(
            lines=[
                {"description": "A", "quantity": 10, "unit_price": 100},
                {"description": "B", "quantity": 2, "unit_price": 50},
            ],
            tax_enabled=True,
            tax_rate=18,
        )
        assert t["subtotal"] == Decimal("1100.00")
        assert t["tax"] == Decimal("198.00")
        assert t["total"] == Decimal("1298.00")

    def test_invalid_rate(self):
        with pytest.raises(ValueError):
            normalize_tax_rate(True, 101)
        with pytest.raises(ValueError):
            normalize_tax_rate(True, -1)

    def test_rounding_half_up(self):
        # 33.33 * 18% = 5.9994 → 6.00
        t = compute_document_totals(
            lines=[{"description": "A", "quantity": 1, "unit_price": "33.33"}],
            tax_enabled=True,
            tax_rate=18,
        )
        assert t["tax"] == Decimal("6.00")
        assert t["total"] == Decimal("39.33")


class TestCommercialLock:
    def test_draft_not_locked(self):
        q = SimpleNamespace(status="DRAFT", sentAt=None, invoiceNumber=None, invoicedAt=None)
        assert is_commercially_issued(q) is False

    def test_sent_locked(self):
        q = SimpleNamespace(status="SENT", sentAt="x", invoiceNumber=None, invoicedAt=None)
        assert is_commercially_issued(q) is True

    def test_invoice_document_locked(self):
        q = SimpleNamespace(
            status="DRAFT", sentAt=None, invoiceNumber="INV-1", invoicedAt="x"
        )
        assert is_commercially_issued(q) is True

    def test_invoiced_status_locked(self):
        q = SimpleNamespace(status="INVOICED", sentAt=None, invoiceNumber=None, invoicedAt=None)
        assert is_commercially_issued(q) is True
