// Workspace roles — the canonical 10-role vocabulary (mirrors the backend's
// workspace.py VALID_WORKSPACE_ROLES).
//
// EN: The backend resolves each user to ONE of these via GET /api/me/workspace-role, and
//     GET /api/workspace returns that role's complete typed payload. gx-WorkspaceGrid renders the
//     role-driven composition from that payload. Phase 2 (2026-06-15) replaced the old per-widget
//     registry (WidgetDef / resolveWidgets / the wx-* widgets) with the contract-driven grid, so
//     this file now owns ONLY the role set — its single, shared source of truth.
// HY: Backend-ը ամեն օգտատիրոջ resolve է անում այս 10-ից մեկին (GET /api/me/workspace-role), իսկ
//     GET /api/workspace-ը վերադարձնում է այդ role-ի ամբողջական typed payload-ը։ gx-WorkspaceGrid-ը
//     render է անում role-driven composition-ը։ Phase 2-ը հին per-widget registry-ն փոխարինեց
//     contract-driven grid-ով, ուստի այս ֆայլը հիմա պահում է ՄԻԱՅՆ role set-ը։

export type WorkspaceRole =
  | 'ceo'
  | 'd2d_agent'
  | 'retail_agent'
  | 'b2b_am'
  | 'support_t1'
  | 'support_t2'
  | 'field_tech'
  | 'noc_engineer'
  | 'billing_spec'
  | 'general'

/** Every workspace role, ordered for the layout switcher (executive first, generalist last). */
export const ALL_WORKSPACE_ROLES: WorkspaceRole[] = [
  'ceo',
  'b2b_am',
  'd2d_agent',
  'retail_agent',
  'support_t1',
  'support_t2',
  'field_tech',
  'noc_engineer',
  'billing_spec',
  'general',
]
