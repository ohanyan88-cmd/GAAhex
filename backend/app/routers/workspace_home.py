"""Workspace home data — the ONE fetch behind the "My Work" page.

EN: GET /api/workspace?role=<workspace-role> returns the single typed WorkspaceData payload that
    feeds every widget in the frontend's gx-WorkspaceGrid (§11 one-layer: one request, one shape,
    the grid distributes it to the zone widgets). The response shape is locked by
    frontend/src/lib/workspace/contract.ts — keys are camelCase and MUST be emitted exactly as the
    frontend consumes this JSON directly (avatarUrl, nextAction, sourceTone, barPct, generatedAt,
    i18nKey, ...). The 13 pipeline stages are the locked Lead->Customer lifecycle; the Deal stage is
    tone='active' and Activation is tone='peak'.

    Q2 owner mandate (2026-06-15): contract-true SEEDED. Real values where trivially available are
    fine; anything seeded/derived is declared by dot-path in the response `sample[]` array so the UI
    can mark it and Phase 3 can swap it to a live query. NEVER present seeded data as live without
    listing it. This file currently seeds all dynamic widget data, so every dynamic dot-path is in
    `sample` — that list is the Phase 3 live-swap tracker, and it shrinks to [] as queries land.

HY: GET /api/workspace?role=<workspace-role>-ը վերադարձնում է մեկ typed WorkspaceData payload, որ
    սնում է "My Work" էջի բոլոր widget-երը (§11 one-layer՝ մեկ fetch, մեկ shape, gx-WorkspaceGrid-ը
    բաշխում է zone widget-երին)։ Shape-ը կողպված է contract.ts-ով — key-երը camelCase են ու պետք է
    ճիշտ էդպես արտածվեն, քանի որ frontend-ն ուղիղ սպառում է այս JSON-ը։ 13 pipeline փուլերը կողպված
    Lead->Customer lifecycle-ն են. Deal-ը tone='active', Activation-ը tone='peak'։

    Q2 owner mandate (2026-06-15)՝ contract-true SEEDED։ Real արժեքներ որտեղ կա, բայց ամեն seeded/
    derived դաշտ նշված է `sample[]`-ում՝ ոչ մի fake-as-real։ Հիմա ամբողջ dynamic data-ն seeded է,
    ուստի բոլոր dynamic dot-path-երը sample-ում են. այդ list-ը Phase 3-ի live-swap tracker-ն է։

Resolution: when `role` is omitted we reuse the EXACT logic of /api/me/workspace-role
(override -> primary -> derived -> fallback). When `role` is supplied it is validated against the 10
VALID_WORKSPACE_ROLES (reused from workspace.py) and an invalid value -> HTTP 400, matching the
existing PATCH validation style. Fixed path under "/api" — registered BEFORE records.router so it
isn't swallowed as an entity slug.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from .auth import current_user
from .workspace import (
    VALID_WORKSPACE_ROLES,
    _derive_from_assignments,
    _label_for,
)

router = APIRouter(prefix="/api", tags=["workspace"])


# --------------------------------------------------------------------------------------------------
# Pydantic response models — camelCase on the wire via alias + populate_by_name. We author the models
# in Python-idiomatic snake_case but every field carries a camelCase alias, and the endpoint dumps
# with by_alias=True so the JSON keys match contract.ts EXACTLY.
# Pydantic մոդելներ՝ camelCase wire-ի վրա alias-ով. Python-ում snake_case, JSON-ում camelCase։
# --------------------------------------------------------------------------------------------------
class _CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class WsTrend(_CamelModel):
    dir: str  # 'up' | 'down' | 'flat'
    pct: float


class WsKpi(_CamelModel):
    key: str
    label: str
    i18n_key: str = Field(alias="i18nKey")
    value: float
    unit: str | None = None
    trend: WsTrend | None = None
    spark: list[float] = Field(default_factory=list)
    tone: str | None = None  # 'default' | 'gold'


class WsPipelineStage(_CamelModel):
    key: str
    label: str
    i18n_key: str = Field(alias="i18nKey")
    count: int
    tone: str  # 'default' | 'active' | 'peak'


class WsQueueItem(_CamelModel):
    id: str
    name: str
    avatar_url: str | None = Field(default=None, alias="avatarUrl")
    source: str
    source_tone: str = Field(alias="sourceTone")  # WsSourceTone
    next_action: str = Field(alias="nextAction")
    score: int


class WsCall(_CamelModel):
    id: str
    at: str  # ISO datetime
    name: str
    kind: str  # 'call' | 'meeting' | 'followup'
    done: bool | None = None


class WsGoal(_CamelModel):
    label: str
    i18n_key: str = Field(alias="i18nKey")
    current: float
    target: float
    pct: float


class WsDeal(_CamelModel):
    id: str
    name: str
    value: float
    stage: str
    waiting_for: str = Field(alias="waitingFor")
    age: str


class WsAlert(_CamelModel):
    id: str
    severity: str  # 'info' | 'warning' | 'danger'
    text: str
    at: str  # ISO datetime
    critical: bool | None = None


class WsStanding(_CamelModel):
    rank: int
    name: str
    avatar_url: str | None = Field(default=None, alias="avatarUrl")
    conversion: float
    revenue: float
    bar_pct: float = Field(alias="barPct")


class WsFocus(_CamelModel):
    summary: str


class WsPipeline(_CamelModel):
    stages: list[WsPipelineStage]


class WorkspaceData(_CamelModel):
    role: str
    label: str
    source: str  # 'override' | 'primary' | 'derived' | 'fallback'
    generated_at: str = Field(alias="generatedAt")
    focus: WsFocus
    kpis: list[WsKpi]
    pipeline: WsPipeline
    queue: list[WsQueueItem]
    calls: list[WsCall]
    goal: WsGoal
    deals: list[WsDeal]
    alerts: list[WsAlert]
    team: list[WsStanding]
    sample: list[str]


# --------------------------------------------------------------------------------------------------
# Pipeline spine — the locked 13-stage Lead->Customer lifecycle. tone: Deal='active' (azure),
# Activation='peak' (gold), everything else 'default' (slate). Counts are seeded (declared in sample).
# Pipeline ողնաշար — կողպված 13-փուլ lifecycle. Deal='active', Activation='peak', մնացածը 'default'։
# --------------------------------------------------------------------------------------------------
_PIPELINE_SPINE: list[tuple[str, str, str]] = [
    # (key, English label, tone)
    ("lead",             "Lead",            "default"),
    ("validated_lead",   "Validated Lead",  "default"),
    ("assigned",         "Assigned",        "default"),
    ("deal",             "Deal",            "active"),
    ("contract_signed",  "Contract Signed", "default"),
    ("order_created",    "Order Created",   "default"),
    ("order_validated",  "Order Validated", "default"),
    ("scheduling",       "Scheduling",      "default"),
    ("config",           "Config",          "default"),
    ("installation",     "Installation",    "default"),
    ("connection_test",  "Connection Test", "default"),
    ("payment_confirmed","Payment Confirmed","default"),
    ("activation",       "Activation",      "peak"),
]


def _now_iso() -> str:
    """UTC ISO-8601 with Z suffix — the contract's `generatedAt` / `at` format."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _at(hour: int, minute: int = 0) -> str:
    """Today at HH:MM UTC as ISO — seeds today's-calls timeline deterministically."""
    base = datetime.now(timezone.utc).replace(hour=hour, minute=minute, second=0, microsecond=0)
    return base.isoformat().replace("+00:00", "Z")


