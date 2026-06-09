// NetworkInventoryView — shared TypeScript types.

export type FiberStatus = 'PLANNED' | 'CONSTRUCTION' | 'ACTIVE' | 'DECOMMISSIONED' | string
export interface FiberRoute {
  id: string
  name?: string | null
  geo_path?: string | null         // WKT
  capacity_gbps?: number | null
  origin_pop?: string | null
  destination_pop?: string | null
  status?: FiberStatus | null
  created_at?: string | null
  [k: string]: any
}
export interface OutagePath { id: string; outage_id?: string; status?: string; affected_at?: string | null; [k: string]: any }

export type IpamFamily = 'ipv4' | 'ipv6' | string
export type IpamStatus = 'active' | 'released' | string
export interface IpamAssignment {
  id: string
  address?: string | null
  family?: IpamFamily | null
  status?: IpamStatus | null
  service_id?: string | null
  mac?: string | null
  assigned_at?: string | null
  lease_expires_at?: string | null
  pool_allocation_id?: string | null
  [k: string]: any
}

export type RadiusStatus = 'active' | 'stopped' | string
export interface RadiusSession {
  id: string
  username?: string | null
  session_id?: string | null
  nas_ip?: string | null
  framed_ip?: string | null
  acct_start?: string | null
  acct_stop?: string | null
  status?: RadiusStatus | null
  octets_in?: number | null
  octets_out?: number | null
  service_id?: string | null
  [k: string]: any
}

export type BroadcastChannel = 'sms' | 'email' | 'voice' | 'push' | string
export type BroadcastStatus = 'draft' | 'sending' | 'complete' | 'failed' | string
export interface Broadcast {
  id: string
  channel?: BroadcastChannel | null
  template_id?: string | null
  recipient_count?: number | null
  sent_count?: number | null
  failed_count?: number | null
  status?: BroadcastStatus | null
  incident_record_id?: string | null
  audience_filter_json?: any
  created_at?: string | null
  [k: string]: any
}

export type TabKey = 'fiber' | 'ipam' | 'radius' | 'broadcasts'
