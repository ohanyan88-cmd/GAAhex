"""M1-B Phase 1 — Vendor-agnostic OLT driver layer.

Public API
----------

The 7 universal commands (see :class:`OltDriver`)::

    get_status, get_uptime,
    provision_onu, delete_onu,
    get_optical_power, set_vlan, apply_line_profile

Service-layer usage::

    from app.services.olt import get_driver_for_olt, OltCommandError

    driver = await get_driver_for_olt(olt_record)
    try:
        result = await driver.provision_onu(
            serial="HWTC00112233",
            slot=0, port=1,
            line_profile="100M_RES",
            vlan_id=100,
            customer_ref="CUST-42",
        )
    except OltCommandError as e:
        ...  # service layer logs to ServiceActionLog, surfaces to caller
    finally:
        await driver.close()

Phases 3 (Huawei) + 4 (ZTE) will add concrete drivers via :func:`register_driver`.
"""
from .driver import (
    LineProfileResult,
    OltDriver,
    OltStatus,
    OltUptime,
    OnuDeleteResult,
    OnuProvisionResult,
    OpticalPower,
    VlanSetResult,
)
from .exceptions import (
    OltCommandError,
    OltConnectionError,
    OltCredentialsError,
    OltError,
    OltNotSupportedError,
    OltTimeoutError,
)
from .factory import get_driver_for_olt, register_driver, registered_vendors
from .mock_driver import MockOltDriver

__all__ = [
    # Protocol + result dataclasses
    "OltDriver",
    "OltStatus",
    "OltUptime",
    "OnuProvisionResult",
    "OnuDeleteResult",
    "OpticalPower",
    "VlanSetResult",
    "LineProfileResult",
    # Factory
    "get_driver_for_olt",
    "register_driver",
    "registered_vendors",
    # Mock driver (v1)
    "MockOltDriver",
    # Exceptions
    "OltError",
    "OltConnectionError",
    "OltCommandError",
    "OltCredentialsError",
    "OltTimeoutError",
    "OltNotSupportedError",
]
