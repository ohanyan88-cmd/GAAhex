import { useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { Modal, ModalFooterActions } from './Modal'
import { t } from '../lib/i18n'

// ImageCropModal — a "position & size" avatar cropper (GitHub-style): pan by dragging, zoom with the
// slider / ± buttons, a hexagon guide shows the visible region, and "Set" bakes the framed area to a
// square PNG via canvas and hands it back as a Blob. The caller uploads that (so the stored image is
// already positioned — no per-render object-position needed).
const VP = 280        // crop viewport (square, px) — the math below assumes width === height === VP
const OUT = 256       // output image edge (px)
const MAX_ZOOM = 5

export default function ImageCropModal({
  open, src, title, applyLabel, busy, onCancel, onApply,
}: {
  open: boolean
  src: string | null
  title?: string
  applyLabel?: string
  busy?: boolean
  onCancel: () => void
  onApply: (blob: Blob) => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const baseScale = nat ? Math.max(VP / nat.w, VP / nat.h) : 1  // "cover" the viewport at zoom 1
  const disp = baseScale * zoom
  const dw = nat ? nat.w * disp : VP
  const dh = nat ? nat.h * disp : VP

  const clamp = (x: number, y: number) => ({
    x: Math.min(0, Math.max(VP - dw, x)),
    y: Math.min(0, Math.max(VP - dh, y)),
  })

  // Re-center whenever a new image loads (nat changes).
  useEffect(() => {
    if (!nat) return
    setOff({ x: Math.min(0, (VP - dw) / 2), y: Math.min(0, (VP - dh) / 2) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nat])

  function onImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const el = e.currentTarget
    setZoom(1)
    setNat({ w: el.naturalWidth, h: el.naturalHeight })
  }

  // Zoom while keeping the viewport center anchored on the same source point.
  function setZoomKeepCenter(next: number) {
    const z = Math.min(MAX_ZOOM, Math.max(1, next))
    if (!nat) { setZoom(z); return }
    const c = VP / 2
    const srcX = (c - off.x) / disp
    const srcY = (c - off.y) / disp
    const ndisp = baseScale * z
    const ndw = nat.w * ndisp, ndh = nat.h * ndisp
    setZoom(z)
    setOff({
      x: Math.min(0, Math.max(VP - ndw, c - srcX * ndisp)),
      y: Math.min(0, Math.max(VP - ndh, c - srcY * ndisp)),
    })
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault()
    drag.current = { sx: e.clientX, sy: e.clientY, ox: off.x, oy: off.y }
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    setOff(clamp(d.ox + (e.clientX - d.sx), d.oy + (e.clientY - d.sy)))
  }
  function onPointerUp() { drag.current = null }

  function apply() {
    const img = imgRef.current
    if (!img || !nat) return
    const canvas = document.createElement('canvas')
    canvas.width = OUT; canvas.height = OUT
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Map the viewport rectangle back into source-image pixels.
    ctx.drawImage(img, (-off.x) / disp, (-off.y) / disp, VP / disp, VP / disp, 0, 0, OUT, OUT)
    canvas.toBlob((b) => { if (b) onApply(b) }, 'image/png')
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title || t('crop.title', 'Position and size')}
      size="sm"
      footer={
        <ModalFooterActions
          onCancel={onCancel}
          onConfirm={apply}
          confirmLabel={applyLabel || t('crop.apply', 'Set picture')}
          confirmDisabled={!nat || !!busy}
        />
      }
    >
      <div className="crop-wrap">
        <div
          className="crop-vp"
          style={{ width: VP, height: VP, touchAction: 'none', cursor: drag.current ? 'grabbing' : 'grab' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {src && (
            <img
              ref={imgRef}
              src={src}
              alt=""
              onLoad={onImgLoad}
              draggable={false}
              className="crop-img"
              style={{ width: dw, height: dh, transform: `translate(${off.x}px, ${off.y}px)` }}
            />
          )}
          {/* Hexagon guide — the region that shows in the avatar hex. */}
          <svg className="crop-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polygon points="25,0 75,0 100,50 75,100 25,100 0,50" />
          </svg>
        </div>
        <div className="crop-zoom">
          <button type="button" className="uc-pic-btn" onClick={() => setZoomKeepCenter(zoom / 1.2)} aria-label={t('crop.zoomOut', 'Zoom out')} disabled={zoom <= 1}>
            <ZoomOut size={15} />
          </button>
          <input
            type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom}
            onChange={(e) => setZoomKeepCenter(+e.target.value)}
            className="crop-range" aria-label={t('crop.zoom', 'Zoom')}
          />
          <button type="button" className="uc-pic-btn" onClick={() => setZoomKeepCenter(zoom * 1.2)} aria-label={t('crop.zoomIn', 'Zoom in')} disabled={zoom >= MAX_ZOOM}>
            <ZoomIn size={15} />
          </button>
        </div>
      </div>
    </Modal>
  )
}
