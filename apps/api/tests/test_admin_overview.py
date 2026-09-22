"""Platform super-admin overview: orgs, members, per-turn token counts."""

from datetime import datetime, timezone
from types import SimpleNamespace

from loomrun_api.admin_overview import (
    assemble_overview,
    empty_usage,
    merge_usage_groups,
    parse_usage_row,
    rollup_usage,
    serialize_member,
    serialize_turn,
    serialize_user,
    usage_bucket,
)


def test_usage_bucket_averages_tokens_per_turn():
    assert usage_bucket(0, 10, 5, 1) == {
        "turns": 0,
        "prompt_tokens": 10,
        "completion_tokens": 5,
        "total_tokens": 15,
        "credits": 1,
        "avg_tokens_per_turn": 0,
    }
    bucket = usage_bucket(2, 100, 50, 4)
    assert bucket["total_tokens"] == 150
    assert bucket["avg_tokens_per_turn"] == 75.0


def test_parse_usage_row_accepts_snake_and_camel():
    org_id, all_time, week = parse_usage_row(
        {
            "organizationId": "org-1",
            "turns": 10,
            "promptTokens": 200,
            "completionTokens": 50,
            "credits": 8,
            "turns7d": 3,
            "prompt_tokens_7d": 60,
            "completion_tokens_7d": 15,
            "credits_7d": 2,
        }
    )
    assert org_id == "org-1"
    assert all_time["turns"] == 10
    assert all_time["total_tokens"] == 250
    assert week["turns"] == 3
    assert week["total_tokens"] == 75


def test_rollup_usage_sums_and_recomputes_average():
    rolled = rollup_usage(
        [usage_bucket(2, 100, 20, 3), usage_bucket(2, 100, 20, 1)]
    )
    assert rolled["turns"] == 4
    assert rolled["total_tokens"] == 240
    assert rolled["avg_tokens_per_turn"] == 60.0
    assert rollup_usage([]) == empty_usage()


def test_merge_usage_groups_combines_all_time_and_week():
    merged = merge_usage_groups(
        [
            {
                "organizationId": "org-1",
                "_count": {"_all": 4},
                "_sum": {"promptTokens": 800, "completionTokens": 200, "credits": 6},
            }
        ],
        [
            {
                "organizationId": "org-1",
                "_count": {"_all": 1},
                "_sum": {"promptTokens": 100, "completionTokens": 50, "credits": 1},
            }
        ],
    )
    assert merged == [
        {
            "organization_id": "org-1",
            "turns": 4,
            "prompt_tokens": 800,
            "completion_tokens": 200,
            "credits": 6,
            "turns_7d": 1,
            "prompt_tokens_7d": 100,
            "completion_tokens_7d": 50,
            "credits_7d": 1,
        }
    ]


def test_serialize_member_and_user():
    user = SimpleNamespace(
        id="u1",
        email="ceo@example.com",
        name="Raghu",
        isSuperAdmin=True,
        createdAt=datetime(2026, 1, 2, tzinfo=timezone.utc),
        memberships=[
            SimpleNamespace(
                id="m1",
                organizationId="org-1",
                role=SimpleNamespace(name="OWNER"),
                createdAt=datetime(2026, 1, 3, tzinfo=timezone.utc),
                organization=SimpleNamespace(name="Acme", slug="acme"),
            )
        ],
    )
    membership = user.memberships[0]
    member = serialize_member(membership, user)
    assert member["role"] == "OWNER"
    assert member["is_super_admin"] is True
    assert member["email"] == "ceo@example.com"

    payload = serialize_user(user)
    assert payload["organizations"] == [
        {"id": "org-1", "name": "Acme", "slug": "acme", "role": "OWNER"}
    ]


def test_serialize_turn_adds_total_tokens():
    event = SimpleNamespace(
        id="e1",
        organizationId="org-1",
        conversationId="c1",
        source="qlix",
        model="gpt-4o-mini",
        promptTokens=1200,
        completionTokens=300,
        credits=3,
        createdAt=datetime(2026, 9, 22, 6, 0, tzinfo=timezone.utc),
    )
    row = serialize_turn(
        event,
        organization_name="Acme",
        conversation_title="Won leads",
        user_email="ceo@example.com",
        user_name="Raghu",
    )
    assert row["total_tokens"] == 1500
    assert row["user_email"] == "ceo@example.com"
    assert row["conversation_title"] == "Won leads"


def test_assemble_overview_nests_members_and_usage():
    now = datetime(2026, 9, 22, 12, 0, tzinfo=timezone.utc)
    org = SimpleNamespace(
        id="org-1",
        name="Acme",
        slug="acme",
        plan="growth",
        extraSeats=2,
        suspended=False,
        createdAt=now,
    )
    user = SimpleNamespace(
        id="u1",
        email="ceo@example.com",
        name="Raghu",
        isSuperAdmin=True,
        createdAt=now,
        memberships=[
            SimpleNamespace(
                id="m1",
                organizationId="org-1",
                role="SALES",
                createdAt=now,
                organization=org,
            )
        ],
    )
    window = SimpleNamespace(
        organizationId="org-1",
        windowType="weekly",
        usedCredits=40,
        limitCredits=700,
        periodEnd=now,
    )
    snapshot = assemble_overview(
        now=now,
        orgs=[org],
        users=[user],
        usage_rows=[
            {
                "organization_id": "org-1",
                "turns": 4,
                "prompt_tokens": 800,
                "completion_tokens": 200,
                "credits": 6,
                "turns_7d": 1,
                "prompt_tokens_7d": 100,
                "completion_tokens_7d": 50,
                "credits_7d": 1,
            }
        ],
        windows=[window],
    )
    assert snapshot["totals"]["users"] == 1
    assert snapshot["totals"]["super_admins"] == 1
    assert snapshot["totals"]["ai"]["total_tokens"] == 1000
    assert snapshot["totals"]["ai"]["last_7d"]["turns"] == 1
    org_row = snapshot["organizations"][0]
    assert org_row["members"][0]["role"] == "SALES"
    assert org_row["ai"]["avg_tokens_per_turn"] == 250.0
    assert org_row["ai"]["windows"]["weekly"]["used"] == 40
    assert org_row["ai"]["windows"]["weekly"]["remaining"] == 660
    assert org_row["ai"]["windows"]["session_5h"]["limit"] == 120
