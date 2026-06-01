// PageHeaderSlot — page authors call this to fill Zone 1.
//
// Usage:
//   <PageHeaderSlot title="Customer: Արման" identityTag="CUS-1042"
//                   statusBadge={{ label: 'ACTIVE', variant: 'success' }}
//                   actions={[{ label: 'New Ticket', onClick: openTicket }]} />
//
// The slot itself renders nothing in the page tree. It publishes the header config
// to the MasterLayout context; Zone1PageHeader subscribes and renders.
import { useEffect } from 'react'
import { useRegisterSlot } from '../MasterLayoutContext'
import { Zone1PageHeaderRenderer, type Zone1Props } from '../zones/Zone1PageHeader'

export default function PageHeaderSlot(props: Zone1Props) {
  const register = useRegisterSlot()
  useEffect(() => {
    register('pageHeader', <Zone1PageHeaderRenderer {...props} />)
    return () => register('pageHeader', null)
    // Re-publish on any prop change. Using JSON.stringify of the props would be
    // overkill; we re-render the prop wrapper on every render of the parent page,
    // which is fine because the work is just a setState.
  }, [register, props.title, props.identityTag, props.statusBadge?.label,
      props.statusBadge?.variant, props.actions, props.back])
  return null
}
