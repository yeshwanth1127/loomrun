from prisma import fields


def json_meta(value: dict | None) -> fields.Json:
    """Wrap a dict for Prisma Json columns.

    prisma-client-py serializes Python ``None`` as GraphQL ``null``, which the
    query engine rejects for Json fields (``A value is required but not set``).
    Use an empty object to clear a Json column instead.
    """
    return fields.Json({} if value is None else value)
