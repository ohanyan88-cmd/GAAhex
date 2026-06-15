// RATCHET lint — eslint + prettier on the TS files changed vs a base ref ONLY.
// Used by `npm run gate` (local, base = HEAD~1) and CI (base = the PR target).
// Legacy files are never linted unless they change; new/changed code can't regress.
import { execSync } from 'node:child_process'

const base = process.env.GATE_BASE || 'HEAD~1'
let files = []
try {
  files = execSync(`git diff --name-only --diff-filter=ACMR ${base} HEAD`, { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => /\.(ts|tsx)$/.test(f) && f.startsWith('frontend/'))
    .map((f) => f.replace(/^frontend\//, ''))
} catch {
  // No base (first commit / shallow clone) — nothing to ratchet against.
}

if (!files.length) {
  console.log('gate:lint-changed — no changed frontend TS files.')
  process.exit(0)
}
console.log('gate:lint-changed —', files.join(', '))
execSync(`npx eslint ${files.map((f) => JSON.stringify(f)).join(' ')}`, { stdio: 'inherit' })
execSync(`npx prettier --check ${files.map((f) => JSON.stringify(f)).join(' ')}`, { stdio: 'inherit' })
console.log('gate:lint-changed — OK')
