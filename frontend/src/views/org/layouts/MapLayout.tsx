import { useMemo, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { CustomFieldDef } from '../../../lib/pageConfig'
import type { OrgNode, CFApi } from '../types'
import { toneClass } from '../utils'

const YEREVAN: [number, number] = [40.18, 44.51]

function pinColor(type: string): string {
  const t = type.toLowerCase()
  if (t === 'group') return 'var(--gx-gold)'
  if (t === 'region') return 'var(--gx-text-2)'
  if (t === 'team') return 'var(--gx-text-3)'
  return 'var(--gx-text-3)'
}

function makePinIcon(type: string): L.DivIcon {
  const fill = pinColor(type)
  const html = `
    <span class="org-map-pin" style="color:${fill}">
      <svg width="26" height="34" viewBox="0 0 26 34" aria-hidden="true">
        <path d="M13 0C5.82 0 0 5.82 0 13c0 9.1 11.5 20.1 12 20.6a1.4 1.4 0 0 0 2 0C14.5 33.1 26 22.1 26 13 26 5.82 20.18 0 13 0z" fill="currentColor"/>
        <circle cx="13" cy="13" r="5.2" fill="var(--gx-on-primary)" fill-opacity="0.92"/>
      </svg>
    </span>`
  return L.divIcon({
    html,
    className: 'org-map-divicon',
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30],
  })
}

function locationFieldKey(defs: CustomFieldDef[]): string | null {
  const byKey = defs.find((d) => d.key.toLowerCase() === 'location')
  if (byKey) return byKey.key
  const byLabel = defs.find((d) => d.label.trim().toLowerCase() === 'location')
  return byLabel ? byLabel.key : null
}

function parseLatLng(raw: unknown): [number, number] | null {
  if (raw == null) return null
  const parts = String(raw).split(',')
  if (parts.length !== 2) return null
  const lat = Number(parts[0].trim())
  const lng = Number(parts[1].trim())
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return [lat, lng]
}

type MapPoint = { node: OrgNode; pos: [number, number] }

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0].pos, 13)
      return
    }
    const bounds = L.latLngBounds(points.map((p) => p.pos))
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 })
  }, [map, points])
  return null
}

export function MapLayout({ nodes, defs, cf }: { nodes: OrgNode[]; defs: CustomFieldDef[]; cf: CFApi }) {
  const locKey = useMemo(() => locationFieldKey(defs), [defs])

  const points = useMemo<MapPoint[]>(() => {
    if (!locKey) return []
    const out: MapPoint[] = []
    for (const node of nodes) {
      const pos = parseLatLng(cf.value(node.id, locKey))
      if (pos) out.push({ node, pos })
    }
    return out
  }, [nodes, locKey, cf])

  const iconCache = useMemo(() => new Map<string, L.DivIcon>(), [])
  const iconFor = (type: string): L.DivIcon => {
    let icon = iconCache.get(type)
    if (!icon) { icon = makePinIcon(type); iconCache.set(type, icon) }
    return icon
  }

  return (
    <div className="org-map-wrap">
      {points.length === 0 && (
        <div className="org-map-hint" role="status">
          Add a 'Location' field (lat,lng) to your org nodes via Configure → Custom fields to plot them on the map.
        </div>
      )}
      <MapContainer
        className="org-map"
        center={YEREVAN}
        zoom={11}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {points.map((p) => (
          <Marker key={p.node.id} position={p.pos} icon={iconFor(p.node.type)}>
            <Popup>
              <div className="org-map-popup">
                <div className="org-map-popup-top">
                  <span className={`badge ${toneClass(p.node.type)}`}>{p.node.type}</span>
                  <span className="org-map-popup-name">{p.node.name}</span>
                </div>
                <div className="org-map-popup-path">/{p.node.path}/</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
