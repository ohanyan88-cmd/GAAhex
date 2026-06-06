// GAAhex Studio — Content Editor pane.
// Extracted from StudioRichPanes.tsx. Behavior unchanged.

import { Button } from '../primitives'
import { useState } from 'react'
import { Check, Image, Type, Upload } from 'lucide-react'
import { Sec } from './_shared'

export function ContentEditor() {
  const [tab, setTab] = useState<'content' | 'seo'>('content')

  return (
    <div>
      <Sec
        icon={<Type size={15} />}
        title="Content Editor"
        hint="text, images, links, labels & SEO"
        right={
          <div className="seg">
            <button className={tab === 'content' ? 'on' : ''} type="button" onClick={() => setTab('content')}>Content</button>
            <button className={tab === 'seo' ? 'on' : ''} type="button" onClick={() => setTab('seo')}>SEO</button>
          </div>
        }
      />
      {tab === 'content' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <label className="field"><span>Page title</span><input className="inp inp-sm" /></label>
          <label className="field"><span>Subtitle</span><input className="inp inp-sm" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <span>Body text</span>
            <textarea className="inp" rows={4} style={{ height: 'auto', padding: '10px 11px', lineHeight: 1.6, resize: 'vertical' }} />
          </label>
          <label className="field"><span>Primary button label</span><input className="inp inp-sm" /></label>
          <label className="field"><span>Button link</span><input className="inp inp-sm mono" /></label>
          <label className="field">
            <span>Image</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', padding: 'var(--gx-space-4) var(--gx-space-5)', background: 'var(--gx-bg-subtle)', border: '1px dashed var(--gx-border-strong)', borderRadius: 'var(--gx-radius-md)' }}>
              <Image size={18} style={{ color: 'var(--gx-text-3)' }} />
              <span className="hint" style={{ fontSize: 12 }}>No image</span>
              <Button variant="ghost" size="sm"
            type="button" style={{ marginLeft: 'auto' }}>
                <Upload size={13} />Upload
              </Button>
            </div>
          </label>
          <label className="field"><span>Placeholder text</span><input className="inp inp-sm" /></label>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--gx-space-7)', maxWidth: 560 }}>
          <label className="field"><span>SEO title</span><input className="inp inp-sm" /></label>
          <label className="field">
            <span>Meta description</span>
            <textarea className="inp" rows={3} style={{ height: 'auto', padding: '10px 11px', lineHeight: 1.6, resize: 'vertical' }} />
          </label>
          <label className="field"><span>URL slug</span><input className="inp inp-sm mono" /></label>
        </div>
      )}
      <div style={{ marginTop: 18 }}>
        {/* Save wires to PUT /api/pages/{pageId}/content when that endpoint is built */}
        <Button variant="primary" size="sm"
            type="button" disabled title="Content save not yet wired">
          <Check size={13} />Save content
        </Button>
      </div>
    </div>
  )
}
