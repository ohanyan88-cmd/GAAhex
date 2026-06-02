"""M1-B Phase 2 — OLT transport layer tests.

Covers the three Mock transports (the workhorses Phases 3-4 driver tests will
use), Protocol shape via runtime ``isinstance`` checks, and the import-error
behaviour of the real transports when their optional dependencies are absent.
"""
from __future__ import annotations

import importlib.util

import pytest

from app.services.olt.transport import (
    AsyncSshCliTransport,
    CliTransport,
    MockCliTransport,
    MockNetconfTransport,
    MockSnmpTransport,
    NcclientNetconfTransport,
    NetconfTransport,
    PysnmpTransport,
    SnmpTransport,
    TransportConnectionError,
    TransportProtocolError,
)


# ─────────────────────────────────────────────────────────────────────────────
# MockCliTransport
# ─────────────────────────────────────────────────────────────────────────────


def test_mock_cli_satisfies_cli_protocol() -> None:
    transport = MockCliTransport()
    assert isinstance(transport, CliTransport)


@pytest.mark.asyncio
async def test_mock_cli_execute_before_connect_raises() -> None:
    transport = MockCliTransport()
    with pytest.raises(TransportConnectionError):
        await transport.execute("display version")


@pytest.mark.asyncio
async def test_mock_cli_exact_match_response_wins() -> None:
    transport = MockCliTransport()
    transport.set_response("display version", "VERSION: MA5608T")
    transport.set_prefix_response("display", "FALLBACK")
    await transport.connect()
    try:
        assert await transport.execute("display version") == "VERSION: MA5608T"
    finally:
        await transport.close()


@pytest.mark.asyncio
async def test_mock_cli_prefix_match_when_no_exact() -> None:
    transport = MockCliTransport()
    transport.set_prefix_response("display board", "BOARD INFO")
    await transport.connect()
    try:
        assert await transport.execute("display board 0/1") == "BOARD INFO"
    finally:
        await transport.close()


@pytest.mark.asyncio
async def test_mock_cli_first_registered_prefix_wins_on_overlap() -> None:
    transport = MockCliTransport()
    transport.set_prefix_response("display", "FIRST")
    transport.set_prefix_response("display board", "SECOND")
    await transport.connect()
    try:
        # registration-order: "display" was first, so it wins even though
        # "display board" is a longer / more specific prefix.
        assert await transport.execute("display board 0") == "FIRST"
    finally:
        await transport.close()


@pytest.mark.asyncio
async def test_mock_cli_default_response_used_when_no_match() -> None:
    transport = MockCliTransport()
    transport.set_default_response("UNKNOWN COMMAND")
    await transport.connect()
    try:
        assert await transport.execute("garbage cmd") == "UNKNOWN COMMAND"
    finally:
        await transport.close()


@pytest.mark.asyncio
async def test_mock_cli_no_match_no_default_raises() -> None:
    transport = MockCliTransport()
    await transport.connect()
    try:
        with pytest.raises(TransportProtocolError):
            await transport.execute("anything")
    finally:
        await transport.close()


@pytest.mark.asyncio
async def test_mock_cli_executed_commands_history() -> None:
    transport = MockCliTransport()
    transport.set_default_response("OK")
    await transport.connect()
    try:
        await transport.execute("display version")
        await transport.execute("display board 0")
        await transport.execute("save")
    finally:
        await transport.close()
    assert transport.executed_commands == [
        "display version",
        "display board 0",
        "save",
    ]


@pytest.mark.asyncio
async def test_mock_cli_reset_clears_state() -> None:
    transport = MockCliTransport()
    transport.set_response("foo", "bar")
    transport.set_prefix_response("baz", "qux")
    transport.set_default_response("default")
    await transport.connect()
    try:
        await transport.execute("foo")
    finally:
        await transport.close()
    transport.reset()
    assert transport.executed_commands == []
    # Now reconnect and verify everything is gone: no exact, no prefix, no default.
    await transport.connect()
    try:
        with pytest.raises(TransportProtocolError):
            await transport.execute("foo")
    finally:
        await transport.close()


@pytest.mark.asyncio
async def test_mock_cli_async_context_manager() -> None:
    transport = MockCliTransport()
    transport.set_response("display version", "v1")
    async with transport as t:
        assert t is transport
        assert await t.execute("display version") == "v1"
    # After exit, execute should raise (not connected).
    with pytest.raises(TransportConnectionError):
        await transport.execute("display version")


# ─────────────────────────────────────────────────────────────────────────────
# MockSnmpTransport
# ─────────────────────────────────────────────────────────────────────────────


def test_mock_snmp_satisfies_snmp_protocol() -> None:
    transport = MockSnmpTransport()
    assert isinstance(transport, SnmpTransport)


@pytest.mark.asyncio
async def test_mock_snmp_get_before_connect_raises() -> None:
    transport = MockSnmpTransport()
    with pytest.raises(TransportConnectionError):
        await transport.get("1.3.6.1.2.1.1.1.0")


@pytest.mark.asyncio
async def test_mock_snmp_get_returns_set_value() -> None:
    transport = MockSnmpTransport()
    transport.set_oid("1.3.6.1.2.1.1.1.0", "Huawei MA5608T")
    async with transport:
        assert await transport.get("1.3.6.1.2.1.1.1.0") == "Huawei MA5608T"


@pytest.mark.asyncio
async def test_mock_snmp_get_returns_none_for_unknown_oid() -> None:
    transport = MockSnmpTransport()
    async with transport:
        assert await transport.get("1.3.6.1.2.1.999.999.0") is None


