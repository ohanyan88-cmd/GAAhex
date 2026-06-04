// PC-3 — AUTO-GENERATED from backend/app/seed.py:_permission_specs.
// Do not edit by hand. Regenerate with:
//   backend\\.venv\\Scripts\\python.exe backend\\scripts\\gen_permissions_ts.py
//
// Each value is the canonical `object.action` string accepted by `can()` in
// `frontend/src/lib/capabilities.ts` and by the backend `access.py` checks.

export const Perms = {
  attachment: {
    delete: 'attachment.delete' as const,
    download: 'attachment.download' as const,
    reference: 'attachment.reference' as const,
    upload: 'attachment.upload' as const,
    view: 'attachment.view' as const,
    view_deleted: 'attachment.view_deleted' as const,
  },
  audit: {
    view: 'audit.view' as const,
  },
  comment: {
    create: 'comment.create' as const,
    delete: 'comment.delete' as const,
    edit: 'comment.edit' as const,
    moderate: 'comment.moderate' as const,
    view_external: 'comment.view_external' as const,
    view_internal: 'comment.view_internal' as const,
    view_private: 'comment.view_private' as const,
  },
  communication: {
    send: 'communication.send' as const,
    view: 'communication.view' as const,
  },
  configuration: {
    manage: 'configuration.manage' as const,
  },
  contact: {
    create: 'contact.create' as const,
    delete: 'contact.delete' as const,
    edit: 'contact.edit' as const,
    view: 'contact.view' as const,
  },
  customer: {
    create: 'customer.create' as const,
    delete: 'customer.delete' as const,
    edit: 'customer.edit' as const,
    view: 'customer.view' as const,
  },
  deal: {
    create: 'deal.create' as const,
    delete: 'deal.delete' as const,
    edit: 'deal.edit' as const,
    view: 'deal.view' as const,
  },
  escalation: {
    manage: 'escalation.manage' as const,
  },
  export: {
    run: 'export.run' as const,
  },
  helpdesk_queue: {
    manage: 'helpdesk_queue.manage' as const,
    view: 'helpdesk_queue.view' as const,
  },
  helpdesk_ticket: {
    create: 'helpdesk_ticket.create' as const,
    delete: 'helpdesk_ticket.delete' as const,
    edit: 'helpdesk_ticket.edit' as const,
    view: 'helpdesk_ticket.view' as const,
  },
  import: {
    run: 'import.run' as const,
  },
  lead: {
    create: 'lead.create' as const,
    delete: 'lead.delete' as const,
    edit: 'lead.edit' as const,
    view: 'lead.view' as const,
  },
  notification: {
    acknowledge: 'notification.acknowledge' as const,
    dismiss: 'notification.dismiss' as const,
    manage: 'notification.manage' as const,
    manage_preferences: 'notification.manage_preferences' as const,
    view: 'notification.view' as const,
  },
  payment_order: {
    collect: 'payment_order.collect' as const,
    view: 'payment_order.view' as const,
  },
  relationship: {
    create: 'relationship.create' as const,
    delete: 'relationship.delete' as const,
  },
  request: {
    create: 'request.create' as const,
    delete: 'request.delete' as const,
    edit: 'request.edit' as const,
    view: 'request.view' as const,
  },
  sla: {
    manage: 'sla.manage' as const,
  },
  task: {
    assign: 'task.assign' as const,
    attach: 'task.attach' as const,
    cancel: 'task.cancel' as const,
    comment: 'task.comment' as const,
    complete: 'task.complete' as const,
    create: 'task.create' as const,
    delete: 'task.delete' as const,
    edit: 'task.edit' as const,
    reopen: 'task.reopen' as const,
    view: 'task.view' as const,
  },
  ticket: {
    create: 'ticket.create' as const,
    delete: 'ticket.delete' as const,
    edit: 'ticket.edit' as const,
    view: 'ticket.view' as const,
  },
  watch: {
    add: 'watch.add' as const,
    manage_others: 'watch.manage_others' as const,
    pause: 'watch.pause' as const,
    remove: 'watch.remove' as const,
    resume: 'watch.resume' as const,
    view: 'watch.view' as const,
  },
  workitem: {
    create: 'workitem.create' as const,
    delete: 'workitem.delete' as const,
    edit: 'workitem.edit' as const,
    view: 'workitem.view' as const,
  },
} as const

// String-literal type covering every permission key.
export type PermissionKey =
  | 'attachment.delete'
  | 'attachment.download'
  | 'attachment.reference'
  | 'attachment.upload'
  | 'attachment.view'
  | 'attachment.view_deleted'
  | 'audit.view'
  | 'comment.create'
  | 'comment.delete'
  | 'comment.edit'
  | 'comment.moderate'
  | 'comment.view_external'
  | 'comment.view_internal'
  | 'comment.view_private'
  | 'communication.send'
  | 'communication.view'
  | 'configuration.manage'
  | 'contact.create'
  | 'contact.delete'
  | 'contact.edit'
  | 'contact.view'
  | 'customer.create'
  | 'customer.delete'
  | 'customer.edit'
  | 'customer.view'
  | 'deal.create'
  | 'deal.delete'
  | 'deal.edit'
  | 'deal.view'
  | 'escalation.manage'
  | 'export.run'
  | 'helpdesk_queue.manage'
  | 'helpdesk_queue.view'
  | 'helpdesk_ticket.create'
  | 'helpdesk_ticket.delete'
  | 'helpdesk_ticket.edit'
  | 'helpdesk_ticket.view'
  | 'import.run'
  | 'lead.create'
  | 'lead.delete'
  | 'lead.edit'
  | 'lead.view'
  | 'notification.acknowledge'
  | 'notification.dismiss'
  | 'notification.manage'
  | 'notification.manage_preferences'
  | 'notification.view'
  | 'payment_order.collect'
  | 'payment_order.view'
  | 'relationship.create'
  | 'relationship.delete'
  | 'request.create'
  | 'request.delete'
  | 'request.edit'
  | 'request.view'
  | 'sla.manage'
  | 'task.assign'
  | 'task.attach'
  | 'task.cancel'
  | 'task.comment'
  | 'task.complete'
  | 'task.create'
  | 'task.delete'
  | 'task.edit'
  | 'task.reopen'
  | 'task.view'
  | 'ticket.create'
  | 'ticket.delete'
  | 'ticket.edit'
  | 'ticket.view'
  | 'watch.add'
  | 'watch.manage_others'
  | 'watch.pause'
  | 'watch.remove'
  | 'watch.resume'
  | 'watch.view'
  | 'workitem.create'
  | 'workitem.delete'
  | 'workitem.edit'
  | 'workitem.view'
