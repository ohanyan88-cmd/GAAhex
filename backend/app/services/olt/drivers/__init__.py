"""Concrete vendor OLT drivers.

Each module in this package implements the :class:`~app.services.olt.driver.OltDriver`
Protocol for a specific OLT vendor and registers itself with the factory at import time.

Importing the module is the trigger — e.g. ``import app.services.olt.drivers.huawei``
will both expose ``HuaweiDriver`` AND register ``'huawei'`` in the factory registry.
"""
from .huawei import HuaweiDriver
from .vsol import VsolDriver
from .vsol_v1600 import VsolV1600Driver
from .zte import ZteDriver

__all__ = ["HuaweiDriver", "VsolDriver", "VsolV1600Driver", "ZteDriver"]
