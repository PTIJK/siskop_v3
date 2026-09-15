"""Stable App Hosting identifiers that preserve every Cloud Build UUID bit."""
import base64
import re
import uuid


def tenant_resource_id(build_id):
    """Encode a canonical UUID in 29 characters, within App Hosting's 30 limit."""
    if not isinstance(build_id, str) or not re.fullmatch(r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}", build_id):
        raise ValueError("An exact Cloud Build UUID is required")
    encoded = base64.b32encode(uuid.UUID(build_id).bytes).decode("ascii")
    return "cb-" + encoded.rstrip("=").lower()
