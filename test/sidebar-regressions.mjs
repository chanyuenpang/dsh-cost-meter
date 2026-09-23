import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { sanitizeConfig } from '../lib/store.js'

const dir = new URL('../src/client/', import.meta.url)
const src = readdirSync(dir).filter(n => n.endsWith('.js')).sort().map(n => readFileSync(new URL(n, dir), 'utf8')).join('')
let factory
const now = Date.parse('2026-09-10T07:00:00Z')
class Clock extends Date { static now() { return now } }
const el = (type, props, ...children) => ({ type, props: props ?? {}, children })
vm.runInNewContext(src.replace('exports.apply = apply', 'exports.test = { SidebarFooter, BudgetBoxContent, BalanceBox, BalanceRowContent, codexQuotaCache }; exports.apply = apply'), {
  Date: Clock, navigator: { language: 'zh' }, window: { __ModuleLoader__: { load: v => { factory = v.factory } }, localStorage: { getItem: () => null } },
})
const ui = factory(name => name === 'react' ? { createElement: el, Fragment: 'fragment', useRef: value => ({ current: value }), useEffect() {}, useState: value => [typeof value === 'function' ? value() : value, () => {}] } : { Tooltip: 'tooltip' }).test
const render = n => Array.isArray(n) ? n.map(render) : n && typeof n === 'object'
  ? typeof n.type === 'function' ? render(n.type(n.props)) : { ...n, children: n.children.map(render) } : n
const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.children)] : []
const text = n => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.children) : n == null ? '' : String(n)
const hasClass = (n, cls) => n.props.className?.split(' ').includes(cls)
ui.codexQuotaCache.status = 'off'
const totals = cost => ({ cost, apiCost: cost, calls: 1, input: 100, output: 20, cacheRead: 0, cacheWrite: 0 })
const state = { today: totals(1 / 7.2), month: totals(8 / 7.2), total: totals(9 / 7.2), budgetUsed: 8 / 7.2,
  balance: { status: 'ok', totalBalance: 47.68, grantedBalance: 0, toppedUpBalance: 47.68, currency: 'CNY', fetchedAt: now },
  codingPlans: {}, gatewayQuotas: { sources: [] }, goQuota: { status: 'ok', rolling: { percent: 20 }, weekly: { percent: 40 }, monthly: { percent: 60 }, fetchedAt: now } }

let combinations = 0
for (const sidebarSimple of [false, true]) for (const wide of [false, true]) for (const budget of [false, true])
for (const hideTodayCost of [false, true]) for (const peakEnabled of [false, true]) for (const peakNotice of [false, true])
for (const peakStyle of ['compact', 'classic']) for (const go of [false, true]) {
  state.config = sanitizeConfig({ sidebarSimple, hideTodayCost, peakEnabled, peakNotice, peakStyle,
    balance: { display: 'sidebar', showProgressBar: true }, budget: { enabled: budget, amount: 10 }, goQuota: { enabled: go, display: 'sidebar' } })
  const tree = render(ui.SidebarFooter({ wide, useCost: pick => pick({ state }) }))
  const peakClasses = ['cm-peak-strip', 'cm-peak-classic', 'cm-peak-rail', 'cm-peak-rail-classic']
  const strips = nodes(tree).filter(n => peakClasses.some(cls => hasClass(n, cls)))
  const expected = !sidebarSimple && peakEnabled && peakNotice && (!wide || budget || !hideTodayCost) ? 1 : 0
  assert.equal(strips.length, expected, JSON.stringify({ sidebarSimple, wide, budget, hideTodayCost, peakEnabled, peakNotice, peakStyle, go }))
  if (expected) assert.ok(hasClass(strips[0], wide ? peakStyle === 'classic' ? 'cm-peak-classic' : 'cm-peak-strip' : peakStyle === 'classic' ? 'cm-peak-rail-classic' : 'cm-peak-rail'))
  const compact = nodes(tree).filter(n => hasClass(n, 'cm-compact-footer'))
  assert.equal(compact.length, sidebarSimple && wide ? 1 : 0, '简化模式只在宽栏占设置按钮右侧')
  if (compact.length) {
    assert.equal(nodes(compact[0]).filter(n => hasClass(n, 'cm-compact-ring')).length, 2)
    assert.equal(nodes(compact[0]).filter(n => hasClass(n, 'cm-compact-amount')).length, hideTodayCost ? 0 : 1)
    const rings = nodes(compact[0]).filter(n => hasClass(n, 'cm-compact-item'))
    assert.equal(rings.every(n => n.props.tabIndex === 0 && n.props['aria-label']), true)
    assert.equal(nodes(compact[0]).filter(n => hasClass(n, 'cm-compact-progress') && !hasClass(n, 'unavailable')).length, peakEnabled && peakNotice ? 1 : 0)
  }
  combinations++
}

for (const [period, label, used] of [['day', '今日', 1], ['month', '本月', 8], ['all', '累计', 9], ['custom', '自定义区间', 5]]) {
  state.config = sanitizeConfig({ locale: 'zh', sidebarSimple: true, budget: { enabled: true, amount: 10, period, customStart: '2026-09-01', customEnd: '2026-09-10' } })
  state.budgetUsed = used / 7.2
  const tree = render(ui.BudgetBoxContent({ state, wide: true, summary: true }))
  assert.match(text(tree), new RegExp(`今日 / ${label}预算`))
  assert.match(String(tree.props.label), new RegExp(`已用 ¥${used} / ¥10`))
}
let stopped = 0
const box = render(ui.BalanceBox({ state, wide: true }))
const link = nodes(box).find(n => n.type === 'a')
assert.equal(link.props.href, 'https://platform.deepseek.com/usage')
assert.equal(link.props.target, '_blank')
assert.ok(nodes(link).some(n => n.type === 'svg'), '充值链接使用矢量图标且保留无障碍名称')
assert.ok(link.props['aria-label'])
link.props.onClick({ stopPropagation: () => { stopped++ } })
link.props.onKeyDown({ stopPropagation: () => { stopped++ } })
assert.equal(stopped, 2, '充值链接不触发外层余额刷新')
console.log(`[ok] #122/#123：${combinations} 种组合的峰谷条唯一性、隐藏项、预算周期/合并口径及充值图标交互`)
