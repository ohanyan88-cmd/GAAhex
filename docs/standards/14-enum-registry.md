# 14 — Central Enum Registry

LOCKED. Satisfies Enum Standard rule 6 (every enum has an owner department) and rule 8 (central
registry: name, owner, values, lifecycle, source). All values `UPPER_SNAKE_CASE`; type names
PascalCase. Lifecycle: `ACTIVE` unless noted. Created: 2026-06-02.

## Cross-cutting (defined in file 03)
| Enum | Owner | Values |
|------|-------|--------|
| ObjectType / EntityType | Business Process Management | 40-value superset (see file 03) |
| ActorType | Security | USER, SYSTEM, AUTOMATION, INTEGRATION, API, CUSTOMER |
| PrincipalType | Security | EMPLOYEE, ROLE, DEPARTMENT, TEAM, QUEUE |
| RecipientType / ParticipantType | Security | EMPLOYEE, ROLE, DEPARTMENT, TEAM, CUSTOMER (E5) |
| PageType | IT (Design System) | WORKSPACE, REGISTRY, PIPELINE, OPERATIONS, ANALYTICS, COMMUNICATION, CONFIGURATION, PLACEHOLDER (E19) |

## Ownership / assignment / queue / escalation / approval
| Enum | Owner | Values |
|------|-------|--------|
| QueueAssignmentStrategy | Customer Service | MANUAL, ROUND_ROBIN, LEAST_LOADED, SKILL_BASED, PRIORITY_BASED, CONFIGURABLE |
| QueueVisibility | Customer Service | QUEUE_MEMBERS, DEPARTMENT, MANAGEMENT, EVERYONE_WITH_PERMISSION |
| EscalationTrigger | Quality Assurance | SLA_BREACH, STATUS_STUCK_TOO_LONG, MANUAL_ESCALATION, PRIORITY_INCREASE, CUSTOMER_COMPLAINT, REVENUE_IMPACT, VIP_CUSTOMER, CONFIGURABLE_RULES |
| EscalationTarget | Quality Assurance | NEXT_MANAGER, DEPARTMENT_MANAGER, SPECIFIC_USER, ESCALATION_QUEUE |
| EscalationLevel | Quality Assurance | LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4 |
| ApprovalDecision | Compliance | APPROVE, REJECT, REQUEST_CHANGES, DELEGATE, CANCEL_REQUEST |

## Identity / audit / timeline / comment / attachment
| Enum | Owner | Values |
|------|-------|--------|
| AuditEventType | Security | CREATED, UPDATED, DELETED, ASSIGNED, UNASSIGNED, REASSIGNED, OWNER_CHANGED, DEPARTMENT_CHANGED, ESCALATED, APPROVED, REJECTED, CLOSED, REOPENED, COMMENT_ADDED, COMMENT_EDITED, COMMENT_DELETED, ATTACHMENT_UPLOADED, ATTACHMENT_DOWNLOADED, ATTACHMENT_DELETED, ATTACHMENT_REFERENCED, ATTACHMENT_UNREFERENCED, ATTACHMENT_QUARANTINED, ATTACHMENT_SCAN_FAILED, STATUS_CHANGED |
| AuditSource | Security | WEB, MOBILE, API, AUTOMATION, INTEGRATION, SYSTEM |
| TimelineCategory | Business Process Management | ALIAS of EventCategory (timeline is a projection — E14); no separate values |
| TimelineVisibility | Security | INTERNAL, EXTERNAL |
| CommentType | Customer Service | INTERNAL, EXTERNAL, PRIVATE, SYSTEM |
| CommentStatus | Customer Service | ACTIVE, EDITED, DELETED |
| CommentResolution | Customer Service | RESOLVED, UNRESOLVED |
| AttachmentCategory | IT | DOCUMENT, IMAGE, PDF, OFFICE_DOCUMENT, TEXT_FILE, LOG_FILE, CONFIGURATION_FILE, CONTRACT, INVOICE, IDENTITY_DOCUMENT, PHOTO_EVIDENCE, NETWORK_DIAGRAM, SERVICE_PROOF, LEGAL_DOCUMENT, FINANCIAL_DOCUMENT, OTHER |
| AttachmentStatus | IT | UPLOADING, SCANNING, AVAILABLE, QUARANTINED, DELETED, FAILED |

