// Personal layout regression: use the real upstream helpers and built lazy chunk.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { sanitizeConfig, applyConfigPatch, Ledger } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'

const now = Date.parse('2026-11-16T02:00:00Z')
class Clock extends Date { static now() { return now } }
const element = (type, props, ...children) => ({ type, props: props ?? {}, children })
let hookOverrides = []
const React = { createElement: element, Fragment: 'fragment', useEffect() {},
  useState: value => [hookOverrides.length ? hookOverrides.shift() : typeof value === 'function' ? value() : value, () => {}], useRef: value => ({ current: value }) }
const styles = new Map()
const document = {
  querySelector: () => null,
  getElementById: id => styles.get(id),
  createElement: () => ({ dataset: {} }),
  head: { appendChild: value => { styles.set(value.id ?? 'main', value) } },
}
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.children)] : []
let registration, requests = 0
const context = vm.createContext({ Date: Clock, navigator: { language: 'en' }, document, console,
  window: { __ModuleLoader__: { load: value => { registration = value } }, localStorage: { getItem: () => null } },
  fetch: () => { requests++; throw new Error('Rendering must not fetch') },
})
const directory = new URL('../src/client/', import.meta.url)
const source = readdirSync(directory).filter(name => name.endsWith('.js')).sort()
  .map(name => readFileSync(new URL(name, directory), 'utf8')).join('')
const expose = 'parseConfig, parseDay, renderSidebarFooter, loadCompactIcons, codexQuotaCache, BillingStatistics'
vm.runInContext(source.replace('exports.apply = apply', `exports.test = { ${expose} }; exports.apply = apply`), context)
const require = name => name === 'react' ? React : { Tooltip: 'tooltip' }
let chunkExports
require.async = async path => {
  assert.equal(path, './client.compact-icons.js')
  if (!chunkExports) {
    vm.runInContext(readFileSync(new URL('../lib/client.compact-icons.js', import.meta.url), 'utf8'), context)
    assert.equal(registration.chunk, 'client.compact-icons.js')
    chunkExports = registration.factory(require)
  }
  return chunkExports
}
const core = registration.factory(require).test
const original = sanitizeConfig({ sidebarSimple: false, sidebarStyle: 'standard', hideOfficialBalance: true,
  goQuota: { enabled: false }, peakEnabled: true, peakNotice: true, codexQuotaEnabled: true })
const changed = applyConfigPatch(original, { sidebarStyle: 'icons' })
assert.deepEqual(changed.errors, [])
const config = core.parseConfig(stateSchema.shape.config.parse(changed.config), 'config')
assert.equal(config.sidebarStyle, 'icons', 'style survives config patch, RPC and client parsing')
assert.ok(applyConfigPatch(original, { sidebarStyle: 'invalid' }).errors.length)
const today = { cost: 10, apiCost: 4, calls: 4, input: 100, output: 20, cacheRead: 0, cacheWrite: 0,
  byProviderModel: { 'aiclub:claude-opus-5-5': { cost: 6, apiCost: 3, calls: 2 },
    'plan:claude-sonnet': { cost: 1, apiCost: 0, calls: 1 }, 'other:model': { cost: 3, apiCost: 1, calls: 1 } } }
const state = { config, today: core.parseDay({ ...today, date: '2026-11-16' }, 'today'), month: today, total: today, codingPlans: {}, gatewayQuotas: { sources: [] } }
const entry = core.renderSidebarFooter(state, true, {}, false)
assert.match(entry.props.className, /cm-icon-host/, 'bounded wrapper exists before the lazy chunk loads')
const loader = nodes(entry).find(node => node.type === core.BillingStatistics)
assert.ok(loader, 'uses the existing async page loader with error/retry handling')
const pending = core.BillingStatistics(loader.props)
assert.equal(pending.type, 'span', 'footer loading never renders the 160px settings-page spinner')
assert.equal(pending.props.role, 'status')
hookOverrides = [null, 'chunk unavailable', 0]
const failed = core.BillingStatistics(loader.props)
assert.equal(failed.type, 'button')
assert.match(failed.props['aria-label'], /Retry|重试/)
assert.equal(failed.props.title, 'chunk unavailable')
assert.equal(core.renderSidebarFooter(state, false, {}, false), null, '56px rail keeps Settings clear')
Object.assign(core.codexQuotaCache, { source: 'auto', status: 'ok', fetchedAt: now,
  windows: { weekly: { percent: 25, resetsAt: new Date(now + 86400000).toISOString() } } })
