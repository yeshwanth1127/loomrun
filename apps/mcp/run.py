"""Entry point — runs exora_mcp_server over HTTP (streamable-http transport)."""
import sys
from pathlib import Path

# Make the package importable when run directly
sys.path.insert(0, str(Path(__file__).parent))

from exora_mcp_server.config import MCP_HOST, MCP_PORT
from exora_mcp_server.server import mcp

if __name__ == "__main__":
    mcp.run(transport="streamable-http", host=MCP_HOST, port=MCP_PORT)