## Task / watcher / notification
| Enum | Owner | Values |
|------|-------|--------|
| TaskScope | Business Process Management | OBJECT_LINKED, STANDALONE |
| TaskStatus | Business Process Management | OPEN, IN_PROGRESS, BLOCKED, WAITING, COMPLETED, CANCELLED |
| TaskPriority | Business Process Management | LOW, MEDIUM, HIGH, URGENT |
| TaskType | Business Process Management | GENERAL, FOLLOW_UP, REVIEW, APPROVAL_PREP, CALL_CUSTOMER, CONTACT_VENDOR, COLLECT_DOCUMENT, VERIFY_DOCUMENT, VERIFY_PAYMENT, PAYMENT_FOLLOW_UP, CHECK_SERVICE, CONFIGURE_DEVICE, INSTALLATION, MAINTENANCE, FIELD_VISIT, SITE_SURVEY, NETWORK_CHECK, OUTAGE_INVESTIGATION, INCIDENT_ACTION, PROBLEM_INVESTIGATION, CHANGE_PREP, CHANGE_EXECUTION, RELEASE_PREP, RELEASE_VALIDATION, ESCALATION_ACTION, CUSTOMER_UPDATE, INTERNAL_HANDOFF, QUALITY_CHECK, COMPLIANCE_REVIEW, LEGAL_REVIEW, FINANCE_REVIEW, MANAGER_REVIEW, DATA_CORRECTION, KNOWLEDGE_UPDATE |
| TaskSlaStatus | Quality Assurance | ON_TRACK, AT_RISK, BREACHED, PAUSED, NOT_APPLICABLE |
| TaskDependencyType | Business Process Management | BLOCKED_BY, BLOCKS, RELATED_TO, DUPLICATES, DUPLICATED_BY |
| TaskResolution | Business Process Management | DONE, NOT_NEEDED, DUPLICATE, CANNOT_COMPLETE, INVALID, MERGED |
| WatcherStatus | Business Process Management | ACTIVE, PAUSED, REMOVED |
| WatcherSource | Business Process Management | MANUAL, AUTOMATIC, MENTION, ASSIGNMENT, ESCALATION, APPROVAL, SYSTEM, AUTOMATION |
| WatchScope | Business Process Management | OBJECT_ONLY, OBJECT_AND_CHILDREN, OBJECT_AND_RELATED |
| WatchPriority | Business Process Management | LOW, NORMAL, HIGH, CRITICAL |
| NotificationFrequency | IT | IMMEDIATE, HOURLY_DIGEST, DAILY_DIGEST, WEEKLY_DIGEST, DISABLED |
| WatcherEventType | Business Process Management | STATUS_CHANGED, ASSIGNED, UNASSIGNED, REASSIGNED, COMMENT_ADDED, COMMENT_REPLY, MENTIONED, ATTACHMENT_ADDED, APPROVAL_COMPLETED, ESCALATED, TASK_CREATED, TASK_COMPLETED, TASK_CANCELLED, OBJECT_CLOSED, OBJECT_REOPENED |
| NotificationSource | IT | TASK, COMMENT, ATTACHMENT, APPROVAL, ASSIGNMENT, ESCALATION, WATCHER, MENTION, STATUS_CHANGE, AUTOMATION, SYSTEM, INTEGRATION |
| NotificationCategory | IT | ACTION_REQUIRED, INFORMATIONAL, WARNING, SUCCESS, ERROR, SECURITY, COMPLIANCE |
| NotificationPriority | IT | LOW, NORMAL, HIGH, CRITICAL |
| NotificationSeverity | IT | INFO, WARNING, ERROR, CRITICAL |
| NotificationStatus | IT | PENDING, DELIVERED, READ, ACKNOWLEDGED, DISMISSED, EXPIRED, FAILED |
| NotificationChannel | IT | IN_APP, EMAIL, SMS, PUSH |
| NotificationDeliveryResult | IT | SENT, DELIVERED, FAILED, REJECTED, BOUNCED, EXPIRED |
| NotificationSuppressionMode | IT | NONE, DEDUPLICATE, AGGREGATE, THROTTLE, MUTE |

## Event system
| Enum | Owner | Values |
|------|-------|--------|
| EventCategory | Business Process Management | LIFECYCLE, STATUS, ASSIGNMENT, OWNERSHIP, APPROVAL, FINANCIAL, COMMENT, ATTACHMENT, COMMUNICATION, TASK, ESCALATION, NOTIFICATION, AUTOMATION, INTEGRATION, SECURITY, SYSTEM (E14/E21) |
| EventVisibility | Security | PUBLIC, INTERNAL, RESTRICTED, SYSTEM |