def _pipeline(counts: list[int]) -> WsPipeline:
    """Build the 13-stage pipeline from a per-stage count vector (len == 13)."""
    stages = [
        WsPipelineStage(
            key=key,
            label=label,
            i18nKey=f"pipeline.stage.{key}",
            count=count,
            tone=tone,
        )
        for (key, label, tone), count in zip(_PIPELINE_SPINE, counts)
    ]
    return WsPipeline(stages=stages)


# Dynamic dot-paths that are seeded (not yet live). Phase 3 removes a path from here as each widget's
# query lands. Pipeline COUNTS are seeded too, so 'pipeline' is included (the stage spine itself is
# the locked contract, but the per-stage numbers are derived).
_SEEDED_PATHS: list[str] = [
    "focus", "kpis", "pipeline", "queue", "calls", "goal", "deals", "alerts", "team",
]


# --------------------------------------------------------------------------------------------------
# SALES-AGENT composition — the full b2b_am / d2d_agent / retail_agent workspace. Focus line, 4 KPIs
# (the Revenue tile is the ONE gold-tone accent), the 13-stage pipeline, a priority queue, today's
# calls, a weekly goal, deals waiting, alerts, and team standings (rank 1 = gold on the frontend).
# SALES-AGENT composition — լրիվ վաճառքի workspace. Revenue tile-ը միակ gold accent-ն է։
# --------------------------------------------------------------------------------------------------
def _sales_payload(role: str, label: str, source: str) -> WorkspaceData:
    return WorkspaceData(
        role=role,
        label=label,
        source=source,
        generatedAt=_now_iso(),
        focus=WsFocus(
            summary=(
                "You have 3 hot deals waiting on signatures and 6 calls before lunch. "
                "Close GlobalTel today to hit your weekly goal."
            ),
        ),
        kpis=[
            WsKpi(
                key="revenue", label="Revenue (MTD)", i18nKey="kpi.revenue",
                value=48250, unit="USD",
                trend=WsTrend(dir="up", pct=12.4),
                spark=[31000, 34500, 33800, 39200, 42100, 45600, 48250],
                tone="gold",  # the single signature accent for this view (Revenue)
            ),
            WsKpi(
                key="conversion", label="Conversion", i18nKey="kpi.conversion",
                value=34.2, unit="%",
                trend=WsTrend(dir="up", pct=3.1),
                spark=[28, 29, 31, 30, 32, 33, 34.2],
                tone="default",
            ),
            WsKpi(
                key="deals_open", label="Open Deals", i18nKey="kpi.deals_open",
                value=17,
                trend=WsTrend(dir="flat", pct=0.0),
                spark=[15, 16, 16, 17, 18, 17, 17],
                tone="default",
            ),
            WsKpi(
                key="avg_cycle", label="Avg Cycle", i18nKey="kpi.avg_cycle",
                value=9.5, unit="d",
                trend=WsTrend(dir="down", pct=-8.0),
                spark=[12, 11.5, 11, 10.2, 10, 9.8, 9.5],
                tone="default",
            ),
        ],
        pipeline=_pipeline([42, 31, 24, 17, 12, 9, 8, 7, 6, 5, 4, 3, 11]),
        queue=[
            WsQueueItem(id="lead-9001", name="GlobalTel Networks", source="Referral",
                        sourceTone="success", nextAction="Send contract", score=92,
                        avatarUrl=None),
            WsQueueItem(id="lead-9002", name="Aragats Holdings", source="Web Form",
                        sourceTone="info", nextAction="Discovery call", score=81,
                        avatarUrl=None),
            WsQueueItem(id="lead-9003", name="Sevan Logistics", source="Cold Outreach",
                        sourceTone="warning", nextAction="Re-engage", score=64,
                        avatarUrl=None),
            WsQueueItem(id="lead-9004", name="Yerevan Mall LLC", source="Partner",
                        sourceTone="neutral", nextAction="Pricing follow-up", score=58,
                        avatarUrl=None),
        ],
        calls=[
            WsCall(id="call-1", at=_at(9, 30), name="GlobalTel Networks", kind="call", done=True),
            WsCall(id="call-2", at=_at(11, 0), name="Aragats Holdings", kind="meeting", done=False),
            WsCall(id="call-3", at=_at(13, 15), name="Sevan Logistics", kind="followup", done=False),
            WsCall(id="call-4", at=_at(15, 45), name="Yerevan Mall LLC", kind="call", done=False),
        ],
        goal=WsGoal(label="Weekly Revenue Goal", i18nKey="goal.weekly_revenue",
                    current=48250, target=60000, pct=80.4),
        deals=[
            WsDeal(id="deal-7001", name="GlobalTel Networks", value=18500,
                   stage="Deal", waitingFor="Signature", age="2d"),
            WsDeal(id="deal-7002", name="Aragats Holdings", value=9800,
                   stage="Contract Signed", waitingFor="PO number", age="3d"),
            WsDeal(id="deal-7003", name="Sevan Logistics", value=6400,
                   stage="Order Validated", waitingFor="Scheduling", age="5d"),
        ],
        alerts=[
            WsAlert(id="alert-1", severity="danger",
                    text="GlobalTel contract expires end of week — close now.",
                    at=_now_iso(), critical=True),
            WsAlert(id="alert-2", severity="warning",
                    text="2 deals stalled in Scheduling for 5+ days.", at=_now_iso()),
            WsAlert(id="alert-3", severity="info",
                    text="New inbound lead assigned: Yerevan Mall LLC.", at=_now_iso()),
        ],
        team=[
            WsStanding(rank=1, name="Anahit G.", conversion=41.0, revenue=72100, barPct=100,
                       avatarUrl=None),
            WsStanding(rank=2, name="You", conversion=34.2, revenue=48250, barPct=67,
                       avatarUrl=None),
            WsStanding(rank=3, name="Davit M.", conversion=29.5, revenue=39800, barPct=55,
                       avatarUrl=None),
            WsStanding(rank=4, name="Lilit S.", conversion=26.1, revenue=31200, barPct=43,
                       avatarUrl=None),
        ],
        sample=list(_SEEDED_PATHS),
    )


