// ApiDocsPane — Studio leaf for Developer → API Docs.
//
// Renders the live FastAPI OpenAPI spec served at GET /openapi.json as a clean,
// navigable, GAAhex-styled spec viewer. NOT a Swagger UI clone — a focused read-
// only browser: title + version + base, a tag-grouped endpoint index, and per-
// endpoint expand for the verb, path, summary, parameters, request body shape
// and response shape. For GET endpoints with no required path/body parameters
// (and parameters the operator can fill in by hand for the ones that exist) a
// small "Try it" form fires a real request and renders the response.
//
// Data is real (no fixtures). The spec is fetched once per token; the auth
// header is reused so the live test calls inherit the current SuperAdmin
// session. Light + dark via --gx-* tokens; no raw hex; no emoji.

import { Button } from '../primitives'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner } from '../components/States'
import {
  PlayIcon, RowsIcon, GlobeIcon, LockIcon, InfoIcon, CheckIcon,
} from '../components/icons'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

// ---------------------------------------------------------------------------
// OpenAPI shape (the subset we actually use)
// ---------------------------------------------------------------------------
type OASParam = {
  name: string
  in: 'query' | 'path' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: Record<string, unknown>
}

type OASOp = {
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  parameters?: OASParam[]
  requestBody?: {
    required?: boolean
    content?: Record<string, { schema?: Record<string, unknown> }>
  }
  responses?: Record<string, {
    description?: string
    content?: Record<string, { schema?: Record<string, unknown> }>
  }>
  security?: Array<Record<string, unknown>>
}

type OASPath = Partial<Record<'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head', OASOp>>

type OAS = {
  openapi?: string
  info?: { title?: string; version?: string; description?: string }
  servers?: Array<{ url: string; description?: string }>
  paths: Record<string, OASPath>
  components?: { schemas?: Record<string, Record<string, unknown>> }
}

type Endpoint = {
  id: string                // method + ' ' + path
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'
  path: string
  tag: string
  op: OASOp
}

const METHOD_COLOR: Record<Endpoint['method'], string> = {
  GET:     'var(--gx-info-fg)',
  POST:    'var(--gx-success-fg)',
  PUT:     'var(--gx-warning-fg)',
  PATCH:   'var(--gx-warning-fg)',
  DELETE:  'var(--gx-danger-fg)',
  OPTIONS: 'var(--gx-text-3)',
  HEAD:    'var(--gx-text-3)',
}

// D18: GET (safe-read default) = azure-soft (interactive family). The rest map to
// semantic status families (success/warning/danger) or slate surface for OPTIONS/HEAD.
const METHOD_BG: Record<Endpoint['method'], string> = {
  GET:     'var(--gx-interactive-soft)',
  POST:    'var(--gx-success-soft)',
  PUT:     'var(--gx-warning-soft)',
  PATCH:   'var(--gx-warning-soft)',
  DELETE:  'var(--gx-danger-soft)',
  OPTIONS: 'var(--gx-surface-2)',
  HEAD:    'var(--gx-surface-2)',
}

// ---------------------------------------------------------------------------
// Schema → human-friendly snippet
// ---------------------------------------------------------------------------
function resolveRef(spec: OAS, ref: string): Record<string, unknown> | null {
  // e.g. "#/components/schemas/HTTPValidationError"
  if (!ref.startsWith('#/')) return null
  const parts = ref.slice(2).split('/')
  let cur: unknown = spec
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return null
    }
  }
  return (cur as Record<string, unknown>) ?? null
}

function shortSchemaType(schema: Record<string, unknown> | undefined, spec: OAS, depth = 0): string {
  if (!schema) return 'any'
  if (depth > 3) return '…'
  const ref = schema.$ref as string | undefined
  if (ref) {
    const resolved = resolveRef(spec, ref)
    if (resolved) return shortSchemaType(resolved, spec, depth + 1)
    return ref.split('/').pop() ?? 'object'
  }
  const anyOf = schema.anyOf as Array<Record<string, unknown>> | undefined
  if (Array.isArray(anyOf) && anyOf.length) {
    return anyOf.map(s => shortSchemaType(s, spec, depth + 1)).join(' | ')
  }
  const oneOf = schema.oneOf as Array<Record<string, unknown>> | undefined
  if (Array.isArray(oneOf) && oneOf.length) {
    return oneOf.map(s => shortSchemaType(s, spec, depth + 1)).join(' | ')
  }
  const type = schema.type as string | undefined
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined
    return shortSchemaType(items, spec, depth + 1) + '[]'
  }
  if (type === 'object' || schema.properties) {
    return 'object'
  }
  if (type) return type
  return 'any'
}