@pytest.mark.asyncio
async def test_mock_snmp_walk_returns_prefix_matches() -> None:
    transport = MockSnmpTransport()
    transport.set_oids(
        {
            "1.3.6.1.2.1.2.2.1.1.1": 1,
            "1.3.6.1.2.1.2.2.1.1.2": 2,
            "1.3.6.1.2.1.2.2.1.1.3": 3,
            "1.3.6.1.2.1.99.0": "other",
        }
    )
    async with transport:
        result = await transport.walk("1.3.6.1.2.1.2.2.1.1")
    assert result == {
        "1.3.6.1.2.1.2.2.1.1.1": 1,
        "1.3.6.1.2.1.2.2.1.1.2": 2,
        "1.3.6.1.2.1.2.2.1.1.3": 3,
    }


@pytest.mark.asyncio
async def test_mock_snmp_walk_empty_when_no_matches() -> None:
    transport = MockSnmpTransport()
    transport.set_oid("1.3.6.1.2.1.1.1.0", "x")
    async with transport:
        assert await transport.walk("9.9.9.9") == {}


@pytest.mark.asyncio
async def test_mock_snmp_set_oids_bulk_loads() -> None:
    transport = MockSnmpTransport()
    transport.set_oids({"a.b.c": 1, "a.b.d": 2})
    async with transport:
        assert await transport.get("a.b.c") == 1
        assert await transport.get("a.b.d") == 2


@pytest.mark.asyncio
async def test_mock_snmp_async_context_manager() -> None:
    transport = MockSnmpTransport()
    transport.set_oid("oid.1", "v1")
    async with transport as t:
        assert t is transport
        assert await t.get("oid.1") == "v1"
    # After exit: not connected → raises.
    with pytest.raises(TransportConnectionError):
        await transport.get("oid.1")


# ─────────────────────────────────────────────────────────────────────────────
# MockNetconfTransport
# ─────────────────────────────────────────────────────────────────────────────


def test_mock_netconf_satisfies_netconf_protocol() -> None:
    transport = MockNetconfTransport()
    assert isinstance(transport, NetconfTransport)


@pytest.mark.asyncio
async def test_mock_netconf_get_config_returns_preloaded() -> None:
    transport = MockNetconfTransport()
    config = "<config><onu id='1'/></config>"
    transport.set_config(config)
    async with transport:
        assert await transport.get_config() == config


@pytest.mark.asyncio
async def test_mock_netconf_edit_config_logs_and_returns_ok() -> None:
    transport = MockNetconfTransport()
    payload = "<edit><vlan id='100'/></edit>"
    async with transport:
        assert await transport.edit_config(payload) == "<ok/>"
        await transport.edit_config("<edit/>")
    assert transport.edit_log == [payload, "<edit/>"]


@pytest.mark.asyncio
async def test_mock_netconf_edit_log_is_read_only_copy() -> None:
    transport = MockNetconfTransport()
    async with transport:
        await transport.edit_config("<a/>")
    log = transport.edit_log
    log.append("mutated")  # mutating the returned list must not affect internal state
    assert transport.edit_log == ["<a/>"]


@pytest.mark.asyncio
async def test_mock_netconf_rpc_returns_canned_response() -> None:
    transport = MockNetconfTransport()
    transport.set_rpc_response("get-onu-status", {"status": "online"})
    async with transport:
        result = await transport.rpc("get-onu-status", {"id": "1"})
    assert result == {"status": "online"}
    assert transport.executed_rpcs == [("get-onu-status", {"id": "1"})]


@pytest.mark.asyncio
async def test_mock_netconf_rpc_unknown_name_raises() -> None:
    transport = MockNetconfTransport()
    async with transport:
        with pytest.raises(TransportProtocolError):
            await transport.rpc("not-registered")


@pytest.mark.asyncio
async def test_mock_netconf_async_context_manager() -> None:
    transport = MockNetconfTransport()
    transport.set_config("<c/>")
    async with transport as t:
        assert t is transport
        assert await t.get_config() == "<c/>"
    with pytest.raises(TransportConnectionError):
        await transport.get_config()


# ─────────────────────────────────────────────────────────────────────────────
# Real transports — import / construction / skeleton behaviour
# ─────────────────────────────────────────────────────────────────────────────


def test_async_ssh_cli_transport_import_behavior() -> None:
    """If asyncssh is available, construction works (we don't connect). If not,
    the constructor raises ImportError with the install hint."""
    asyncssh_available = importlib.util.find_spec("asyncssh") is not None
    if asyncssh_available:
        # Construction must succeed; we do NOT call connect() (no real network).
        transport = AsyncSshCliTransport(
            host="example.invalid", username="admin", password="x"
        )
        assert transport.host == "example.invalid"
        assert transport.port == 22
    else:
        with pytest.raises(ImportError, match="asyncssh"):
            AsyncSshCliTransport(host="example.invalid", username="admin")


def test_pysnmp_transport_import_behavior() -> None:
    """If pysnmp is available, construction works. If not, ImportError."""
    pysnmp_available = importlib.util.find_spec("pysnmp") is not None
    if pysnmp_available:
        transport = PysnmpTransport(host="example.invalid", community="public")
        assert transport.host == "example.invalid"
        assert transport.port == 161
    else:
        with pytest.raises(ImportError, match="pysnmp"):
            PysnmpTransport(host="example.invalid")


@pytest.mark.asyncio
async def test_ncclient_netconf_transport_skeleton_raises_on_connect() -> None:
    """Construction succeeds (no lazy import) but connect() raises NotImplementedError."""
    transport = NcclientNetconfTransport(
        host="example.invalid", username="admin", password="x"
    )
    assert transport.host == "example.invalid"
    assert transport.port == 830
    with pytest.raises(NotImplementedError, match="NETCONF transport deferred"):
        await transport.connect()