# --------------------------------------------------------------------------------------------------
# Per-role tuning for the non-sales roles. Each entry yields a coherent, CONTRACT-COMPLETE payload:
# every field present and valid, the 13-stage pipeline always intact (Deal='active', Activation=
# 'peak'), with the focus line, KPIs, queue, calls, goal, deals, alerts, and team standings tuned to
# the role's day. Revenue stays the ONE gold KPI (it's the signature accent for every view).
# Non-sales դերերի tuning — ամեն դաշտ առկա ու valid, pipeline-ը միշտ ամբողջական։
# --------------------------------------------------------------------------------------------------
def _role_payload(role: str, label: str, source: str) -> WorkspaceData:
    """Build a contract-complete payload for a non-sales role. Sales roles never reach here."""
    # Per-role copy: focus summary, KPI quartet (one gold Revenue/value tile), goal, and pipeline
    # count vector. Queue/calls/deals/alerts/team are seeded with role-appropriate rows below.
    profiles: dict[str, dict] = {
        "ceo": {
            "focus": "Org is on pace: revenue +12% MoM, 2 SLAs at risk, churn flat. "
                     "Review the GlobalTel renewal and the NOC outage post-mortem.",
            "kpis": [
                ("revenue", "Revenue (MTD)", "kpi.revenue", 412800, "USD", "up", 11.6,
                 [330, 352, 360, 381, 395, 404, 412.8], "gold"),
                ("active_customers", "Active Customers", "kpi.active_customers", 8420, None,
                 "up", 2.3, [8100, 8180, 8240, 8300, 8360, 8400, 8420], "default"),
                ("churn", "Churn", "kpi.churn", 1.8, "%", "down", -0.4,
                 [2.4, 2.3, 2.1, 2.0, 1.9, 1.9, 1.8], "default"),
                ("nps", "NPS", "kpi.nps", 62, None, "up", 4.0,
                 [54, 55, 57, 58, 60, 61, 62], "default"),
            ],
            "pipeline": [120, 88, 71, 54, 40, 33, 29, 25, 22, 19, 15, 12, 31],
            "goal": ("Quarterly Revenue Goal", "goal.quarterly_revenue", 412800, 500000, 82.6),
        },
        "support_t1": {
            "focus": "9 tickets in your queue, 2 breaching SLA in under an hour. "
                     "Clear the password-reset backlog first — fastest wins.",
            "kpis": [
                ("revenue", "Recovered Revenue", "kpi.revenue", 3450, "USD", "up", 6.2,
                 [2800, 2950, 3010, 3120, 3280, 3390, 3450], "gold"),
                ("open_tickets", "Open Tickets", "kpi.open_tickets", 9, None, "down", -10.0,
                 [14, 13, 12, 11, 10, 10, 9], "default"),
                ("csat", "CSAT", "kpi.csat", 91, "%", "up", 1.5,
                 [86, 87, 88, 89, 90, 90, 91], "default"),
                ("first_response", "Avg First Response", "kpi.first_response", 4.2, "m",
                 "down", -12.0, [6, 5.5, 5, 4.8, 4.5, 4.3, 4.2], "default"),
            ],
            "pipeline": [18, 14, 12, 9, 7, 6, 5, 5, 4, 4, 3, 2, 6],
            "goal": ("Daily Tickets Resolved", "goal.daily_tickets", 14, 20, 70.0),
        },
        "support_t2": {
            "focus": "4 escalations need your depth today. The fiber-loss case (CN-4471) "
                     "has a customer waiting 6h — take it first.",
            "kpis": [
                ("revenue", "Retained Revenue", "kpi.revenue", 5120, "USD", "up", 4.8,
                 [4400, 4550, 4680, 4800, 4950, 5050, 5120], "gold"),
                ("escalations", "Open Escalations", "kpi.escalations", 4, None, "flat", 0.0,
                 [5, 4, 4, 5, 4, 4, 4], "default"),
                ("resolution_rate", "Resolution Rate", "kpi.resolution_rate", 88, "%", "up", 2.0,
                 [82, 83, 85, 86, 87, 88, 88], "default"),
                ("avg_handle", "Avg Handle Time", "kpi.avg_handle", 38, "m", "down", -7.0,
                 [48, 45, 43, 41, 40, 39, 38], "default"),
            ],
            "pipeline": [12, 10, 9, 7, 6, 5, 5, 4, 4, 3, 3, 2, 5],
            "goal": ("Weekly Escalations Closed", "goal.weekly_escalations", 12, 18, 66.7),
        },
        "field_tech": {
            "focus": "5 installs on today's route, first at 09:00 in Arabkir. "
                     "Pick up the spare ONT before you head out — 2 jobs need it.",
            "kpis": [
                ("revenue", "Job Value Today", "kpi.revenue", 2200, "USD", "up", 9.0,
                 [1700, 1800, 1900, 2000, 2050, 2150, 2200], "gold"),
                ("jobs_today", "Jobs Today", "kpi.jobs_today", 5, None, "flat", 0.0,
                 [4, 5, 6, 5, 5, 4, 5], "default"),
                ("first_time_fix", "First-Time Fix", "kpi.first_time_fix", 94, "%", "up", 1.0,
                 [90, 91, 92, 93, 93, 94, 94], "default"),
                ("avg_install", "Avg Install Time", "kpi.avg_install", 72, "m", "down", -5.0,
                 [85, 82, 80, 78, 75, 73, 72], "default"),
            ],
            "pipeline": [0, 0, 8, 0, 0, 6, 6, 6, 5, 5, 4, 0, 3],
            "goal": ("Daily Installs Completed", "goal.daily_installs", 2, 5, 40.0),
        },
        "noc_engineer": {
            "focus": "Network healthy: 1 OLT degraded in Davtashen, 3 ONUs flapping. "
                     "OTDR scan queued for the Sevan trunk — review before the maintenance window.",
            "kpis": [
                ("revenue", "Revenue at Risk", "kpi.revenue", 8900, "USD", "down", -3.0,
                 [12000, 11200, 10500, 9900, 9400, 9100, 8900], "gold"),
                ("uptime", "Uptime", "kpi.uptime", 99.96, "%", "up", 0.02,
                 [99.9, 99.91, 99.93, 99.94, 99.95, 99.95, 99.96], "default"),
                ("active_alarms", "Active Alarms", "kpi.active_alarms", 4, None, "down", -20.0,
                 [8, 7, 6, 5, 5, 4, 4], "default"),
                ("onus_online", "ONUs Online", "kpi.onus_online", 8392, None, "up", 0.5,
                 [8350, 8360, 8370, 8378, 8385, 8390, 8392], "default"),
            ],
            "pipeline": [0, 0, 0, 0, 0, 0, 12, 10, 9, 8, 14, 0, 22],
            "goal": ("Alarms Cleared This Week", "goal.weekly_alarms", 26, 30, 86.7),
        },
        "billing_spec": {
            "focus": "14 invoices to issue, 6 dunning cases past day-30, 1 disputed charge. "
                     "Run the credit note for Aragats first — finance is waiting on it.",
            "kpis": [
                ("revenue", "Collected (MTD)", "kpi.revenue", 96400, "USD", "up", 8.1,
                 [78000, 82000, 85000, 88000, 91000, 94000, 96400], "gold"),
                ("overdue", "Overdue Amount", "kpi.overdue", 12300, "USD", "down", -14.0,
                 [18000, 16500, 15200, 14000, 13100, 12600, 12300], "default"),
                ("collection_rate", "Collection Rate", "kpi.collection_rate", 93, "%", "up", 2.0,
                 [88, 89, 90, 91, 92, 92, 93], "default"),
                ("open_disputes", "Open Disputes", "kpi.open_disputes", 1, None, "down", -50.0,
                 [3, 3, 2, 2, 2, 1, 1], "default"),
            ],
            "pipeline": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 22, 38],
            "goal": ("Monthly Collection Goal", "goal.monthly_collection", 96400, 110000, 87.6),
        },
        "general": {
            "focus": "Welcome back. You have 3 tasks due today and 1 approval waiting. "
                     "Start with the timesheet approval — it's blocking the team.",
            "kpis": [
                ("revenue", "Team Revenue (MTD)", "kpi.revenue", 24600, "USD", "up", 5.0,
                 [20000, 21000, 21800, 22500, 23300, 24000, 24600], "gold"),
                ("open_tasks", "Open Tasks", "kpi.open_tasks", 3, None, "down", -25.0,
                 [6, 5, 5, 4, 4, 3, 3], "default"),
                ("approvals", "Pending Approvals", "kpi.approvals", 1, None, "flat", 0.0,
                 [2, 1, 1, 2, 1, 1, 1], "default"),
                ("activity", "Activity Score", "kpi.activity", 78, None, "up", 4.0,
                 [70, 72, 73, 75, 76, 77, 78], "default"),
            ],
            "pipeline": [10, 7, 6, 4, 3, 3, 2, 2, 2, 1, 1, 1, 3],
            "goal": ("Weekly Tasks Done", "goal.weekly_tasks", 9, 15, 60.0),
        },
    }

    # Defensive fallback: any valid-but-unprofiled role gets the 'general' shape. Cannot normally
    # happen (the dict covers all non-sales roles), but keeps the contract intact if the role set grows.
    p = profiles.get(role, profiles["general"])

    fk = p["kpis"]
    kpis = [
        WsKpi(
            key=key, label=lbl, i18nKey=i18n, value=val, unit=unit,
            trend=WsTrend(dir=tdir, pct=tpct), spark=[float(x) for x in spark], tone=tone,
        )
        for (key, lbl, i18n, val, unit, tdir, tpct, spark, tone) in fk
    ]

    glabel, gi18n, gcur, gtar, gpct = p["goal"]

    return WorkspaceData(
        role=role,
        label=label,
        source=source,
        generatedAt=_now_iso(),
        focus=WsFocus(summary=p["focus"]),
        kpis=kpis,
        pipeline=_pipeline(p["pipeline"]),
        queue=[
            WsQueueItem(id=f"{role}-q1", name="Item A", source="Inbound", sourceTone="info",
                        nextAction="Review", score=74, avatarUrl=None),
            WsQueueItem(id=f"{role}-q2", name="Item B", source="Assigned", sourceTone="neutral",
                        nextAction="Action", score=61, avatarUrl=None),
            WsQueueItem(id=f"{role}-q3", name="Item C", source="Escalated", sourceTone="warning",
                        nextAction="Follow up", score=49, avatarUrl=None),
        ],
        calls=[
            WsCall(id=f"{role}-c1", at=_at(9, 0), name="Standup", kind="meeting", done=True),
            WsCall(id=f"{role}-c2", at=_at(11, 30), name="Customer check-in", kind="call",
                   done=False),
            WsCall(id=f"{role}-c3", at=_at(14, 0), name="Follow-up", kind="followup", done=False),
        ],
        goal=WsGoal(label=glabel, i18nKey=gi18n, current=gcur, target=gtar, pct=gpct),
        deals=[
            WsDeal(id=f"{role}-d1", name="Open item 1", value=4200, stage="Deal",
                   waitingFor="Action", age="1d"),
            WsDeal(id=f"{role}-d2", name="Open item 2", value=2800, stage="Scheduling",
                   waitingFor="Customer", age="3d"),
        ],
        alerts=[
            WsAlert(id=f"{role}-a1", severity="warning", text="1 item needs attention today.",
                    at=_now_iso()),
            WsAlert(id=f"{role}-a2", severity="info", text="Daily summary ready.", at=_now_iso()),
        ],
        team=[
            WsStanding(rank=1, name="Top performer", conversion=38.0, revenue=51000, barPct=100,
                       avatarUrl=None),
            WsStanding(rank=2, name="You", conversion=30.0, revenue=37000, barPct=72,
                       avatarUrl=None),
            WsStanding(rank=3, name="Teammate", conversion=25.0, revenue=29000, barPct=57,
                       avatarUrl=None),
        ],
        sample=list(_SEEDED_PATHS),
    )