## Reporting / import-export / config / feature flag
| Enum | Owner | Values |
|------|-------|--------|
| ImportStatus | IT | DRAFT, VALIDATING, VALIDATION_FAILED, READY_TO_IMPORT, IMPORTING, COMPLETED, COMPLETED_WITH_ERRORS, FAILED, CANCELLED |
| ExportStatus | IT | REQUESTED, RUNNING, COMPLETED, FAILED, CANCELLED, EXPIRED |
| ConfigurationScope | IT | GLOBAL, TENANT, DEPARTMENT, ROLE, USER, ENVIRONMENT |
| ConfigurationStatus | IT | ACTIVE, INACTIVE, DEPRECATED, PENDING_REVIEW |
| FeatureFlagScope | IT | GLOBAL, TENANT, ROLE, USER, ENVIRONMENT |
| FeatureFlagStatus | IT | DRAFT, ACTIVE, INACTIVE, DEPRECATED, RETIRED |
| Environment | IT | DEVELOPMENT, STAGING, PRODUCTION |

## Final architecture
| Enum | Owner | Values |
|------|-------|--------|
| WorkflowStatus | Business Process Management | DRAFT, ACTIVE, DEPRECATED, RETIRED |
| GateType | Business Process Management | COMMERCIAL_GATE, TECHNICAL_GATE, SERVICE_GATE, OPERATIONAL_GATE, APPROVAL_GATE, COMPLIANCE_GATE, MANUAL_REVIEW_GATE |
| RelationshipType | Business Process Management | RELATED_TO, PARENT_OF, CHILD_OF, DEPENDS_ON, BLOCKED_BY, DUPLICATES, DUPLICATED_BY, OWNS, USED_BY, ASSOCIATED_WITH, REPLACES, REPLACED_BY, CONNECTED_TO, BILLED_TO, SERVES, LOCATED_AT, ASSIGNED_TO |
| RelationshipDirection | Business Process Management | DIRECTED, BIDIRECTIONAL |
| DeletionState | Business Process Management | ACTIVE, ARCHIVED, SOFT_DELETED, PENDING_PURGE, PURGED |
| SlaStatus | Quality Assurance | NOT_APPLICABLE, ON_TRACK, AT_RISK, PAUSED, BREACHED, COMPLETED, CANCELLED |
| SlaPauseReason | Quality Assurance | WAITING_CUSTOMER, WAITING_EXTERNAL_PARTY, WAITING_APPROVAL, WAITING_PARTS, SCHEDULED_APPOINTMENT, DEPENDENCY_BLOCKED |
| CommunicationChannel | Customer Service | WHATSAPP, MESSENGER, SMS, EMAIL, CALLS, INTERNAL_CHAT, PORTAL_MESSAGE, SYSTEM_MESSAGE |
| CommunicationDirection | Customer Service | INBOUND, OUTBOUND, INTERNAL, SYSTEM |
| CommunicationStatus | Customer Service | DRAFT, QUEUED, SENT, DELIVERED, READ, FAILED, RECEIVED, ARCHIVED |
| BackgroundJobStatus | IT | PENDING, RUNNING, SUCCEEDED, FAILED, RETRYING, CANCELLED, DEAD_LETTERED |
| RetentionCategory | Compliance | PERMANENT, TENANT_CONFIGURED, FIXED_PERIOD, TEMPORARY, LEGAL_HOLD, COMPLIANCE_HOLD, PURGE_ELIGIBLE |
| WebhookSubscriptionStatus | IT | ACTIVE, INACTIVE, SUSPENDED, FAILED, DEPRECATED |
| WebhookDeliveryStatus | IT | PENDING, SENT, DELIVERED, FAILED, RETRYING, DEAD_LETTERED |

## Pipeline / catalog (file 11)
| Enum | Owner | Values |
|------|-------|--------|
| LeadSource | Sales | SHOP, WEBSITE, REFERRAL, D2D, TELESALES, B2B |
| LifecycleStage | Business Process Management | LEAD, VALIDATED_LEAD, ASSIGNED, DEAL, CONTRACT_SIGNED, ORDER_CREATED, ORDER_VALIDATED, SCHEDULING, INSTALLATION, PROVISIONING, CONNECTION_TEST, PAYMENT_CONFIRMED, ACTIVATION, MONITORING |
| ProductCategory | Marketing | INTERNET, IPTV, COMBO, HARDWARE, ADD_ONS, BUNDLES |

## Design-system component enums (file 09)
Component variant/type/state enums (ButtonVariant, ButtonState, BadgeType, ModalType,
ToastType, AlertType, EmptyStateType, FormState, TableState) are owned by **IT (Design System)**
and use the UPPER_SNAKE values listed in file 09. **E20 — design *tokens* (ColorToken, spacing
scale, TypographyRole) are design identifiers, not business enums; they are exempt from the
UPPER_SNAKE rule and use the design-system's PascalCase token names.**

## Governance
Enum values are immutable; lifecycle is `ACTIVE` or `DEPRECATED` (never `DELETED`). Adding values
requires owner-department governance. Status enums depend on the Global Status Standard (file 07,
SOURCE NOT PROVIDED) for any global status taxonomy — reconcile on receipt.
