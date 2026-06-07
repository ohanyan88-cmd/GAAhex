// BootSplash — a brief branded loading moment shown once per page load. The animated GAAhex
// mark (hexagon build-in wave) plays centered on --gx-bg, then the splash fades out and the app
// shows through. Mounted as a top-level overlay in main.tsx (covers login + app). Self-dismissing.
import { useEffect, useState } from 'react'

export function BootSplash() {
  const [phase, setPhase] = useState<'show' | 'hide' | 'done'>('show')
  useEffect(() => {
    const tHide = setTimeout(() => setPhase('hide'), 1600)  // let the build-in wave play, then fade
    const tDone = setTimeout(() => setPhase('done'), 2050)  // unmount after the fade completes
    return () => { clearTimeout(tHide); clearTimeout(tDone) }
  }, [])
  if (phase === 'done') return null
  return (
    <div className={'boot-splash' + (phase === 'hide' ? ' boot-hide' : '')} aria-hidden>
      <img src="/logo/GAAhex-mark-animated.svg" alt="" className="boot-mark" />
    </div>
  )
}
