import { createContext, useContext } from 'react'
import type { OrgEdit } from './types'

export const OrgEditContext = createContext<OrgEdit | null>(null)
export function useOrgEdit(): OrgEdit | null {
  return useContext(OrgEditContext)
}
