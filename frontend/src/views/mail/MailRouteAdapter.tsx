// MailRouteAdapter — reads ?folder / ?msg / ?account / ?settings off the URL (the
// HelpdeskRouteAdapter pattern) and mounts MailView. Module-level so it can call
// useSearchParams(); a dunning notification can deep-link a specific sent message and
// the selection survives reload.
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import MailView from './MailView'

export default function MailRouteAdapter() {
  const [searchParams] = useSearchParams()
  const { capabilities } = useAuth()
  return (
    <MailView
      capabilities={capabilities}
      initialAccountId={searchParams.get('account') ?? undefined}
      initialFolderId={searchParams.get('folder') ?? undefined}
      initialMessageId={searchParams.get('msg') ?? undefined}
      openSettings={searchParams.get('settings') === '1'}
    />
  )
}
