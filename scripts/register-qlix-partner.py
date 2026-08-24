#!/usr/bin/env python
"""One-time: register Loomrun as a Qlix partner product.

Qlix's partner registration is self-serve — no Qlix account or support ticket
involved. Run this once per deployment, then put the printed key in .env as
QLIX_PARTNER_KEY. The key is shown only once, so it is printed and not stored
anywhere automatically.

    apps/api/.venv/bin/python scripts/register-qlix-partner.py --slug loomrun

Every org's own key is minted later by the Activate button; this key only
identifies Loomrun as the product.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

from loomrun_api.qlix import client as qlix  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", default="loomrun", help="unique product slug")
    parser.add_argument("--name", default="Loomrun", help="display name")
    args = parser.parse_args()

    try:
        result = await qlix.register_partner(slug=args.slug, name=args.name)
    except qlix.QlixError as exc:
        if exc.status_code == 409:
            print(
                f"Slug '{args.slug}' is already taken. Either this deployment is "
                "already registered (reuse the existing QLIX_PARTNER_KEY), or "
                "pick another slug with --slug.",
                file=sys.stderr,
            )
            return 2
        print(f"Registration failed: {exc}", file=sys.stderr)
        return 1

    api_key = result.get("apiKey", "")
    print("Registered with Qlix.\n")
    print(f"  slug: {result.get('slug')}")
    print(f"  name: {result.get('name')}\n")
    print("Add this to your .env — it is not shown again:\n")
    print(f"QLIX_PARTNER_KEY={api_key}\n")
    print("Then set QLIX_MCP_URL to the public URL of this API's /mcp endpoint,")
    print("for example: QLIX_MCP_URL=https://api.yourdomain.com/mcp/")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
