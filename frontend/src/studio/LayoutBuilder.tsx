// GAAhex Studio — Layout Builder pane.
// Extracted from StudioRichPanes.tsx. Behavior unchanged.

import React, { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Columns3,
  File,
  Grid3X3,
  Image,
  LayoutTemplate,
  Minus,
  Monitor,
  Plus,
  Rows3,
  Smartphone,
  Square,
  SquareStack,
  Tablet,
  X,
} from 'lucide-react'
import { Sec, type Device } from './_shared'

interface CanvasBlock {
  id: number
  type: string
  h: number
}

// Block palette — static until /api/studio/layout-blocks is built.
const BLOCK_PALETTE: [React.ReactNode, string][] = [
  [<Rows3 size={16} />, 'Section'],
  [<Columns3 size={16} />, 'Columns'],
  [<Grid3X3 size={16} />, 'Grid'],
  [<Square size={16} />, 'Card'],
  [<File size={16} />, 'Tabs'],
  [<SquareStack size={16} />, 'Modal'],
  [<Minus size={16} />, 'Divider'],
  [<Image size={16} />, 'Media'],
]

export function LayoutBuilder() {
  const [device, setDevice] = useState<Device>('desktop')
  const [blocks, setBlocks] = useState<CanvasBlock[]>([])
  let _id = { current: 1 }

  const addBlock = (t: string) =>
    setBlocks(b => [...b, { id: _id.current++, type: t, h: t === 'Grid' ? 140 : t === 'Modal' ? 110 : 80 }])
  const rm = (id: number) => setBlocks(b => b.filter(x => x.id !== id))
  const move = (i: number, d: number) =>
    setBlocks(b => {
      const n = [...b]
      const j = i + d
      if (j < 0 || j >= n.length) return n
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })

  const W = device === 'desktop' ? '100%' : device === 'tablet' ? 620 : 340

  return (
    <div>
      <Sec
        icon={<LayoutTemplate size={15} />}
        title="Layout Builder"
        hint="drop sections, columns, grids, cards, tabs, modals"
        right={
          <div className="seg">
            {([['desktop', <Monitor size={13} />], ['tablet', <Tablet size={13} />], ['mobile', <Smartphone size={13} />]] as [Device, React.ReactNode][]).map(
              ([d, ic]) => (
                <button key={d} className={device === d ? 'on' : ''} type="button" onClick={() => setDevice(d)}>
                  {ic}
                </button>
              ),
            )}
          </div>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16 }}>
        {/* palette */}
        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>Blocks</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {BLOCK_PALETTE.map(([ic, label]) => (
              <button
                key={label as string}
                className="palette-block"
                type="button"
                style={{ flexDirection: 'column', gap: 6, padding: '10px 8px', fontSize: 11 }}
                onClick={() => addBlock(label as string)}
              >
                {ic}
                <span>{label}</span>
              </button>
            ))}
          </div>
          <p className="hint" style={{ fontSize: 11, marginTop: 'var(--gx-space-4)', lineHeight: 1.5 }}>
            Click a block to drop it on the canvas.
          </p>
        </div>
        {/* canvas */}
        <div className="card" style={{ padding: 'var(--gx-space-5)', background: 'var(--gx-bg-subtle)', minHeight: 420 }}>
          <div
            style={{
              width: W,
              margin: '0 auto',
              transition: 'width var(--gx-dur-base)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {blocks.map((b, i) => (
              <div key={b.id} className="canvas-block" style={{ height: b.h }}>
                <span className="canvas-tag">{b.type}</span>
                <div className="canvas-actions">
                  <button type="button" onClick={() => move(i, -1)} title="Up"><ChevronUp size={13} /></button>
                  <button type="button" onClick={() => move(i, 1)} title="Down"><ChevronDown size={13} /></button>
                  <button type="button" onClick={() => rm(b.id)} title="Remove" style={{ color: 'var(--gx-danger-fg)' }}>
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
            {blocks.length === 0 && (
              <div style={{
                flex: 1,
                minHeight: 360,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px dashed var(--gx-border)',
                borderRadius: 'var(--gx-radius-lg)',
                color: 'var(--gx-text-3)',
                fontSize: 13,
                flexDirection: 'column',
                gap: 10,
              }}>
                <LayoutTemplate size={28} style={{ opacity: 0.35 }} />
                <span>Canvas is empty — pick a block from the palette</span>
                <button className="canvas-add" type="button" onClick={() => addBlock('Section')}>
                  <Plus size={14} />Add block
                </button>
              </div>
            )}
            {blocks.length > 0 && (
              <button className="canvas-add" type="button" onClick={() => addBlock('Section')}>
                <Plus size={14} />Add block
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
