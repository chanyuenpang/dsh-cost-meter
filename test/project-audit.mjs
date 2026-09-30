import assert from 'node:assert/strict'
import vm from 'node:vm'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fetchWithRetry, readJsonBounded, looksLikeSecretHeaderValue } from '../lib/net.js'
import { queryCustomBalance } from '../lib/custom-balance.js'
import { cpaManagementFetch } from '../lib/gateway-quotas.js'
import { scnetTokenPlanWindows, SCNET_TOKEN_PLAN_PROVIDER_IDS, SCNET_CREDIT_RATES } from '../lib/coding-plans.js'
import { planProviderIdOf, billingClassOf } from '../lib/plan-billing.js'
import { stripSecrets, Ledger, sanitizeConfig } from '../lib/store.js'
import { apply, migrateCustomBalanceHeaderSecrets, runStartupImports } from '../lib/index.js'

// 响应体按实际流大小截断，即使未声明长度或谎报长度也不能无限读取。
let cancelled = false, chunks = 0
const oversized = () => new Response(new ReadableStream({
  pull(controller) { chunks++; controller.enqueue(new Uint8Array(65536)) },
  cancel() { cancelled = true },
}), { headers: { 'content-length': '1' } })
await assert.rejects(() => readJsonBounded(oversized()), e => e.code === 'RESPONSE_TOO_LARGE')
assert.equal(cancelled, true)
assert.ok(chunks <= 6, '超限即取消后续读取')
cancelled = false
await assert.rejects(() => cpaManagementFetch('https://example.test/v0/management/auth-files', 'synthetic-key', {}, { fetchImpl: async () => oversized() }), e => e.code === 'CPA_RESPONSE_INVALID')
assert.equal(cancelled, true, '网关也执行真正的流式上限')
await assert.rejects(() => readJsonBounded(new Response('{"secret":"synthetic-secret" BROKEN')), e => !e.message.includes('synthetic-secret'))
assert.deepEqual(await readJsonBounded(new Response('{"balance":12.5}')), { balance: 12.5 })
// 裸 gzip 正文(无 Content-Encoding/Content-Type)按 gzip 魔数解压后解析(issue #172):
// 对应个别 CDN 边缘返回的无编码头压缩响应;伪魔数正文仍报不回显正文的解析错误,
// 解压膨胀超出读取上限报 RESPONSE_TOO_LARGE,压缩体不能绕过 256KiB 约束。
assert.deepEqual(await readJsonBounded(new Response(gzipSync(Buffer.from('{"balance":12.5}')))), { balance: 12.5 })
await assert.rejects(() => readJsonBounded(new Response(Buffer.from([0x1f, 0x8b, 0x01, 0x02]))), e => e.message === 'response body is not valid JSON')
await assert.rejects(() => readJsonBounded(new Response(gzipSync(Buffer.from('{"d":"' + 'x'.repeat(300000) + '"}')))), e => e.code === 'RESPONSE_TOO_LARGE')

const originalFetch = globalThis.fetch
const config = { customBalance: { enabled: true, request: { url: 'https://example.test/balance' }, extract: { remaining: 'balance', maxBudget: 'cap', spend: 'spend' } } }
try {
  for (const value of ['', ' ', '\t', '0x10', 'Infinity', null, false]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ balance: value }))
    await assert.rejects(() => queryCustomBalance({ get() {} }, config), /missing or not numeric/)
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ balance: '12.5', cap: ' ', spend: '0x10' }))
  const valid = await queryCustomBalance({ get() {} }, config)
  assert.equal(valid.remaining, 12.5)
  assert.equal(valid.maxBudget, null)
  assert.equal(valid.spend, null)
  globalThis.fetch = async () => oversized()
  await assert.rejects(() => queryCustomBalance({ get() {} }, config), e => e.code === 'RESPONSE_TOO_LARGE')
  cancelled = false
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { status: 503 })
  await assert.rejects(() => queryCustomBalance({ get() {} }, config), /HTTP 503/)
  assert.equal(cancelled, true, 'HTTP 错误也及时释放未读取的响应体')
} finally { globalThis.fetch = originalFetch }

// 调用方取消与每次尝试的超时分离，取消不发新请求，也不等待完整退避。
const cancelledController = new AbortController()
const reason = new DOMException('synthetic caller timeout', 'TimeoutError')
cancelledController.abort(reason)
let attempts = 0
await assert.rejects(() => fetchWithRetry('https://example.test', { signal: cancelledController.signal }, { backoffMs: 0, fetchImpl: async () => { attempts++; throw reason } }), e => e === reason)
assert.equal(attempts, 0)
const duringBackoff = new AbortController()
attempts = 0
await assert.rejects(() => fetchWithRetry('https://example.test', { signal: duringBackoff.signal }, {
  backoffMs: 1000,
  fetchImpl: async () => {
    attempts++
    setTimeout(() => duringBackoff.abort(reason), 5)
    throw new TypeError('fetch failed')
  },
}), e => e === reason)
assert.equal(attempts, 1)