const Component = await core.loadCompactIcons()
const render = (patch = {}, preview = false) => Component({ state: { ...state, config: { ...config, ...patch } }, preview })
const ringNodes = tree => nodes(tree).filter(node => ['codex', 'dsh', 'claude'].includes(node.props.kind))
let tree = render()
assert.deepEqual(ringNodes(tree).map(node => node.props.kind), ['codex', 'dsh', 'claude'])
assert.equal(ringNodes(tree).find(node => node.props.kind === 'codex').props.percent, 75, 'invert upstream used percentage once')
assert.equal(ringNodes(tree).find(node => node.props.kind === 'claude').props.percent, 75, 'API-only total and Claude share use upstream amount semantics')
assert.equal(ringNodes(render({ showTotalWithPlan: true })).find(node => node.props.kind === 'claude').props.percent, 70)
assert.match(ringNodes(tree).find(node => node.props.kind === 'claude').props.detail, /3 calls|3 次调用/, 'wire parsing retains model call counts')
const savedToday = state.today
const frozenToday = { ...today, date: '2026-11-16', costCny: 100, apiCostCny: 40, costEur: 20, apiCostEur: 8,
  byProviderModel: { ...today.byProviderModel,
    'aiclub:claude-opus-5-5': { ...today.byProviderModel['aiclub:claude-opus-5-5'], costCny: 20, apiCostCny: 12, costEur: 5, apiCostEur: 2 },
    'plan:claude-sonnet': { ...today.byProviderModel['plan:claude-sonnet'], costCny: 60, apiCostCny: 0, costEur: 9, apiCostEur: 0 } } }
state.today = core.parseDay(frozenToday, 'today')
assert.equal(ringNodes(render({ currency: 'CNY', exchangeRate: 10 })).find(node => node.props.kind === 'claude').props.percent, 30)
assert.equal(ringNodes(render({ currency: 'CNY', exchangeRate: 10, showTotalWithPlan: true })).find(node => node.props.kind === 'claude').props.percent, 80)
assert.equal(ringNodes(render({ currency: 'EUR', exchangeRate: 2 })).find(node => node.props.kind === 'claude').props.percent, 25)
state.today = savedToday
Object.assign(core.codexQuotaCache, { status: 'unavailable', message: 'fixture connection unavailable' })
assert.match(ringNodes(render()).find(node => node.props.kind === 'codex').props.detail, /fixture connection unavailable/)
Object.assign(core.codexQuotaCache, { status: 'ok', message: '' })
assert.equal(ringNodes(render({ hideTodayCost: true })).some(node => node.props.kind === 'claude'), false)
assert.equal(nodes(render({ hideTodayCost: true })).some(node => node.props.className === 'cm-compact-amount'), false)
assert.equal(ringNodes(render({ codexQuotaSidebar: false })).some(node => node.props.kind === 'codex'), false)
assert.equal(render({ codexQuotaEnabled: false, peakNotice: false, hideTodayCost: true }), null)
const previewRings = ringNodes(render({}, true))
assert.equal(previewRings.find(node => node.props.kind === 'codex').props.refresh, null, 'preview cannot refresh an account')
for (const ring of ringNodes(tree)) {
  const rendered = ring.type(ring.props)
  assert.ok(nodes(rendered).some(node => node.props.tabIndex === 0 || node.props.role === 'button'), 'keyboard reachable indicator')
  assert.ok(nodes(rendered).some(node => node.props['aria-label'] === ring.props.detail), 'localized accessible detail')
  assert.ok(nodes(rendered).some(node => ['today', 'peak', 'codex'].includes(node.props['data-cm-display'])), 'preview can select the real icon target')
}
assert.equal(requests, 0, 'rendering adds no account queries or network polling')
assert.ok(styles.get('dsh-cost-meter-compact-icons').textContent.includes('max-width:104px'))
await core.loadCompactIcons()
assert.equal([...styles.keys()].filter(id => id === 'dsh-cost-meter-compact-icons').length, 1, 'repeated mount reuses its scoped stylesheet')
const normal = core.renderSidebarFooter({ ...state, config: { ...config, sidebarStyle: 'standard' } }, true, {})
assert.match(normal.props.className, /cm-footer-stack/, 'upstream standard layout remains available')
const simple = core.renderSidebarFooter({ ...state, config: { ...config, sidebarSimple: true } }, true, {})
assert.match(simple.props.className, /simple/, 'upstream simple layout remains independent')

const root = mkdtempSync(join(tmpdir(), 'cost-meter-icon-migration-'))
try {
  const path = join(root, 'ledger.json')
  writeFileSync(path, JSON.stringify({ version: 1, config: { ...original, sidebarSimple: true }, days: {}, migrations: [] }))
  const migrated = Ledger.load(path)
  assert.equal(migrated.config.sidebarStyle, 'icons')
  assert.equal(migrated.config.sidebarSimple, false)
  migrated.config = { ...migrated.config, sidebarStyle: 'standard', sidebarSimple: true }
  migrated.scheduleWrite(); migrated.close()
  const reopened = Ledger.load(path)
  assert.equal(reopened.config.sidebarSimple, true, 'one-time migration never overrides a later upstream Simple choice')
  assert.equal(reopened.config.sidebarStyle, 'standard')
  reopened.close()
} finally {
  // root is exclusively allocated by mkdtempSync above.
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] compact icon chunk, config/RPC, Codex/Claude amounts, visibility, preview, keyboard, upstream layouts and one-time migration')
