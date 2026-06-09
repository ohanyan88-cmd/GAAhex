// Generated from Standard 15 — Central Permission Registry (docs/standards/15-permission-registry.md)
// Key format: object.action — lowercase, dot-separated. Immutable once released.
// These constants are the ONLY place permission key strings should appear in frontend code.

export const PERM = {
  // ── Comment ──────────────────────────────────────────────────────────────────
  COMMENT_CREATE:        'comment.create',
  COMMENT_EDIT:          'comment.edit',
  COMMENT_DELETE:        'comment.delete',
  COMMENT_VIEW_INTERNAL: 'comment.view_internal',
  COMMENT_VIEW_EXTERNAL: 'comment.view_external',
  COMMENT_VIEW_PRIVATE:  'comment.view_private',
  COMMENT_MODERATE:      'comment.moderate',

  // ── Attachment ────────────────────────────────────────────────────────────────
  ATTACHMENT_VIEW:         'attachment.view',
  ATTACHMENT_DOWNLOAD:     'attachment.download',
  ATTACHMENT_UPLOAD:       'attachment.upload',
  ATTACHMENT_DELETE:       'attachment.delete',
  ATTACHMENT_REFERENCE:    'attachment.reference',
  ATTACHMENT_VIEW_DELETED: 'attachment.view_deleted',

  // ── Task ─────────────────────────────────────────────────────────────────────
  TASK_VIEW:     'task.view',
  TASK_CREATE:   'task.create',
  TASK_EDIT:     'task.edit',
  TASK_ASSIGN:   'task.assign',
  TASK_COMPLETE: 'task.complete',
  TASK_CANCEL:   'task.cancel',
  TASK_REOPEN:   'task.reopen',
  TASK_DELETE:   'task.delete',
  TASK_COMMENT:  'task.comment',
  TASK_ATTACH:   'task.attach',

  // ── Watcher ───────────────────────────────────────────────────────────────────
  WATCH_VIEW:          'watch.view',
  WATCH_ADD:           'watch.add',
  WATCH_REMOVE:        'watch.remove',
  WATCH_PAUSE:         'watch.pause',
  WATCH_RESUME:        'watch.resume',
  WATCH_MANAGE_OTHERS: 'watch.manage_others',

  // ── Notification ──────────────────────────────────────────────────────────────
  NOTIFICATION_VIEW:               'notification.view',
  NOTIFICATION_MANAGE_PREFERENCES: 'notification.manage_preferences',
  NOTIFICATION_ACKNOWLEDGE:        'notification.acknowledge',
  NOTIFICATION_DISMISS:            'notification.dismiss',
  NOTIFICATION_MANAGE:             'notification.manage',

  // ── Reporting / Import / Export ───────────────────────────────────────────────
  REPORT_VIEW:   'report.view',
  REPORT_EXPORT: 'report.export',
  IMPORT_RUN:    'import.run',
  EXPORT_RUN:    'export.run',

  // ── Configuration / Feature Flag (Super Admin) ────────────────────────────────
  CONFIGURATION_MANAGE: 'configuration.manage',
  FEATURE_FLAG_MANAGE:  'feature_flag.manage',

  // ── Workflow / SLA / Relationship / Communication / Webhook / API ─────────────
  WORKFLOW_MANAGE:      'workflow.manage',
  SLA_MANAGE:           'sla.manage',
  RELATIONSHIP_CREATE:  'relationship.create',
  RELATIONSHIP_DELETE:  'relationship.delete',
  COMMUNICATION_VIEW:   'communication.view',
  COMMUNICATION_SEND:   'communication.send',
  WEBHOOK_MANAGE:       'webhook.manage',
  API_KEY_MANAGE:       'api_key.manage',

  // ── RBAC Administration ───────────────────────────────────────────────────────
  ROLE_VIEW:                'role.view',
  ROLE_MANAGE:              'role.manage',
  PERMISSION_MANAGE:        'permission.manage',
  PERMISSION_GROUP_MANAGE:  'permission_group.manage',
  USER_MANAGE_ROLES:        'user.manage_roles',

  // ── CRM ───────────────────────────────────────────────────────────────────────
  LEAD_VIEW:     'lead.view',
  LEAD_CREATE:   'lead.create',
  LEAD_EDIT:     'lead.edit',
  LEAD_DELETE:   'lead.delete',

  CUSTOMER_VIEW:   'customer.view',
  CUSTOMER_CREATE: 'customer.create',
  CUSTOMER_EDIT:   'customer.edit',
  CUSTOMER_DELETE: 'customer.delete',

  CONTACT_VIEW:   'contact.view',
  CONTACT_CREATE: 'contact.create',
  CONTACT_EDIT:   'contact.edit',
  CONTACT_DELETE: 'contact.delete',

  DEAL_VIEW:   'deal.view',
  DEAL_CREATE: 'deal.create',
  DEAL_EDIT:   'deal.edit',
  DEAL_DELETE: 'deal.delete',

  TICKET_VIEW:   'ticket.view',
  TICKET_CREATE: 'ticket.create',
  TICKET_EDIT:   'ticket.edit',
  TICKET_DELETE: 'ticket.delete',

  // ── Helpdesk ──────────────────────────────────────────────────────────────────
  HELPDESK_TICKET_VIEW:   'helpdesk_ticket.view',
  HELPDESK_TICKET_CREATE: 'helpdesk_ticket.create',
  HELPDESK_TICKET_EDIT:   'helpdesk_ticket.edit',
  HELPDESK_TICKET_DELETE: 'helpdesk_ticket.delete',
  HELPDESK_QUEUE_VIEW:    'helpdesk_queue.view',
  HELPDESK_QUEUE_MANAGE:  'helpdesk_queue.manage',

  // ── WorkItem ──────────────────────────────────────────────────────────────────
  WORKITEM_VIEW:   'workitem.view',
  WORKITEM_CREATE: 'workitem.create',
  WORKITEM_EDIT:   'workitem.edit',
  WORKITEM_DELETE: 'workitem.delete',

  // ── Payment / Billing ─────────────────────────────────────────────────────────
  PAYMENT_ORDER_VIEW:    'payment_order.view',
  PAYMENT_ORDER_COLLECT: 'payment_order.collect',
  INVOICE_VIEW:          'invoice.view',
  INVOICE_CREATE:        'invoice.create',
  INVOICE_EDIT:          'invoice.edit',
  INVOICE_DELETE:        'invoice.delete',
  PAYMENT_VIEW:          'payment.view',
  PAYMENT_CREATE:        'payment.create',
  PAYMENT_EDIT:          'payment.edit',
  PAYMENT_DELETE:        'payment.delete',

  // ── Self-service Requests ─────────────────────────────────────────────────────
  REQUEST_VIEW:   'request.view',
  REQUEST_CREATE: 'request.create',
  REQUEST_EDIT:   'request.edit',
  REQUEST_DELETE: 'request.delete',

  // ── Governance ────────────────────────────────────────────────────────────────
  AUDIT_VIEW:         'audit.view',
  ESCALATION_MANAGE:  'escalation.manage',

  // ── Services / Network ────────────────────────────────────────────────────────
  SERVICE_VIEW:   'service.view',
  SERVICE_CREATE: 'service.create',
  SERVICE_EDIT:   'service.edit',
  SERVICE_DELETE: 'service.delete',

  ORDER_VIEW:   'order.view',
  ORDER_CREATE: 'order.create',
  ORDER_EDIT:   'order.edit',
  ORDER_DELETE: 'order.delete',

  // ── Scheduling ────────────────────────────────────────────────────────────────
  SCHEDULE_SLOT_VIEW:   'schedule_slot.view',
  SCHEDULE_SLOT_CREATE: 'schedule_slot.create',
  SCHEDULE_SLOT_EDIT:   'schedule_slot.edit',
  SCHEDULE_SLOT_DELETE: 'schedule_slot.delete',

  // ── Tariff / Billing accounts ─────────────────────────────────────────────────
  TARIFF_PLAN_VIEW:     'tariff_plan.view',
  TARIFF_PLAN_CREATE:   'tariff_plan.create',
  TARIFF_PLAN_EDIT:     'tariff_plan.edit',
  TARIFF_PLAN_DELETE:   'tariff_plan.delete',
  BILLING_ACCOUNT_VIEW: 'billing_account.view',
} as const

