"""Unit tests for membership vs org connection session keys."""

from loomrun_api.member_connections import whatsapp_session_id


def test_org_whatsapp_session_uses_org_id():
    assert whatsapp_session_id(org_id="org_abc") == "org_abc"
    assert whatsapp_session_id(org_id="org_abc", membership_id=None) == "org_abc"


def test_personal_whatsapp_session_uses_membership_prefix():
    assert whatsapp_session_id(org_id="org_abc", membership_id="mem_123") == "m_mem_123"


def test_personal_and_org_sessions_are_distinct():
    org = whatsapp_session_id(org_id="org_1")
    personal = whatsapp_session_id(org_id="org_1", membership_id="m1")
    assert org != personal