function schemaSample(schema: Record<string, unknown> | undefined, spec: OAS, depth = 0): unknown {
  if (!schema || depth > 4) return null
  const ref = schema.$ref as string | undefined
  if (ref) {
    const resolved = resolveRef(spec, ref)
    if (resolved) return schemaSample(resolved, spec, depth + 1)
    return ref.split('/').pop()
  }
  if (schema.example !== undefined) return schema.example
  const anyOf = schema.anyOf as Array<Record<string, unknown>> | undefined
  if (Array.isArray(anyOf) && anyOf.length) {
    const real = anyOf.find(s => (s.type as string | undefined) !== 'null')
    return schemaSample(real ?? anyOf[0], spec, depth + 1)
  }
  const type = schema.type as string | undefined
  if (type === 'array') {
    return [schemaSample(schema.items as Record<string, unknown> | undefined, spec, depth + 1)]
  }
  if (type === 'object' || schema.properties) {
    const props = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {}
    const out: Record<string, unknown> = {}
    for (const [name, p] of Object.entries(props)) {
      out[name] = schemaSample(p, spec, depth + 1)
    }
    return out
  }
  if (type === 'string') return 'string'
  if (type === 'integer' || type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'null') return null
  return null
}

// ---------------------------------------------------------------------------
// "Try it" — runs a real fetch against the live backend
// ---------------------------------------------------------------------------
function TryIt({ token, endpoint }: { token: string; endpoint: Endpoint }) {
  const pathParams = (endpoint.op.parameters ?? []).filter(p => p.in === 'path')
  const queryParams = (endpoint.op.parameters ?? []).filter(p => p.in === 'query')
  const [pathVals, setPathVals] = useState<Record<string, string>>({})
  const [queryVals, setQueryVals] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ status: number; body: string } | null>(null)
  const [err, setErr] = useState('')

  function buildUrl(): string {
    let p = endpoint.path
    for (const param of pathParams) {
      const v = pathVals[param.name] ?? ''
      p = p.replace(`{${param.name}}`, encodeURIComponent(v))
    }
    const qs = new URLSearchParams()
    for (const param of queryParams) {
      const v = queryVals[param.name]
      if (v != null && v !== '') qs.set(param.name, v)
    }
    const q = qs.toString()
    return BASE + p + (q ? '?' + q : '')
  }

  function missingPathValue(): string | null {
    for (const param of pathParams) {
      if (param.required && !(pathVals[param.name] ?? '').trim()) return param.name
    }
    return null
  }

  async function run() {
    const missing = missingPathValue()
    if (missing) { setErr(`Path parameter "${missing}" is required.`); return }
    setRunning(true); setErr(''); setResult(null)
    try {
      const url = buildUrl()
      const r = await fetch(url, { method: endpoint.method, headers: authH(token) })
      let body: string
      const ct = r.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const j = await r.json().catch(() => null)
        body = JSON.stringify(j, null, 2)
      } else {
        body = await r.text()
      }
      setResult({ status: r.status, body: body.length > 4000 ? body.slice(0, 4000) + '\n…' : body })
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div
      style={{
        marginTop: 'var(--gx-space-4)', padding: 'var(--gx-space-4)',
        border: '1px solid var(--gx-border)',
        borderRadius: 'var(--gx-radius-md)',
        background: 'var(--gx-surface-2)',
      }}
    >
      <div className="row" style={{ alignItems: 'center', marginBottom: 'var(--gx-space-4)' }}>
        <strong style={{ fontSize: 'var(--gx-text-13)' }}>Try it</strong>
        <span className="hint" style={{ marginLeft: 'var(--gx-space-3)', fontSize: 'var(--gx-text-11)' }}>
          Live request — your current session token is reused.
        </span>
        <span className="spacer" />
        <Button variant="secondary" size="sm"
            type="button" 
          onClick={run} disabled={running}>
          <PlayIcon size={13} /> {running ? 'Sending…' : 'Send request'}
        </Button>
      </div>

      {pathParams.length > 0 && (
        <div style={{ marginBottom: 'var(--gx-space-4)' }}>
          <div className="hint" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 'var(--gx-space-2)' }}>
            Path parameters
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gx-space-4)' }}>
            {pathParams.map((p) => (
              <label key={p.name} className="field">
                <span>{p.name}{p.required ? ' *' : ''}</span>
                <input
                  className="inp inp-sm mono"
                  value={pathVals[p.name] ?? ''}
                  onChange={(e) => setPathVals(v => ({ ...v, [p.name]: e.target.value }))}
                  placeholder={p.description ?? ''}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {queryParams.length > 0 && (
        <div style={{ marginBottom: 'var(--gx-space-4)' }}>
          <div className="hint" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 'var(--gx-space-2)' }}>
            Query parameters
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gx-space-4)' }}>
            {queryParams.map((p) => (
              <label key={p.name} className="field">
                <span>{p.name}{p.required ? ' *' : ''}</span>
                <input
                  className="inp inp-sm mono"
                  value={queryVals[p.name] ?? ''}
                  onChange={(e) => setQueryVals(v => ({ ...v, [p.name]: e.target.value }))}
                  placeholder={p.description ?? ''}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="hint mono" style={{ fontSize: 'var(--gx-text-11)', wordBreak: 'break-all', marginBottom: 'var(--gx-space-2)' }}>
        {endpoint.method} {buildUrl().replace(BASE, '')}
      </div>

      {err && <ErrorBanner message={err} />}
      {result && (
        <div
          style={{
            marginTop: 'var(--gx-space-3)', padding: 'var(--gx-space-5)',
            background: 'var(--gx-surface)',
            border: '1px solid var(--gx-border)',
            borderRadius: 'var(--gx-radius-md)',
          }}
        >
          <div className="row" style={{ alignItems: 'center', marginBottom: 'var(--gx-space-3)' }}>
            <strong style={{ fontSize: 'var(--gx-text-sm)' }}>Response</strong>
            <span className="spacer" />
            <span
              className="mono"
              style={{
                fontSize: 'var(--gx-text-11)',
                padding: 'var(--gx-space-1) var(--gx-space-4)',
                borderRadius: 'var(--gx-radius-sm, 4px)',
                background: result.status >= 200 && result.status < 300
                  ? 'var(--gx-success-soft)'
                  : result.status >= 400
                    ? 'var(--gx-danger-soft)'
                    : 'var(--gx-warning-soft)',
                color: result.status >= 200 && result.status < 300
                  ? 'var(--gx-success-fg)'
                  : result.status >= 400
                    ? 'var(--gx-danger-fg)'
                    : 'var(--gx-warning-fg)',
              }}
            >
              HTTP {result.status}
            </span>
          </div>
          <pre
            className="mono"
            style={{
              margin: 0, fontSize: 'var(--gx-text-11)', lineHeight: 1.5,
              maxHeight: 320, overflow: 'auto',
              color: 'var(--gx-text-2)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {result.body}
          </pre>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Endpoint detail (expanded card body)
// ---------------------------------------------------------------------------
function EndpointDetail({ spec, endpoint, token }: { spec: OAS; endpoint: Endpoint; token: string }) {
  const params = endpoint.op.parameters ?? []
  const reqBody = endpoint.op.requestBody
  const reqSchema = reqBody?.content?.['application/json']?.schema
  const responses = endpoint.op.responses ?? {}
  const requiresAuth = (endpoint.op.security ?? []).length > 0

  // Surface unsupported "Try it" cases honestly (write methods, body required, etc.)
  const tryAllowed =
    endpoint.method === 'GET' &&
    !reqBody &&
    params.every(p => p.in === 'query' || p.in === 'path')

  return (
    <div
      style={{
        padding: 'var(--gx-space-6) var(--gx-space-7)',
        background: 'var(--gx-surface)',
        borderTop: '1px solid var(--gx-border)',
      }}
    >
      {endpoint.op.description && (
        <p style={{ margin: '0 0 var(--gx-space-5)', fontSize: 'var(--gx-text-13)', color: 'var(--gx-text-2)' }}>
          {endpoint.op.description}
        </p>
      )}

      {requiresAuth && (
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)',
            fontSize: 'var(--gx-text-11)', padding: 'var(--gx-space-1) var(--gx-space-4)',
            background: 'var(--gx-warning-soft)',
            color: 'var(--gx-warning-fg)',
            borderRadius: 'var(--gx-radius-sm, 4px)',
            marginBottom: 'var(--gx-space-5)',
          }}
        >
          <LockIcon size={11} /> Requires authentication
        </div>
      )}

      {params.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 'var(--gx-space-2)' }}>
            <RowsIcon size={14} className="section-icon" /> Parameters
          </div>
          <div className="grid-wrap" style={{ marginBottom: 'var(--gx-space-5)' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">In</th>
                  <th scope="col">Type</th>
                  <th scope="col">Required</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {params.map((p) => (
                  <tr key={p.name + ':' + p.in}>
                    <td><code className="mono">{p.name}</code></td>
                    <td><span className="hint mono">{p.in}</span></td>
                    <td><span className="mono" style={{ fontSize: 'var(--gx-text-11)' }}>{shortSchemaType(p.schema, spec)}</span></td>
                    <td>{p.required ? <CheckIcon size={13} /> : <span className="hint">—</span>}</td>
                    <td className="hint" style={{ fontSize: 'var(--gx-text-sm)' }}>{p.description ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {reqSchema && (
        <>
          <div className="section-head" style={{ marginTop: 'var(--gx-space-2)' }}>
            <RowsIcon size={14} className="section-icon" /> Request body
            {reqBody?.required && (
              <span
                style={{
                  marginLeft: 'var(--gx-space-3)', fontSize: 'var(--gx-text-10)', padding: '1px var(--gx-space-3)',
                  background: 'var(--gx-warning-soft)',
                  color: 'var(--gx-warning-fg)',
                  borderRadius: 'var(--gx-radius-sm, 4px)',
                  fontWeight: 'var(--gx-weight-semibold)',
                }}
              >
                required
              </span>
            )}
          </div>
          <pre
            className="mono"
            style={{
              margin: '0 0 var(--gx-space-5)', padding: 'var(--gx-space-5)', fontSize: 'var(--gx-text-11)', lineHeight: 1.5,
              maxHeight: 220, overflow: 'auto',
              background: 'var(--gx-surface-2)',
              border: '1px solid var(--gx-border)',
              borderRadius: 'var(--gx-radius-md)',
              color: 'var(--gx-text-2)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {JSON.stringify(schemaSample(reqSchema, spec), null, 2)}
          </pre>
        </>
      )}

      {Object.keys(responses).length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 'var(--gx-space-2)' }}>
            <RowsIcon size={14} className="section-icon" /> Responses
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-3)', marginBottom: 'var(--gx-space-4)' }}>
            {Object.entries(responses).map(([code, resp]) => {
              const schema = resp.content?.['application/json']?.schema
              const codeNum = parseInt(code, 10)
              const okish = !isNaN(codeNum) && codeNum >= 200 && codeNum < 300
              const errish = !isNaN(codeNum) && codeNum >= 400
              return (
                <div
                  key={code}
                  style={{
                    border: '1px solid var(--gx-border)',
                    borderRadius: 'var(--gx-radius-md)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    className="row"
                    style={{
                      alignItems: 'center', padding: 'var(--gx-space-3) var(--gx-space-5)',
                      background: okish
                        ? 'var(--gx-success-soft)'
                        : errish ? 'var(--gx-danger-soft)' : 'var(--gx-surface-2)',
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        fontWeight: 'var(--gx-weight-semibold)', fontSize: 'var(--gx-text-sm)',
                        color: okish ? 'var(--gx-success-fg)' : errish ? 'var(--gx-danger-fg)' : 'var(--gx-text-2)',
                      }}
                    >
                      {code}
                    </span>
                    <span className="hint" style={{ marginLeft: 'var(--gx-space-5)', fontSize: 'var(--gx-text-sm)' }}>
                      {resp.description ?? ''}
                    </span>
                  </div>
                  {schema && (
                    <pre
                      className="mono"
                      style={{
                        margin: 0, padding: 'var(--gx-space-5)', fontSize: 'var(--gx-text-11)', lineHeight: 1.5,
                        maxHeight: 220, overflow: 'auto',
                        background: 'var(--gx-surface)',
                        color: 'var(--gx-text-2)',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}
                    >
                      {JSON.stringify(schemaSample(schema, spec), null, 2)}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {tryAllowed && <TryIt token={token} endpoint={endpoint} />}
      {!tryAllowed && endpoint.method !== 'GET' && (
        <p className="hint" style={{ margin: 'var(--gx-space-4) 0 0', fontSize: 'var(--gx-text-11)' }}>
          <InfoIcon size={11} style={{ verticalAlign: 'middle', marginRight: 'var(--gx-space-2)' }} />
          "Try it" is only available for GET endpoints — write methods are intentionally not
          fired from the docs viewer to avoid side effects.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One endpoint row (click to expand)
// ---------------------------------------------------------------------------
function EndpointRow({ spec, endpoint, token }: { spec: OAS; endpoint: Endpoint; token: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      style={{
        border: '1px solid var(--gx-border)',
        borderRadius: 'var(--gx-radius-md)',
        marginBottom: 'var(--gx-space-3)',
        overflow: 'hidden',
        background: 'var(--gx-surface)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)',
          width: '100%', padding: 'var(--gx-space-4) var(--gx-space-5)',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          color: 'var(--gx-text-1)',
        }}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span
          className="mono"
          style={{
            padding: 'var(--gx-space-1) var(--gx-space-4)',
            borderRadius: 'var(--gx-radius-sm, 4px)',
            fontSize: 'var(--gx-text-11)',
            fontWeight: 'var(--gx-weight-bold)',
            background: METHOD_BG[endpoint.method],
            color: METHOD_COLOR[endpoint.method],
            minWidth: 56,
            textAlign: 'center',
          }}
        >
          {endpoint.method}
        </span>
        <code
          className="mono"
          style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-1)' }}
        >
          {endpoint.path}
        </code>
        {endpoint.op.summary && (
          <span
            className="hint"
            style={{ marginLeft: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}
          >
            {endpoint.op.summary}
          </span>
        )}
      </button>
      {open && <EndpointDetail spec={spec} endpoint={endpoint} token={token} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main pane
// ---------------------------------------------------------------------------
export default function ApiDocsPane({ token }: { token: string }) {
  const [spec, setSpec] = useState<OAS | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)

  const load = useCallback(() => {
    let alive = true
    setLoading(true); setError('')
    fetch(BASE + '/openapi.json', { headers: authH(token) })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        if (alive) setSpec(j as OAS)
      })
      .catch((ex) => { if (alive) setError((ex as Error).message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  useEffect(() => load(), [load])

  const { endpoints, tagsOrdered, byTag } = useMemo(() => {
    if (!spec || !spec.paths) {
      return { endpoints: [] as Endpoint[], tagsOrdered: [] as string[], byTag: {} as Record<string, Endpoint[]> }
    }
    const all: Endpoint[] = []
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods as OASPath)) {
        if (!op) continue
        const m = method.toUpperCase() as Endpoint['method']
        const tag = (op.tags && op.tags[0]) || 'untagged'
        all.push({ id: m + ' ' + path, method: m, path, tag, op })
      }
    }
    all.sort((a, b) => a.tag.localeCompare(b.tag) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
    const grouped: Record<string, Endpoint[]> = {}
    for (const e of all) {
      if (!grouped[e.tag]) grouped[e.tag] = []
      grouped[e.tag].push(e)
    }
    const ordered = Object.keys(grouped).sort((a, b) => a.localeCompare(b))
    return { endpoints: all, tagsOrdered: ordered, byTag: grouped }
  }, [spec])

  if (loading) return <LoadingState />
  if (error) return <ErrorBanner message={`Failed to load OpenAPI spec: ${error}`} onRetry={load} />
  if (!spec) return <EmptyState title="No spec available" />

  const q = search.trim().toLowerCase()
  const filteredTags = q
    ? tagsOrdered.filter(tag => {
        if (tag.toLowerCase().includes(q)) return true
        return byTag[tag].some(e =>
          e.path.toLowerCase().includes(q) ||
          (e.op.summary ?? '').toLowerCase().includes(q) ||
          e.method.toLowerCase().includes(q),
        )
      })
    : tagsOrdered

  // Inside each tag, filter endpoints by the query too (so the tag list collapses cleanly).
  function endpointsForTag(tag: string): Endpoint[] {
    const list = byTag[tag] ?? []
    if (!q) return list
    if (tag.toLowerCase().includes(q)) return list
    return list.filter(e =>
      e.path.toLowerCase().includes(q) ||
      (e.op.summary ?? '').toLowerCase().includes(q) ||
      e.method.toLowerCase().includes(q),
    )
  }

  const title = spec.info?.title ?? 'API'
  const version = spec.info?.version ?? ''
  const description = spec.info?.description ?? ''
  const baseUrl = (spec.servers && spec.servers[0] && spec.servers[0].url) || BASE

  const visibleTags = filteredTags.filter(t => endpointsForTag(t).length > 0)
  const visibleCount = visibleTags.reduce((n, t) => n + endpointsForTag(t).length, 0)
  const totalOps = endpoints.length

  return (
    <div>
      <div className="row" style={{ marginBottom: 'var(--gx-space-7)', alignItems: 'flex-end' }}>
        <div>
          <h3 style={{ margin: '0 0 var(--gx-space-2)' }}>{title}</h3>
          <p className="hint" style={{ margin: 0 }}>
            Live OpenAPI spec, fetched from <code className="mono">/openapi.json</code>.
            {' '}
            <strong>{totalOps}</strong> operation{totalOps === 1 ? '' : 's'} across{' '}
            <strong>{tagsOrdered.length}</strong> tag{tagsOrdered.length === 1 ? '' : 's'}.
          </p>
        </div>
        <span className="spacer" />
        {version && (
          <span
            className="mono"
            style={{
              padding: 'var(--gx-space-2) var(--gx-space-5)', fontSize: 'var(--gx-text-sm)',
              background: 'var(--gx-surface-2)',
              border: '1px solid var(--gx-border)',
              borderRadius: 'var(--gx-radius-sm, 4px)',
              color: 'var(--gx-text-2)',
            }}
          >
            v{version}
          </span>
        )}
      </div>

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)',
          padding: 'var(--gx-space-5) var(--gx-space-6)',
          border: '1px solid var(--gx-border)',
          borderRadius: 'var(--gx-radius-md)',
          background: 'var(--gx-surface-2)',
          marginBottom: 'var(--gx-space-7)',
        }}
      >
        <GlobeIcon size={15} style={{ color: 'var(--gx-text-3)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="hint" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Base URL
          </div>
          <code className="mono" style={{ fontSize: 'var(--gx-text-sm)', wordBreak: 'break-all' }}>{baseUrl}</code>
        </div>
        {description && (
          <div className="hint" style={{ fontSize: 'var(--gx-text-sm)', maxWidth: 360 }}>
            {description}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 'var(--gx-space-4)', maxWidth: 360 }}>
        <input
          className="inp inp-md"
          placeholder="Filter by tag, path, or summary…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Tag chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gx-space-3)', marginBottom: 'var(--gx-space-7)' }}>
        <button
          type="button"
          className={'btn btn-sm ' + (activeTag === null ? 'btn-primary' : 'btn-ghost')}
          onClick={() => setActiveTag(null)}
        >
          All ({totalOps})
        </button>
        {tagsOrdered.map((tag) => (
          <button
            key={tag}
            type="button"
            className={'btn btn-sm ' + (activeTag === tag ? 'btn-primary' : 'btn-ghost')}
            onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            style={{ fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 'var(--gx-text-11)' }}
          >
            {tag} ({byTag[tag].length})
          </button>
        ))}
      </div>

      {q && visibleCount === 0 && (
        <EmptyState
          title="No endpoints match the filter"
          message="Try a different query."
        />
      )}

      {/* Tag-grouped endpoint list */}
      {visibleTags
        .filter(tag => activeTag === null || tag === activeTag)
        .map((tag) => {
          const list = endpointsForTag(tag)
          if (list.length === 0) return null
          return (
            <div key={tag} style={{ marginBottom: 'var(--gx-space-18)' }}>
              <div className="section-head" style={{ marginTop: 0 }}>
                <RowsIcon size={15} className="section-icon" /> {tag}
                <span className="hint" style={{ marginLeft: 'var(--gx-space-3)', fontWeight: 'var(--gx-weight-regular)' }}>
                  · {list.length} endpoint{list.length === 1 ? '' : 's'}
                </span>
              </div>
              <div>
                {list.map((ep) => (
                  <EndpointRow key={ep.id} spec={spec} endpoint={ep} token={token} />
                ))}
              </div>
            </div>
          )
        })}
    </div>
  )
}