_SALES_ROLES: frozenset[str] = frozenset({"b2b_am", "d2d_agent", "retail_agent"})


@router.get("/workspace", response_model=WorkspaceData, response_model_by_alias=True)
async def get_workspace(
    role: str | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> WorkspaceData:
    """Return the complete WorkspaceData payload for one workspace role.

    EN: `role` is optional. When supplied it is validated against the 10 VALID_WORKSPACE_ROLES
        (invalid -> 400, matching the PATCH style in workspace.py). When omitted, the role is
        resolved with the SAME order as /api/me/workspace-role: override -> primary -> derived ->
        'general' fallback, and `source` reflects which step won. Sales roles
        (b2b_am/d2d_agent/retail_agent) get the full sales composition; the others get a
        contract-complete payload tuned to the role. All dynamic data is seeded and declared in
        `sample` (Phase 3 live-swap tracker).

    HY: `role`-ը optional է։ Տրված դեպքում validate-վում է 10 VALID_WORKSPACE_ROLES-ի դեմ (invalid ->
        400)։ Բացակայության դեպքում resolve-վում է նույն կարգով, ինչ /api/me/workspace-role-ը։
        Վաճառքի դերերը ստանում են լրիվ sales composition, մյուսները՝ contract-complete payload։
    """
    # --- Determine role + source -----------------------------------------------------------------
    if role is not None:
        # Explicit role: validate against the registry (mirror the PATCH 400 in workspace.py).
        if role not in VALID_WORKSPACE_ROLES:
            raise HTTPException(
                400,
                f"Invalid workspace role '{role}'. Allowed: {sorted(VALID_WORKSPACE_ROLES)}",
            )
        resolved_role = role
        source = "override"  # caller explicitly picked the layout
    else:
        # No role given: resolve exactly like /api/me/workspace-role (override -> primary ->
        # derived -> fallback). We reload the user on the RLS-subject session so columns are fresh,
        # then walk the same precedence. Stale/removed keys fall through (graceful, never 500).
        from sqlalchemy import select  # local import keeps the module's top imports tight

        row = (await s.execute(select(User).where(User.id == user.id))).scalar_one_or_none()  # tenant-filter-ok: cross-tenant — RLS-scoped self-reload (mirrors me.py._own_row)
        if row is None:
            raise HTTPException(404, "User not found")

        if row.workspace_role_override and row.workspace_role_override in VALID_WORKSPACE_ROLES:
            resolved_role, source = row.workspace_role_override, "override"
        elif row.primary_role_key and row.primary_role_key in VALID_WORKSPACE_ROLES:
            resolved_role, source = row.primary_role_key, "primary"
        else:
            derived = await _derive_from_assignments(s, row)
            if derived is not None:
                resolved_role, source = derived, "derived"
            else:
                resolved_role, source = "general", "fallback"

    label = _label_for(resolved_role)

    # --- Compose the payload ---------------------------------------------------------------------
    if resolved_role in _SALES_ROLES:
        return _sales_payload(resolved_role, label, source)
    return _role_payload(resolved_role, label, source)
