"""
Fernet symmetric encryption for stored telephony credentials.
Key is derived from settings.secret_key so no separate key management is needed.
"""
import base64
import hashlib
import json

from cryptography.fernet import Fernet

from loomrun_api.config import settings


def _fernet() -> Fernet:
    raw = hashlib.sha256(settings.secret_key.encode()).digest()
    key = base64.urlsafe_b64encode(raw)
    return Fernet(key)


def encrypt_credentials(creds: dict) -> str:
    """Encrypt a credentials dict → opaque string stored in DB."""
    return _fernet().encrypt(json.dumps(creds).encode()).decode()


def decrypt_credentials(blob: str) -> dict:
    """Decrypt a stored blob → credentials dict."""
    return json.loads(_fernet().decrypt(blob.encode()))
