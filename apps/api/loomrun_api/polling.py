import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


@dataclass
class PollTask:
    name: str
    interval: int  # seconds between runs
    fn: Callable[[], Awaitable[Any]]
    startup_delay: int = 0  # seconds to wait before first run


async def _loop(task: PollTask) -> None:
    if task.startup_delay:
        await asyncio.sleep(task.startup_delay)
    while True:
        try:
            await task.fn()
        except Exception:
            logger.exception("[poll:%s] error", task.name)
        await asyncio.sleep(task.interval)


def start(tasks: list[PollTask]) -> list[asyncio.Task]:
    """Start all poll tasks and return the running asyncio.Task handles."""
    return [asyncio.create_task(_loop(t), name=f"poll:{t.name}") for t in tasks]
