"""GAAhex kernel — fixed engines that interpret config.

The kernel is the small set of MODULES that NEVER change with feature work: workflow movement,
auth/authz, database, audit/log, security. Everything else above the Kernel Line is configuration
the kernel reads at runtime.

This package owns the cross-cutting invariants from SPEC §0 — the 7 Global Invariants that hold
true everywhere in GAAhex. DB-level halves of those invariants live in alembic migrations (see
`b70ef3b98e27_kernel_invariants_db_triggers_region_id.py`); the runtime/application halves live in
`invariants.py` here.

Public surface:
    - OwnerViolation, AccessDenied, DuplicateMasterData, CrossRegionDenied — typed exceptions
      mapped to HTTP 409 / 403 / 409 / 403 respectively.
    - ControlGateNotPassed         — SPEC §3 Stage 8 / §10.4 (Step 4) — HTTP 409 at routers.
    - assert_writer_owns_record    — SPEC §0.1 single-owner write lock (config-driven entities)
    - assert_writer_owns_record_firstclass — SPEC §0.1 single-owner write lock (first-class tables)
    - FIRST_CLASS_OWNER_MAP        — SPEC §2.2 ownership matrix for first-class typed tables
    - assert_can                   — SPEC §0.2 default-deny facade
    - assert_no_inline_master_copies — SPEC §0.5 references-not-copies
    - assert_can_read_region       — SPEC §0.6 cross-region read guard
    - assert_can_advance_to_scheduling — SPEC §3 Stage 8 Control Gate (Step 4)
"""
from .invariants import (
    MASTER_RECORD_KEYS,
    FIRST_CLASS_OWNER_MAP,
    OwnerViolation,
    AccessDenied,
    DuplicateMasterData,
    CrossRegionDenied,
    assert_writer_owns_record,
    assert_writer_owns_record_firstclass,
    assert_can,
    assert_no_inline_master_copies,
    assert_can_read_region,
)
from .control_gate import (
    ControlGateNotPassed,
    assert_can_advance_to_scheduling,
)
from .approvals import (
    ApprovalRequired,
    MANDATORY_APPROVAL_ACTIONS,
    assert_approval_or_raise,
    create_approval_request,
    decide_approval,
    find_approved_approval,
    mark_approval_executed,
)
from .kpi_engine import (
    KpiEvaluationError,
    evaluate_kpi,
    evaluate_all_kpis,
)
from .timeline import (
    SPEC_8_TIMELINE_KINDS,
    classify_event,
    get_customer_timeline,
)
from .workflow_engine import (
    WorkflowExecutionError,
    trigger_workflow,
    execute_action,
)

__all__ = [
    "MASTER_RECORD_KEYS",
    "FIRST_CLASS_OWNER_MAP",
    "OwnerViolation",
    "AccessDenied",
    "DuplicateMasterData",
    "CrossRegionDenied",
    "ControlGateNotPassed",
    "ApprovalRequired",
    "MANDATORY_APPROVAL_ACTIONS",
    "KpiEvaluationError",
    "assert_writer_owns_record",
    "assert_writer_owns_record_firstclass",
    "assert_can",
    "assert_no_inline_master_copies",
    "assert_can_read_region",
    "assert_can_advance_to_scheduling",
    "assert_approval_or_raise",
    "create_approval_request",
    "decide_approval",
    "find_approved_approval",
    "mark_approval_executed",
    "evaluate_kpi",
    "evaluate_all_kpis",
    "SPEC_8_TIMELINE_KINDS",
    "classify_event",
    "get_customer_timeline",
    "WorkflowExecutionError",
    "trigger_workflow",
    "execute_action",
]
