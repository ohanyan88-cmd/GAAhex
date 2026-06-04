"""Feature-gate domain exception.

Raised by :mod:`app.services.feature_gate` (and Packs P3-P6 call sites) when a
caller asks for a subsystem that is disabled / stub in the current deployment.

Pure Python — NOT a FastAPI ``HTTPException``. The router / middleware layer
maps this onto HTTP 503 + an audit Event row at the request boundary, so
non-HTTP call sites (scheduler, background workers, CLI tools, importers)
can still raise / catch it without dragging FastAPI in.
"""
from __future__ import annotations


class FeatureDisabledError(Exception):
    """Raised when a feature is required by call site but disabled / stub in this deployment.

    Carries the feature key + reason. Caller maps to HTTP 503 + audit Event.
    """

    def __init__(self, feature: str, reason: str = ""):
        self.feature = feature
        self.reason = reason or f"Feature '{feature}' is disabled in this deployment"
        super().__init__(self.reason)
