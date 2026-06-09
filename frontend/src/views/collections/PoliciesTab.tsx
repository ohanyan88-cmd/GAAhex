// ─── Tab: Policies ──────────────────────────────────────────────────────────
import { useState } from 'react'
import { bpost, bpatch, bdel } from '../../lib/billing'
import { Button, StatusPill } from '../../primitives'
import { EmptyState, ErrorBanner, PermissionDenied } from '../../components/States'
import { InboxIcon } from '../../components/icons'
import { Plus } from 'lucide-react'
import { toast } from '../../components/Toast'
import { confirmDialog } from '../../components/Modal'
import { useI18n } from '../../lib/i18n'
import {
  validateStepsJson,
  EMPTY_POLICY_DRAFT,
  type DunningPolicy, type PolicyDraft,
} from './types'

export function PoliciesTab({
  token,
  isAdmin,
  policies,
  policiesUnavailable,
  policiesDenied,
  policiesError,
  reload,
}: {
  token: string
  isAdmin: boolean
  policies: DunningPolicy[] | null
  policiesUnavailable: boolean
  policiesDenied: boolean
  policiesError: string
  reload: () => Promise<void> | void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<PolicyDraft | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stepsError, setStepsError] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Non-admin: muted state.
  if (!isAdmin) {
    return (
      <EmptyState
        icon={<InboxIcon size={40} />}
        title={t('collections.policies.adminOnly', 'Admin only')}
        message={t('collections.policies.adminOnlyMsg', 'Dunning policies are managed by administrators. Switch to the Active Cases tab to view in-flight cases.')}
      />
    )
  }

  if (policiesDenied) return <PermissionDenied />
  if (policiesUnavailable) {
    return (
      <EmptyState
        icon={<InboxIcon size={40} />}
        title={t('collections.unavailable.title', 'Dunning endpoints not yet available')}
        message={t('collections.unavailable.msg', 'The collections API will appear here once Phase B.2 ships in this tenant.')}
      />
    )
  }
  if (policiesError) return <ErrorBanner message={policiesError} onRetry={() => void reload()} />
  if (policies === null) return <p className="muted">{t('common.loading', 'Loading…')}</p>

  function openCreate() {
    setSelectedId(null)
    setStepsError('')
    setDraft({ ...EMPTY_POLICY_DRAFT })
  }

  function openEdit(p: DunningPolicy) {
    setSelectedId(p.id)
    setStepsError('')
    setDraft({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      is_default: p.is_default,
      active: p.active,
      steps_text: JSON.stringify(p.steps_json ?? [], null, 4),
    })
  }

  function closeDraft() { setDraft(null); setSelectedId(null); setStepsError('') }

  async function save() {
    if (!draft) return
    const v = validateStepsJson(draft.steps_text)
    if (!v.ok) { setStepsError(v.err); return }
    setStepsError('')

    if (draft.id) {
      // PATCH — name is locked when editing, omit it.
      const body = {
        description: draft.description || null,
        is_default: draft.is_default,
        active: draft.active,
        steps_json: v.steps,
      }
      setSaving(true)
      try {
        await bpatch(token, `/api/dunning/policies/${draft.id}`, body)
        toast.success(t('collections.policy.saved', 'Policy updated'))
        closeDraft()
        await reload()
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setSaving(false)
      }
    } else {
      const name = draft.name.trim()
      if (!name) { toast.warning(t('collections.policy.nameRequired', 'Policy name is required')); return }
      const body = {
        name,
        description: draft.description || null,
        is_default: draft.is_default,
        active: draft.active,
        steps_json: v.steps,
      }
      setSaving(true)
      try {
        await bpost(token, '/api/dunning/policies', body)
        toast.success(t('collections.policy.created', 'Policy created'))
        closeDraft()
        await reload()
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setSaving(false)
      }
    }
  }

  async function removePolicy(p: DunningPolicy) {
    const ok = await confirmDialog({
      title: `Delete ${p.name}`,
      message: t('collections.policy.deleteConfirm', 'Delete this policy? Active cases referencing it will block deletion.'),
      confirmLabel: t('common.delete', 'Delete'),
      danger: true,
    })
    if (!ok) return
    setDeletingId(p.id)
    try {
      await bdel(token, `/api/dunning/policies/${p.id}`)
      toast.success(t('collections.policy.deleted', 'Policy deleted'))
      if (selectedId === p.id) closeDraft()
      await reload()
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 409) {
        toast.error(err.message || t('collections.policy.deleteBlocked', 'Cannot delete: active cases reference this policy'))
      } else {
        toast.error(err.message)
      }
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', marginBottom: 'var(--gx-space-6)' }}>
        <div style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>
          {policies.length} {policies.length === 1 ? t('collections.policy.one', 'policy') : t('collections.policy.many', 'policies')}
        </div>
        <span style={{ flex: 1 }} />
        <Button variant="primary" size="sm"
            onClick={openCreate} disabled={!!draft && !draft.id}>
          <Plus size={14} /> {t('collections.policy.new', 'New Policy')}
        </Button>
      </div>

      {policies.length === 0 && !draft && (
        <EmptyState
          icon={<InboxIcon size={40} />}
          title={t('collections.policy.empty.title', 'No policies configured')}
          message={t('collections.policy.empty.msg', 'No policies configured. Create one to start the dunning sequence.')}
          action={
            <Button variant="primary" size="md"
            onClick={openCreate}>
              <Plus size={14} /> {t('collections.policy.new', 'New Policy')}
            </Button>
          }
        />
      )}

      {/* Two-column layout: list + inline edit panel on the right when a policy is selected/new */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: draft ? 'minmax(260px, 1fr) minmax(360px, 1.4fr)' : '1fr',
          gap: 'var(--gx-space-5)',
          alignItems: 'flex-start',
        }}
      >
        {/* Card grid */}
        {policies.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: draft ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 'var(--gx-space-4)',
            }}
          >
            {policies.map((p) => {
              const isSelected = selectedId === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openEdit(p)}
                  style={{
                    textAlign: 'left',
                    background: isSelected ? 'var(--gx-bg-subtle)' : 'var(--gx-surface)',
                    // D18: active selection outline = azure (interactive)
                    border: '1px solid ' + (isSelected ? 'var(--gx-interactive)' : 'var(--gx-border)'),
                    borderRadius: 'var(--gx-radius-md)',
                    padding: 'var(--gx-space-7)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--gx-space-3)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)' }}>
                    <div style={{ fontSize: 'var(--gx-text-md)', fontWeight: 'var(--gx-weight-semibold)', color: 'var(--gx-text-1)', flex: 1 }}>{p.name}</div>
                    {p.is_default && (
                      <span style={{
                        fontSize: 'var(--gx-text-10)', fontWeight: 'var(--gx-weight-bold)', textTransform: 'uppercase', letterSpacing: '0.06em',
                        padding: '2px 7px', borderRadius: 'var(--gx-radius-full)',
                        background: 'var(--gx-bg-subtle)', color: 'var(--gx-text-2)',
                        border: '1px solid var(--gx-border)',
                      }}>
                        {t('collections.policy.default', 'Default')}
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <div style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)', lineHeight: 1.5 }}>{p.description}</div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', marginTop: 'auto' }}>
                    <StatusPill variant={p.active ? 'active' : 'neutral'} label={p.active ? 'active' : 'inactive'} size="sm" />
                    <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>
                      {(p.steps_json?.length ?? 0)} {(p.steps_json?.length ?? 0) === 1 ? 'step' : 'steps'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Inline edit / create panel */}
        {draft && (
          <div
            style={{
              background: 'var(--gx-surface)',
              border: '1px solid var(--gx-border)',
              borderRadius: 'var(--gx-radius-lg)',
              padding: 'var(--gx-space-5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--gx-space-4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)' }}>
              <div style={{ fontSize: 'var(--gx-text-md)', fontWeight: 'var(--gx-weight-semibold)', color: 'var(--gx-text-1)' }}>
                {draft.id ? t('collections.policy.edit', 'Edit policy') : t('collections.policy.create', 'Create policy')}
              </div>
              <span style={{ flex: 1 }} />
              <Button variant="ghost" size="sm" onClick={closeDraft}>{t('common.close', 'Close')}</Button>
            </div>

            <label className="field">
              <span>{t('collections.policy.name', 'Name')} {draft.id && <em style={{ color: 'var(--gx-text-3)', fontStyle: 'normal', fontSize: 'var(--gx-text-11)' }}>· {t('collections.policy.nameLocked', 'locked')}</em>}</span>
              <input
                className="inp inp-md"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="standard_dunning"
                disabled={!!draft.id}
              />
            </label>

            <label className="field">
              <span>{t('collections.policy.description', 'Description')}</span>
              <input
                className="inp inp-md"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder={t('collections.policy.descPlaceholder', 'Optional human-readable description')}
              />
            </label>

            <div style={{ display: 'flex', gap: 'var(--gx-space-5)', flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-2)' }}>
                <input
                  type="checkbox"
                  checked={draft.is_default}
                  onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })}
                />
                {t('collections.policy.isDefault', 'Default policy')}
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-2)' }}>
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                />
                {t('collections.policy.activeFlag', 'Active')}
              </label>
            </div>

            <label className="field">
              <span>{t('collections.policy.steps', 'Steps (JSON)')}</span>
              <textarea
                className="inp"
                value={draft.steps_text}
                onChange={(e) => setDraft({ ...draft, steps_text: e.target.value })}
                rows={14}
                spellCheck={false}
                style={{
                  fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
                  fontSize: 'var(--gx-text-sm)',
                  lineHeight: 1.5,
                  padding: 'var(--gx-space-5)',
                  resize: 'vertical',
                }}
              />
              {stepsError && (
                <div style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-danger)', marginTop: 'var(--gx-space-2)' }}>
                  {stepsError}
                </div>
              )}
              <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', marginTop: 'var(--gx-space-2)' }}>
                {t('collections.policy.stepsHint', 'Each step: integer day_offset, string action, object params.')}
              </div>
            </label>

            <div style={{ display: 'flex', gap: 'var(--gx-space-3)', justifyContent: 'flex-end', alignItems: 'center' }}>
              {draft.id && (
                <Button variant="danger" size="md"
            onClick={() => {
                    const p = policies.find((x) => x.id === draft.id)
                    if (p) void removePolicy(p)
                  }}
                  disabled={saving || deletingId === draft.id}
                  style={{ marginRight: 'auto' }}
                >
                  {deletingId === draft.id ? t('common.deleting', 'Deleting…') : t('common.delete', 'Delete')}
                </Button>
              )}
              <Button variant="ghost" size="md"
            onClick={closeDraft} disabled={saving}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button variant="primary" size="md"
            onClick={save}
                disabled={saving || (!draft.id && !draft.name.trim())}>
                {saving ? t('common.saving', 'Saving…') : draft.id ? t('common.save', 'Save') : t('common.create', 'Create')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
