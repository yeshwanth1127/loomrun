import os
from pathlib import Path
from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(_REPO_ROOT / ".env")

DATABASE_URL: str = os.environ["DATABASE_URL"]
GOOGLE_CLIENT_ID: str = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET: str = os.environ.get("GOOGLE_CLIENT_SECRET", "")
# Internal Gmail/Calendar bridge: only trusted local callers may reach it.
MCP_HOST: str = "127.0.0.1"
MCP_PORT: int = int(os.environ.get("MCP_PORT", "8003"))
