// TabsSlot — page authors call this to fill Zone 2.
//
// Usage:
//   <TabsSlot activeKey={tab} onChange={setTab} tabs={[
//     { key: 'overview', label: 'Overview' },
//     { key: 'invoices', label: 'Invoices', badge: 3 },
//   ]} />
//
// If a page has no tabs, simply don't render <TabsSlot /> — Zone 2 collapses to nothing.
import { useEffect } from 'react'
import { useRegisterSlot } from '../MasterLayoutContext'
import { Zone2TabsRenderer, type Zone2Props } from '../zones/Zone2Tabs'

export default function TabsSlot(props: Zone2Props) {
  const register = useRegisterSlot()
  useEffect(() => {
    register('tabs', <Zone2TabsRenderer {...props} />)
    return () => register('tabs', null)
  }, [register, props.activeKey, props.onChange, props.tabs])
  return null
}
