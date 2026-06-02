"""OLT transport layer — CLI, SNMP, NETCONF abstractions for vendor drivers.

Three Protocols + three working Mocks + three real-transport classes (CLI is
live via asyncssh, SNMP is a skeleton, NETCONF is deferred). Concrete vendor
drivers (HuaweiDriver, ZteDriver) accept transport instances via dependency
injection — Mock for tests, real for production.
"""
from .cli import AsyncSshCliTransport, CliTransport
from .exceptions import (
    TransportAuthError,
    TransportConnectionError,
    TransportError,
    TransportProtocolError,
    TransportTimeoutError,
)
from .mock_cli import MockCliTransport
from .mock_netconf import MockNetconfTransport
from .mock_snmp import MockSnmpTransport
from .netconf import NcclientNetconfTransport, NetconfTransport
from .snmp import PysnmpTransport, SnmpTransport

__all__ = [
    # Exceptions
    "TransportError",
    "TransportConnectionError",
    "TransportAuthError",
    "TransportTimeoutError",
    "TransportProtocolError",
    # CLI
    "CliTransport",
    "AsyncSshCliTransport",
    # SNMP
    "SnmpTransport",
    "PysnmpTransport",
    # NETCONF
    "NetconfTransport",
    "NcclientNetconfTransport",
    # Mocks
    "MockCliTransport",
    "MockSnmpTransport",
    "MockNetconfTransport",
]
