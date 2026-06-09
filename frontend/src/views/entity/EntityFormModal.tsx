import type { FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Modal } from '../../components/Modal'
import { Button } from '../../primitives'
import {
  CheckIcon, ArrowRightIcon, ReceiptIcon, DownloadIcon,
  UserIcon, BuildingIcon,
} from '../../components/icons'
import { useI18n } from '../../lib/i18n'
import type { Def, Field, Mode } from './types'
import { groupFieldsBySection } from './types'
import { sectionIcon } from './kpis'
import { FieldInput } from './FieldInput'

export function EntityFormModal(props: {
  mode: Mode
  def: Def
  form: Record<string, any>
  createStep: 'pick' | 'form'
  contractUrl: string | null
  contractPdfUrl: string | null
  contractBusy: boolean
  editingStatus: string | null
  errorField: string | null
  error: string
  onClose: () => void
  onSubmit: (e: FormEvent) => void
  onFormChange: (key: string, value: any) => void
  onSetCreateStep: (step: 'pick' | 'form') => void
  onGenerateContract: () => void
  onDownloadContract: () => void
  onDownloadContractPdf: () => void
}) {
  const { token } = useAuth()
  const {
    mode, def, form, createStep,
    contractUrl, contractPdfUrl, contractBusy, editingStatus, errorField, error,
    onClose, onSubmit, onFormChange, onSetCreateStep,
    onGenerateContract, onDownloadContract, onDownloadContractPdf,
  } = props
  const { t } = useI18n()

  const renderField = (f: Field) => (
    <FieldInput
      key={f.key}
      field={f}
      mode={mode}
      currentStatus={editingStatus}
      errorField={errorField}
      errorMsg={error}
      value={form[f.key]}
      onChange={(v) => onFormChange(f.key, v)}
    />
  )

  const visible = def.fields.filter((f) => {
    const segs: string[] | undefined = f.config?.segments
    return !segs || segs.includes(form.segment)
  })
  const headerFields = visible.filter((f) => f.config?.header)
  const bodyFields = visible.filter((f) => !f.config?.header && f.type !== 'status')
  const hasPicker = def.fields.some((f) => f.config?.header)
  const inPick = mode === 'creating' && hasPicker && createStep === 'pick'

  return (
    <Modal
      open
      onClose={onClose}
      size={inPick ? 'lg' : 'xl'}
      title={mode === 'editing'
        ? `${t('common.edit', 'Edit')} ${def.label}`
        : `${t('common.new', 'New')} ${def.label}`}
      subtitle={inPick
        ? t('form.pickType', 'Choose the type and source to continue')
        : mode === 'editing'
          ? undefined
          : t('form.fillBelow', `Fill in the information below to create a new ${def.label.toLowerCase()}`)}
    >
      {inPick ? (() => {
        const segField = headerFields.find((f) => f.key === 'segment')
        const otherHeader = headerFields.filter((f) => f.key !== 'segment')
        const opts: string[] = segField?.config?.options ?? []
        const cardMeta = (opt: string) => opt.toLowerCase().includes('business')
          ? { icon: <BuildingIcon size={20} aria-hidden />, title: 'Business', desc: 'B2B — company account' }
          : { icon: <UserIcon size={20} aria-hidden />, title: 'Individual', desc: 'B2C — home subscriber' }
        return (
          <div className="rec-form rec-form-modal">
            <div className="rec-pick">
              {segField && (
                <div className="rec-pick-group">
                  <div className="rec-pick-label">{segField.label}</div>
                  <div className="rec-pick-cards">
                    {opts.map((opt) => {
                      const m = cardMeta(opt)
                      return (
                        <button type="button" key={opt}
                          className={'rec-pick-card' + (form.segment === opt ? ' on' : '')}
                          onClick={() => onFormChange('segment', opt)}>
                          <span className="rec-pick-card-icon">{m.icon}</span>
                          <span className="rec-pick-card-title">{m.title}</span>
                          <span className="rec-pick-card-desc">{m.desc}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {otherHeader.length > 0 && (
                <div className="rec-pick-row">{otherHeader.map(renderField)}</div>
              )}
            </div>
            <div className="rec-form-actions">
              <span className="spacer" />
              <Button variant="ghost" size="md" type="button" onClick={onClose}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button variant="primary" size="md" type="button"
                disabled={!form.segment || !form.source}
                onClick={() => onSetCreateStep('form')}>
                {t('common.continue', 'Continue')} <ArrowRightIcon size={14} aria-hidden />
              </Button>
            </div>
          </div>
        )
      })() : (
        <form className="rec-form rec-form-modal" onSubmit={onSubmit}>
          {headerFields.length > 0 && (
            <div className="rec-form-header">{headerFields.map(renderField)}</div>
          )}
          <div className="rec-form-sections">
            {groupFieldsBySection(bodyFields).map((g, gi) => {
              const hasTextarea = g.fields.some((f) => f.type === 'textarea')
              const hasFile = g.fields.some((f) => f.type === 'file')
              const split = hasTextarea && hasFile
              const wide = hasTextarea || hasFile
              return g.section ? (
                <div className={'rec-form-section' + (wide ? ' span-2' : '')} key={g.section}>
                  <div className="rec-form-section-head">
                    {sectionIcon(g.section)}
                    <span>{g.section}</span>
                  </div>
                  <div className={'rec-form-grid' + (split ? ' rec-form-grid-split' : '')}>{g.fields.map(renderField)}</div>
                  {split && (
                    <div className="rec-contract-actions">
                      <Button variant="secondary" size="sm" type="button" loading={contractBusy} onClick={onGenerateContract}>
                        <ReceiptIcon size={14} aria-hidden /> {t('contract.generate', 'Generate Contract')}
                      </Button>
                      <Button variant="ghost" size="sm" type="button" disabled={!contractUrl} onClick={onDownloadContract}>
                        <DownloadIcon size={14} aria-hidden /> {t('contract.download', 'Download Contract')}
                      </Button>
                      <Button variant="ghost" size="sm" type="button" disabled={!contractPdfUrl} onClick={onDownloadContractPdf}>
                        <DownloadIcon size={14} aria-hidden /> {t('contract.downloadPdf', 'Download PDF')}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rec-form-grid rec-form-grid-bare span-2" key={`_${gi}`}>{g.fields.map(renderField)}</div>
              )
            })}
          </div>
          <div className="rec-form-actions">
            {mode === 'creating' && hasPicker && (
              <Button variant="ghost" size="md" type="button" onClick={() => onSetCreateStep('pick')}>
                {t('common.back', 'Back')}
              </Button>
            )}
            <span className="spacer" />
            <Button variant="ghost" size="md" type="button" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" size="md" type="submit">
              <CheckIcon size={14} aria-hidden />
              {mode === 'editing' ? t('common.save', 'Save changes') : t('common.create', 'Create')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
