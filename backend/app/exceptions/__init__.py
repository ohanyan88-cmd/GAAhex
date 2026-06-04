"""Domain-level exceptions for GAAhex.

These are pure Python exceptions — never FastAPI ``HTTPException`` subclasses.
The HTTP layer (routers / middleware) maps them onto the correct status code
and audit-event row at the request boundary. Keeping them framework-agnostic
lets service-layer code (factories, schedulers, background workers, CLI tools)
raise them without dragging in a FastAPI dependency.
"""
from .feature_gate import FeatureDisabledError

__all__ = ["FeatureDisabledError"]
