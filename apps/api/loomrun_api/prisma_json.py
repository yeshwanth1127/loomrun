from prisma import fields


def json_meta(value: dict | None) -> fields.Json | None:
    if value is None:
        return None
    return fields.Json(value)
