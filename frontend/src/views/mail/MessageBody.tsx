// MessageBody — renders an inbound message body. HARD RULE: inbound HTML is rendered
// ONLY through DOMPurify (never raw dangerouslySetInnerHTML with untrusted input), and
// remote images are gated behind a "Show images" toggle (default off) so a tracking
// pixel can't phone home until the operator opts in. Falls back to plain text, then to
// an empty-body note. D20-clean: `.gx-comms .mail-body*` token classes only.
import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { GlobeIcon } from '../../components/icons'
import { Button } from '../../primitives'
import type { MessageBodyProps } from './types'

// A remote-image src (http/https or protocol-relative) — local cid:/data: stay put.
const REMOTE_SRC = /^\s*(https?:|\/\/)/i

// Sanitize once, and (when showImages is false) neutralize remote <img> sources so they
// don't load. We report whether any remote image was present so the caller surfaces the
// "Show images" bar only when there's something to reveal.
function sanitize(html: string, showImages: boolean): { clean: string; hadRemote: boolean } {
  let hadRemote = false
  const hook = (node: Element) => {
    if (node.nodeName === 'IMG') {
      const src = node.getAttribute('src') || ''
      const srcset = node.getAttribute('srcset')
      if (REMOTE_SRC.test(src) || (srcset && REMOTE_SRC.test(srcset))) {
        hadRemote = true
        if (!showImages) {
          node.removeAttribute('src')
          node.removeAttribute('srcset')
        }
      }
    }
  }
  DOMPurify.addHook('afterSanitizeAttributes', hook)
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // Defense in depth even though DOMPurify strips these by default.
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
    ADD_ATTR: ['target'],
  })
  DOMPurify.removeHook('afterSanitizeAttributes')
  return { clean, hadRemote }
}

export default function MessageBody({ html, text, showImages, onShowImages }: MessageBodyProps) {
  const sanitized = useMemo(
    () => (html ? sanitize(html, showImages) : null),
    [html, showImages],
  )

  if (sanitized) {
    return (
      <>
        {sanitized.hadRemote && !showImages && (
          <div className="mail-images-bar" role="status">
            <GlobeIcon size={15} />
            <span>Remote images are blocked for your privacy.</span>
            <span className="spacer" />
            <Button variant="secondary" size="sm" onClick={onShowImages}>Show images</Button>
          </div>
        )}
        <div
          className="mail-body-html"
          // Content is DOMPurify-sanitized above; remote images are stripped unless
          // the operator opted in. This is the ONLY dangerouslySetInnerHTML in the module.
          dangerouslySetInnerHTML={{ __html: sanitized.clean }}
        />
      </>
    )
  }

  if (text && text.trim()) {
    return <pre className="mail-body-text">{text}</pre>
  }

  return <p className="mail-body-empty">This message has no content.</p>
}