// 一个占位符不能掩盖同一请求头中的静态密钥。
const mixed = 'Bearer sk-synthetic-static-secret {{DYNAMIC_TOKEN}}'
assert.equal(looksLikeSecretHeaderValue('Authorization', mixed), true)
assert.equal(looksLikeSecretHeaderValue('Authorization', 'Bearer {{DYNAMIC_TOKEN}}'), false)
assert.equal(looksLikeSecretHeaderValue('Authorization', '{{USER}}:{{PASS}}'), false)
assert.equal(looksLikeSecretHeaderValue('Content-Type', 'application/{{TYPE}}'), false)
const mixedConfig = { customBalances: [{ request: { url: 'https://example.test', headers: { Authorization: mixed } } }] }
assert.equal(stripSecrets(mixedConfig).customBalances[0].request.headers.Authorization, '')
let credentialWrites = 0
const pendingLedger = { config: mixedConfig, scheduleWrite() {} }
const migration = await migrateCustomBalanceHeaderSecrets({ get: () => ({ describe: async () => ({ writable: true }), set: async () => { credentialWrites++ } }) }, pendingLedger)
assert.equal(credentialWrites, 0, '不把动态模板整体迁为一枚无法展开的嵌套凭据')
assert.equal(migration.pending.length, 1)
assert.equal(pendingLedger.config.customBalances[0].request.headers.Authorization, mixed, '运行期仍保留原模板')

// 前后端都识别明确的 SCNet 订阅别名，同名模型经其他渠道不消耗本地 SCNet Credits。
const dir = new URL('../src/client/', import.meta.url)
const source = readdirSync(dir).filter(n => n.endsWith('.js')).sort().map(n => readFileSync(new URL(n, dir), 'utf8')).join('')
let factory
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.test = { planProviderIdOfLocal, billingClassOfLocal }; exports.apply = apply'), {
  window: { __ModuleLoader__: { load: v => { factory = v.factory } }, localStorage: { getItem: () => null } }, navigator: { language: 'en' },
})
const client = factory(() => ({})).test
const cfg = sanitizeConfig({ codingPlans: { scnet: { enabled: true } } })
for (const provider of [...SCNET_TOKEN_PLAN_PROVIDER_IDS, 'LLM-SCNET-TOKEN-PLAN']) {
  assert.equal(planProviderIdOf(provider), 'scnet')
  assert.equal(client.planProviderIdOfLocal(provider), 'scnet')
  assert.equal(billingClassOf(provider, 'GLM-5.2', cfg.planBilling, new Set(['scnet'])), 'plan')
  assert.equal(client.billingClassOfLocal(provider, 'GLM-5.2', cfg), 'plan')
}
const now = Date.now(), d = new Date(now)
const day = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
assert.equal(scnetTokenPlanWindows({ [day]: { byProviderModel: { 'zai:GLM-5.2': { input: 1e6 } } } }, { planCredits: 60000 }, now).used, 0)

const root = mkdtempSync(join(tmpdir(), 'cm-audit-runtime-'))
const oldHome = process.env.DSH_HOME, cleanup = []
try {
  process.env.DSH_HOME = root
  let svc, stream
  apply({
    on: (name, fn) => { if (name === 'llm/stream') stream = fn; return () => {} },
    effect: fn => { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose) },
    inject() {}, provide: (name, value) => { if (name === 'costMeter') svc = value },
    get: key => key === 'settings' ? { get: () => ({}) } : undefined, logger: console,
  })
  await svc.updateConfig({ hideOfficialBalance: true, goQuota: { enabled: false }, codingPlans: { scnet: { enabled: true, planCredits: 60000 } }, planBilling: { models: { 'scnet-tokenplan:GLM-5.2': 'api' } } })
  for (const provider of ['zai', 'scnet', 'scnet-tokenplan', 'llm-scnet-token-plan']) {
    for await (const chunk of stream({ provider, model: 'GLM-5.2', sessionId: provider }, () => (async function* () { yield { type: 'usage', usage: { inputTokens: 1e6, outputTokens: 0 } } })())) assert.equal(chunk.type, 'usage')
  }
  const state = await svc.getState()
  const expected = 2 * SCNET_CREDIT_RATES['GLM-5.2'].input
  assert.equal(state.codingPlans.scnet.windows.credits.text, `${Math.round(expected).toLocaleString('en-US')} / 60,000 Credits (est.)`)
  assert.equal(state.today.calls, 4, '渠道过滤不丢原始调用记录')
  await svc.updateConfig({ planBilling: { providers: { scnet: 'api' }, models: {} } })
  assert.match((await svc.getState()).codingPlans.scnet.windows.credits.text, /^0 \/ 60,000/)

  const ledger = new Ledger(cfg, {}, join(root, 'migration-ledger.json'))
  ledger.account({ input: 1e6 }, 'GLM-5.2', 'prior', now, 'scnet-tokenplan')
  const oldDay = ledger.days[day]
  oldDay.apiCost = oldDay.cost
  for (const item of Object.values(oldDay.byProviderModel)) item.apiCost = item.cost
  for (const item of oldDay.sessions) item.apiCost = item.cost
  const beforeCost = oldDay.cost
  await runStartupImports(ledger, join(root, 'empty-sessions'))
  assert.ok(ledger.migrations.includes('scnet-provider-split-v1'))
  const first = JSON.stringify(ledger.days)
  await runStartupImports(ledger, join(root, 'empty-sessions'))
  assert.equal(JSON.stringify(ledger.days), first, 'SCNet 分类迁移幂等')
  assert.equal(ledger.days[day].cost, beforeCost, '迁移不改变原始等值金额')
  assert.equal(ledger.days[day].apiCost, 0, '新识别的订阅渠道不再计入历史 API 支出')
  ledger.close()
} finally {
  for (const dispose of cleanup.reverse()) await dispose()
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] 项目审查：严格余额、响应体限额、取消请求、混合凭据脱敏、SCNet 渠道隔离与分类迁移')
