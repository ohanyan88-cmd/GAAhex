import { useRef, useState } from 'react'
import { PaperclipIcon, CloseIcon } from './icons'

// FileUpload — a drag-and-drop + click-to-browse file field. Holds the chosen File[] in the
// form value; the actual upload to /api/{entity}/{id}/attachments happens after the record is
// saved (the parent needs the new record id). Token-styled, no inline values.

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileUpload({ value, onChange, accept, hint }: {
  value: File[] | undefined
  onChange: (files: File[]) => void
  accept?: string
  hint?: string
}) {
  const files = Array.isArray(value) ? value : []
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function add(list: FileList | null) {
    if (!list || list.length === 0) return
    onChange([...files, ...Array.from(list)])
  }
  function remove(i: number) { onChange(files.filter((_, j) => j !== i)) }
  function browse() { inputRef.current?.click() }

  return (
    <div className="fu">
      <button
        type="button"
        className={'fu-drop' + (drag ? ' on' : '')}
        onClick={browse}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files) }}
      >
        <PaperclipIcon size={18} aria-hidden />
        <span className="fu-drop-text">Drag &amp; drop or <em>click to browse</em></span>
        <span className="fu-drop-hint">{hint ?? 'ID, passport, agreement, photos — PDF / image / doc'}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept ?? 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt'}
        className="fu-input"
        onChange={(e) => { add(e.target.files); e.target.value = '' }}
      />
      {files.length > 0 && (
        <ul className="fu-list">
          {files.map((f, i) => (
            <li className="fu-item" key={`${f.name}-${i}`}>
              <PaperclipIcon size={13} aria-hidden />
              <span className="fu-name">{f.name}</span>
              <span className="fu-size">{fmtSize(f.size)}</span>
              <button type="button" className="fu-remove" aria-label={`Remove ${f.name}`}
                onClick={(e) => { e.stopPropagation(); remove(i) }}>
                <CloseIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default FileUpload
