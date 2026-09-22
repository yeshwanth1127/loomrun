"""Unit tests for order collections / payment timeline helpers."""

from datetime import date, datetime, timezone
from types import SimpleNamespace

from loomrun_api.collections import (
    COLLECTION_OVERDUE,
    COLLECTION_PAID,
    COLLECTION_PARTIALLY_PAID,
    COLLECTION_UNPAID,
    build_payment_timeline,
    compute_collections,
    normalize_payment_method,
)
from loomrun_api.pnl import compute_pnl


def _payment(amount_cents: int, status: str = "PAID", **kwargs):
    return SimpleNamespace(
        id=kwargs.get("id", f"p-{amount_cents}"),
        amountCents=amount_cents,
        status=status,
        note=kwargs.get("note"),
        method=kwargs.get("method"),
        reference=kwargs.get("reference"),
        label=kwargs.get("label"),
        recordedAt=kwargs.get("recorded_at", datetime(2026, 9, 18, tzinfo=timezone.utc)),
        expectedPaymentId=kwargs.get("expected_payment_id"),
    )


def _expected(
    amount_cents: int,
    *,
    remaining: int | None = None,
    expected_at: datetime | None = None,
    status: str = "OPEN",
    **kwargs,
):
    return SimpleNamespace(
        id=kwargs.get("id", f"e-{amount_cents}"),
        amountCents=amount_cents,
        remainingCents=remaining if remaining is not None else amount_cents,
        expectedAt=expected_at,
        label=kwargs.get("label"),
        note=kwargs.get("note"),
        status=status,
        createdAt=datetime(2026, 9, 18, tzinfo=timezone.utc),
        updatedAt=datetime(2026, 9, 18, tzinfo=timezone.utc),
        cancelledAt=None,
    )


def _order(*, revenue: float | None = 100000.0, estimated: float | None = None):
    quotation = None
    if revenue is not None:
        quotation = SimpleNamespace(total=revenue)
    lead = SimpleNamespace(estimatedValue=estimated, title="Acme")
    return SimpleNamespace(
        id="ord1",
        budgetCents=None,
        quotation=quotation,
        lead=lead,
        createdAt=datetime(2026, 9, 18, tzinfo=timezone.utc),
        payments=[],
        expectedPayments=[],
        expenses=[],
    )


class TestNormalizeMethod:
    def test_valid(self):
        assert normalize_payment_method("upi") == "UPI"
        assert normalize_payment_method("bank-transfer") == "BANK_TRANSFER"

    def test_none(self):
        assert normalize_payment_method(None) is None
        assert normalize_payment_method("  ") is None

    def test_invalid(self):
        try:
            normalize_payment_method("bitcoin")
            assert False, "expected ValueError"
        except ValueError as exc:
            assert "Unknown payment method" in str(exc)