export type PermKey = typeof PERM[keyof typeof PERM]

// ── Object-key helpers (first segment of object.action) ───────────────────────
// Use these as the `entityKey` argument to can(caps, OBJ.*, verb).
export const OBJ = {
  COMMENT:          'comment',
  ATTACHMENT:       'attachment',
  TASK:             'task',
  WATCH:            'watch',
  NOTIFICATION:     'notification',
  REPORT:           'report',
  CONFIGURATION:    'configuration',
  FEATURE_FLAG:     'feature_flag',
  WORKFLOW:         'workflow',
  SLA:              'sla',
  RELATIONSHIP:     'relationship',
  COMMUNICATION:    'communication',
  WEBHOOK:          'webhook',
  API_KEY:          'api_key',
  ROLE:             'role',
  PERMISSION:       'permission',
  LEAD:             'lead',
  CUSTOMER:         'customer',
  CONTACT:          'contact',
  DEAL:             'deal',
  TICKET:           'ticket',
  HELPDESK_TICKET:  'helpdesk_ticket',
  HELPDESK_QUEUE:   'helpdesk_queue',
  WORKITEM:         'workitem',
  PAYMENT_ORDER:    'payment_order',
  INVOICE:          'invoice',
  PAYMENT:          'payment',
  REQUEST:          'request',
  AUDIT:            'audit',
  SERVICE:          'service',
  ORDER:            'order',
  SCHEDULE_SLOT:    'schedule_slot',
  TARIFF_PLAN:      'tariff_plan',
  BILLING_ACCOUNT:  'billing_account',
} as const
