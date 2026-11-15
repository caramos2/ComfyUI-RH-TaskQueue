"""Validation helpers for workflow fingerprint values.

The fingerprint itself is computed on the frontend (it is the side that owns
the API prompt). The backend only validates the shape of what it receives so
that malformed rows can never enter the duration table.
"""

import re

#: SHA-256 hex digest, lowercase. Uppercase is rejected on purpose: the
#: frontend always emits lowercase and mixing cases would split one workflow
#: into two rows.
_SIGNATURE_RE = re.compile(r"^[0-9a-f]{64}$")

MIN_SIGNATURE_VERSION = 1
CURRENT_SIGNATURE_VERSION = 1


def is_valid_signature(value) -> bool:
    """True when value is a 64 character lowercase hex digest."""
    return isinstance(value, str) and _SIGNATURE_RE.match(value) is not None


def is_valid_version(value) -> bool:
    """True when value is an integer signature version >= 1."""
    if isinstance(value, bool) or not isinstance(value, int):
        return False
    return value >= MIN_SIGNATURE_VERSION


def validate_signature(value) -> str:
    if not is_valid_signature(value):
        raise ValueError("signature must be 64 lowercase hex characters")
    return value


def validate_version(value) -> int:
    if not is_valid_version(value):
        raise ValueError("signature_version must be an integer >= 1")
    return value
