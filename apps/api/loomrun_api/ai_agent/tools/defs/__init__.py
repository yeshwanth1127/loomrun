"""Import all tool definition modules so @register_tool runs at startup.

To add a tool: create a new module here (or add to an existing one) with
@register_tool(...), then import it below.
"""

from loomrun_api.ai_agent.tools.defs import history as history  # noqa: F401
from loomrun_api.ai_agent.tools.defs import leads as leads  # noqa: F401
from loomrun_api.ai_agent.tools.defs import operations as operations  # noqa: F401
from loomrun_api.ai_agent.tools.defs import quotations as quotations  # noqa: F401
from loomrun_api.ai_agent.tools.defs import whatsapp as whatsapp  # noqa: F401