class TestCollectionsScenario:
    """Real-world ₹1,00,000 order scenario from the product brief."""

    TODAY = date(2026, 9, 20)

    def test_a_no_payments_unpaid(self):
        c = compute_collections(revenue_cents=10_000_000, payments=[], today=self.TODAY)
        assert c["collected_cents"] == 0
        assert c["balance_due_cents"] == 10_000_000
        assert c["payment_status"] == COLLECTION_UNPAID

    def test_b_one_advance_partial(self):
        c = compute_collections(
            revenue_cents=10_000_000,
            payments=[_payment(3_000_000, label="Advance")],
            today=self.TODAY,
        )
        assert c["collected_cents"] == 3_000_000
        assert c["balance_due_cents"] == 7_000_000
        assert c["payment_status"] == COLLECTION_PARTIALLY_PAID
        assert c["collection_percentage"] == 30.0

    def test_c_multiple_partials(self):
        payments = [
            _payment(3_000_000),
            _payment(2_000_000),
        ]
        c = compute_collections(
            revenue_cents=10_000_000, payments=payments, today=self.TODAY
        )
        assert c["collected_cents"] == 5_000_000
        assert c["balance_due_cents"] == 5_000_000
        assert c["payment_status"] == COLLECTION_PARTIALLY_PAID

    def test_d_fully_paid(self):
        c = compute_collections(
            revenue_cents=10_000_000,
            payments=[_payment(10_000_000)],
            today=self.TODAY,
        )
        assert c["balance_due_cents"] == 0
        assert c["payment_status"] == COLLECTION_PAID
        assert c["collection_percentage"] == 100.0

    def test_e_delivered_balance_remains_is_partial(self):
        # Delivery is independent — collections still PARTIALLY_PAID.
        c = compute_collections(
            revenue_cents=10_000_000,
            payments=[_payment(5_000_000)],
            today=self.TODAY,
        )
        assert c["payment_status"] == COLLECTION_PARTIALLY_PAID
        assert c["balance_due_cents"] == 5_000_000

    def test_f_expected_not_counted_as_collected(self):
        c = compute_collections(
            revenue_cents=10_000_000,
            payments=[_payment(5_000_000)],
            expected_payments=[
                _expected(
                    2_500_000,
                    expected_at=datetime(2026, 10, 5, tzinfo=timezone.utc),
                ),
                _expected(2_500_000, expected_at=None),
            ],
            today=self.TODAY,
        )
        assert c["collected_cents"] == 5_000_000
        assert c["balance_due_cents"] == 5_000_000
        assert c["active_expected_count"] == 2
        assert c["payment_status"] == COLLECTION_PARTIALLY_PAID

    def test_g_overdue_expected(self):
        c = compute_collections(
            revenue_cents=10_000_000,
            payments=[_payment(5_000_000)],
            expected_payments=[
                _expected(
                    2_500_000,
                    expected_at=datetime(2026, 9, 15, tzinfo=timezone.utc),
                )
            ],
            today=self.TODAY,
        )
        assert c["payment_status"] == COLLECTION_OVERDUE
        assert c["overdue_expected_count"] == 1
        assert c["overdue_expected_cents"] == 2_500_000

    def test_h_reschedule_clears_overdue(self):
        c = compute_collections(
            revenue_cents=10_000_000,
            payments=[_payment(5_000_000)],
            expected_payments=[
                _expected(
                    2_500_000,
                    expected_at=datetime(2026, 9, 30, tzinfo=timezone.utc),
                )
            ],
            today=self.TODAY,
        )
        assert c["payment_status"] == COLLECTION_PARTIALLY_PAID
        assert c["overdue_expected_count"] == 0

    def test_i_partial_fulfillment_remaining_promise(self):
        c = compute_collections(
            revenue_cents=10_000_000,
            payments=[_payment(5_000_000), _payment(1_000_000)],
            expected_payments=[
                _expected(
                    2_500_000,
                    remaining=1_500_000,
                    status="PARTIALLY_FULFILLED",
                    expected_at=datetime(2026, 10, 5, tzinfo=timezone.utc),
                )
            ],
            today=self.TODAY,
        )
        assert c["collected_cents"] == 6_000_000
        assert c["balance_due_cents"] == 4_000_000
        assert c["next_expected_payment"]["remaining_cents"] == 1_500_000

    def test_k_overpayment_no_negative_balance(self):
        c = compute_collections(
            revenue_cents=10_000_000,
            payments=[_payment(11_000_000)],
            today=self.TODAY,
        )
        assert c["balance_due_cents"] == 0
        assert c["overpaid_cents"] == 1_000_000
        assert c["payment_status"] == COLLECTION_PAID

    def test_pending_payment_not_collected(self):
        c = compute_collections(
            revenue_cents=10_000_000,
            payments=[_payment(3_000_000, status="PENDING")],
            today=self.TODAY,
        )
        assert c["collected_cents"] == 0
        assert c["payment_status"] == COLLECTION_UNPAID

    def test_full_scenario_steps(self):
        revenue = 10_000_000
        payments = [_payment(3_000_000), _payment(2_000_000)]
        expected = [
            _expected(2_500_000, expected_at=datetime(2026, 10, 5, tzinfo=timezone.utc)),
            _expected(2_500_000, expected_at=None),
        ]
        c = compute_collections(
            revenue_cents=revenue, payments=payments, expected_payments=expected, today=self.TODAY
        )
        assert c["collected_cents"] == 5_000_000
        assert c["balance_due_cents"] == 5_000_000

        # Fulfill first expected
        payments.append(_payment(2_500_000, expected_payment_id="e-2500000"))
        expected[0] = _expected(
            2_500_000,
            remaining=0,
            status="FULFILLED",
            expected_at=datetime(2026, 10, 5, tzinfo=timezone.utc),
        )
        c = compute_collections(
            revenue_cents=revenue, payments=payments, expected_payments=expected, today=self.TODAY
        )
        assert c["collected_cents"] == 7_500_000
        assert c["balance_due_cents"] == 2_500_000
        assert c["active_expected_count"] == 1

        payments.append(_payment(2_500_000))
        expected[1] = _expected(2_500_000, remaining=0, status="FULFILLED")
        c = compute_collections(
            revenue_cents=revenue, payments=payments, expected_payments=expected, today=self.TODAY
        )
        assert c["collected_cents"] == 10_000_000
        assert c["balance_due_cents"] == 0
        assert c["payment_status"] == COLLECTION_PAID


class TestPnlIntegration:
    def test_pnl_includes_collection_fields(self):
        order = _order(revenue=1000.0)
        order.payments = [_payment(30_000)]
        order.expectedPayments = [
            _expected(20_000, expected_at=datetime(2026, 9, 10, tzinfo=timezone.utc))
        ]
        pnl = compute_pnl(order=order)
        assert pnl["revenue_cents"] == 100_000
        assert pnl["collected_cents"] == 30_000
        assert pnl["balance_due_cents"] == 70_000
        assert pnl["collection_gap_cents"] == 70_000
        assert pnl["payment_status"] == COLLECTION_OVERDUE
        assert pnl["overdue_expected_count"] == 1


class TestTimeline:
    def test_timeline_preserves_history(self):
        order = _order()
        payments = [
            _payment(3_000_000, label="Advance", method="UPI", reference="UPI123"),
            _payment(
                2_000_000,
                recorded_at=datetime(2026, 9, 23, tzinfo=timezone.utc),
                method="BANK_TRANSFER",
            ),
        ]
        expected = [
            _expected(
                2_500_000,
                expected_at=datetime(2026, 10, 5, tzinfo=timezone.utc),
                note="Next week",
            ),
            _expected(2_500_000, expected_at=None, note="Later"),
        ]
        activities = [
            SimpleNamespace(
                id="a1",
                type="STAGE_CHANGED",
                body="Moved to Delivered",
                createdAt=datetime(2026, 9, 28, tzinfo=timezone.utc),
                metadata={"to_stage": "DELIVERED"},
            )
        ]
        events = build_payment_timeline(
            order=order,
            payments=payments,
            expected_payments=expected,
            activities=activities,
            today=date(2026, 9, 20),
        )
        kinds = [e["kind"] for e in events]
        assert "ORDER_EVENT" in kinds
        assert "ACTUAL_PAYMENT" in kinds
        assert "EXPECTED_PAYMENT" in kinds
        assert any(e["title"] == "Order delivered" for e in events)
        assert any(e["meta"].get("is_unscheduled") for e in events if e["kind"] == "EXPECTED_PAYMENT")
        # Unscheduled sorts last
        assert events[-1]["at"] is None
