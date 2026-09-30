import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { OPENROUTER_MODELS_URL, parseOpenRouterModels, providerPriceEntryFor } from '../lib/pricing.js'
import { createOpenRouterPriceRefresh, repairOpenRouterLedger } from '../lib/openrouter-pricing.js'
import { apply } from '../lib/index.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'

const row = (id, prompt = '0.000002', completion = '0.000003') => ({ id, pricing: { prompt, completion } })
const response = data => Response.json({ data })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const badRows = [' ', '', '0x10', '-1', 'NaN', 'Infinity', '1e308', null, true].map((value, i) => row(`bad/${i}`, value))
const parsed = parseOpenRouterModels({ data: [...badRows, row('tiny/rate', '1e-13'), row('vendor/free', 0, 0)] }).models
assert.deepEqual(Object.keys(parsed).sort(), ['tiny/rate', 'vendor/free'])
assert.equal(parsed['tiny/rate'].input, 1e-7, 'tiny positive price must not become free')
for (const data of [[], badRows]) assert.throws(() => parseOpenRouterModels({ data }), { code: 'ERR_NO_MODELS' })
const root = mkdtempSync(join(tmpdir(), 'cm-openrouter-'))
const oldHome = process.env.DSH_HOME, originalFetch = globalThis.fetch
const nativeTimers = { setTimeout, clearTimeout, setInterval, clearInterval }, lifecycleTimers = new Map()
const ledgers = [], controllers = [], cleanups = []
const makeLedger = (path = join(root, 'ledger.json')) => {
  const ledger = new Ledger(sanitizeConfig({ hideOfficialBalance: true, legacyAutoImportedAt: 1, goQuota: { enabled: false } }), {}, path)
  ledgers.push(ledger)
  return ledger
}
const controllerFor = (ledger, options) => { const controller = createOpenRouterPriceRefresh(ledger, options); controllers.push(controller); return controller }
try {
  const ledgerPath = join(root, 'storages', 'cost-meter', 'ledger.json')
  const ledger = makeLedger(ledgerPath)
  const key = 'openrouter:meta/muse-spark-1.3-contributor', liveKey = 'openrouter:vendor/live'
  const bucket = cost => ({ input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost, apiCost: cost, calls: 1 })
  const buckets = { [key]: bucket(0), [liveKey]: bucket(0), 'openrouter:qwen/qwen3.8-flash': bucket(7),
    'custom/model:example': bucket(11), 'openrouter:vendor/mapped': bucket(0) }
  ledger.config.priceOverrides['openrouter:vendor/mapped'] = 'openrouter:meta/muse-spark-1.3-contributor'
  ledger.config.prices.providers['custom/model'] = { models: { example: { input: 100, output: 100 } } }
  ledger.days['2026-09-17'] = { cost: 18, apiCost: 18, byProviderModel: structuredClone(buckets),
    sessions: [{ id: 'session', cost: 18, apiCost: 18, byProviderModel: structuredClone(buckets) }] }
  const untouched = ['openrouter:qwen/qwen3.8-flash', 'custom/model:example', 'openrouter:vendor/mapped']
  assert.equal(repairOpenRouterLedger(ledger).recostedBuckets, 2)
  assert.equal(ledger.days['2026-09-17'].byProviderModel[key].cost, 0.1)
  for (const id of untouched) {
    assert.deepEqual(ledger.days['2026-09-17'].byProviderModel[id], buckets[id])
    assert.deepEqual(ledger.days['2026-09-17'].sessions[0].byProviderModel[id], buckets[id])
  }
  assert.equal(ledger.days['2026-09-17'].cost, 18.1)
  assert.equal(repairOpenRouterLedger(ledger).recostedBuckets, 0)
  assert.ok(!ledger.migrations.includes('pricing-openrouter-v1'), 'offline snapshot leaves catalog migration pending')

  let calls = 0, hold = null, mode = 'ok', price = '0.000002', signal
  const controller = controllerFor(ledger, { fetchImpl: async (url, init) => {
    assert.equal(url, OPENROUTER_MODELS_URL); assert.equal(init.redirect, 'error')
    assert.equal(init.headers.authorization, undefined, 'public directory needs no credential')
    calls++; signal = init.signal
    if (hold) await hold.promise
    if (mode === 'http') return new Response('', { status: 503 })
    if (mode === 'large') return new Response(' '.repeat(4 * 1024 * 1024 + 1))
    if (mode === 'bad') return new Response('{ broken')
    if (mode === 'empty') return response([row('openrouter/auto', '-1', '-1')])
    return response([row('vendor/live', price), row('vendor/edited', price), row('vendor/free:free', '0', '0')])
  } })
  ledger.config.prices.providers.openrouter.models['vendor/edited'] = { input: 42, output: 42, billingMode: 'flat' }
  hold = deferred()
  const first = controller.refresh(), same = controller.refresh()
  assert.equal(first, same, 'startup/hourly/manual calls share one request')
  ledger.config.locale = 'en'
  hold.resolve(); hold = null
  assert.equal((await first).count, 2, 'custom price is skipped')
  assert.equal(calls, 1)
  assert.equal(ledger.config.locale, 'en', 'concurrent settings preserved')
  assert.equal(ledger.config.prices.providers.openrouter.models['vendor/edited'].input, 42)
  assert.equal(ledger.days['2026-09-17'].byProviderModel[liveKey].cost, 2, 'first online refresh repairs non-snapshot models')
  assert.ok(ledger.migrations.includes('pricing-openrouter-v1'))
  const history = structuredClone(ledger.days)
  price = '0.000004'; await controller.refresh()
  assert.equal(ledger.config.prices.providers.openrouter.models['vendor/live'].cacheMiss, 4)
  assert.deepEqual(ledger.days, history, 'later catalog price changes do not reprice history')
  const prices = structuredClone(ledger.config.prices), hashes = structuredClone(ledger.openrouterPriceHashes)
  for (mode of ['http', 'large', 'bad', 'empty']) {
    await assert.rejects(controller.refresh())
    assert.deepEqual(ledger.config.prices, prices)
    assert.deepEqual(ledger.openrouterPriceHashes, hashes)
  }
  mode = 'ok'
  ledger.config.prices.providers.openrouter.models['vendor/live'].cacheMiss = 99
  price = '0.000005'; await controller.refresh()
  assert.equal(ledger.config.prices.providers.openrouter.models['vendor/live'].cacheMiss, 99)
  ledger.close(); process.env.DSH_HOME = root
  const reopened = Ledger.open(); ledgers.push(reopened)
  assert.deepEqual(reopened.openrouterPriceHashes, ledger.openrouterPriceHashes)
  const restarted = controllerFor(reopened, { fetchImpl: async () => response([row('vendor/live', '0.000006')]) })
  await restarted.refresh()
  assert.equal(reopened.config.prices.providers.openrouter.models['vendor/live'].cacheMiss, 99, 'manual edit survives restart and automatic refresh')
  assert.equal(providerPriceEntryFor('openrouter', 'vendor/free', reopened.config.prices).priced, false, 'paid model cannot match :free variant')
  assert.equal(providerPriceEntryFor('openrouter', 'openrouter/auto', reopened.config.prices).priced, false)
  assert.equal(providerPriceEntryFor('openrouter', 'vendor/free:free', reopened.config.prices).entry.cacheMiss, 0)
  assert.equal(providerPriceEntryFor('llm-openrouter', 'vendor/live', reopened.config.prices).entry.cacheMiss, 99)
  assert.equal(providerPriceEntryFor('other-router', 'vendor/live', reopened.config.prices).priced, false, 'OpenRouter catalog must not change other channels through fuzzy fallback')
  assert.equal(providerPriceEntryFor('other-router', 'alias', reopened.config.prices, { overrides: { 'other-router:alias': 'openrouter:vendor/live' } }).entry.cacheMiss, 99, 'explicit cross-provider mapping still works')

  const lateLedger = makeLedger(join(root, 'late.json')), waiting = deferred()
  let lateSignal
  const late = controllerFor(lateLedger, { fetchImpl: async (_, init) => { lateSignal = init.signal; await waiting.promise; return response([row('vendor/late')]) } })
  const lateResult = late.refresh(), before = JSON.stringify(lateLedger.config)
  late.dispose(); waiting.resolve()
  await assert.rejects(lateResult, /disposed/)
  assert.equal(lateSignal.aborted, true)
  assert.equal(JSON.stringify(lateLedger.config), before)
  assert.equal(lateLedger.pendingWrite, false, 'unload prevents writes even when transport ignores cancellation')
  await assert.rejects(late.refresh(), /disposed/)
  const timed = controllerFor(makeLedger(join(root, 'timed.json')), { timeoutMs: 20,
    fetchImpl: async (_, init) => new Response(new ReadableStream({ start(stream) {
      init.signal.addEventListener('abort', () => stream.error(init.signal.reason), { once: true })
    } })) })
  const keepAlive = setTimeout(() => {}, 1000)
  try { await assert.rejects(timed.refresh(), /timed out/) } finally { clearTimeout(keepAlive) }

  // Exercise actual service paths: DeepSeek success/failure independent of OpenRouter,
  // failed official sync still returns the successful OpenRouter state to the client.
  process.env.DSH_HOME = join(root, 'service'); mkdirSync(process.env.DSH_HOME)
  let api, officialOk = true, directoryOk = true, directoryCalls = 0
  const html = '<table><tr><th>MODEL</th><th>deepseek-v4-flash</th></tr>'
    + [['CACHE HIT', '0.007', '0.014'], ['CACHE MISS', '0.22', '0.44'], ['OUTPUT TOKENS', '0.66', '1.32']]
      .map(([name, off, high]) => `<tr><td>${name}</td><td>OFF-PEAK</td><td>$${off}</td></tr><tr><td>${name}</td><td>PEAK</td><td>$${high}</td></tr>`).join('') + '</table><!--' + 'fixture '.repeat(80) + '-->'
  globalThis.fetch = async url => {
    if (String(url) === OPENROUTER_MODELS_URL) { directoryCalls++; return directoryOk ? response([row('vendor/service')]) : new Response('', { status: 503 }) }
    if (String(url).includes('api-docs.deepseek.com')) return officialOk ? new Response(html) : new Response('', { status: 503 })
    throw new Error('unexpected test request: ' + url)
  }
  for (const [set, clear, delay] of [['setTimeout', 'clearTimeout', 3000], ['setInterval', 'clearInterval', 3600_000]]) {
    globalThis[set] = (fn, ms, ...args) => {
      if (ms !== delay) return nativeTimers[set](fn, ms, ...args)
      const handle = { fn, unref() {}, cleared: false }
      lifecycleTimers.set(delay, handle)
      return handle
    }
    globalThis[clear] = handle => {
      if (handle === lifecycleTimers.get(delay)) handle.cleared = true
      else nativeTimers[clear](handle)
    }
  }
  apply({ on: () => () => {}, inject() {}, get: () => undefined,
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    provide: (_, service) => { api = service },
  })
  await api.updateConfig({ locale: 'en', hideOfficialBalance: true, goQuota: { enabled: false } })
  for (const options of [[true, true], [false, true], [true, false], [false, false]]) {
    ;[officialOk, directoryOk] = options
    const beforeCalls = directoryCalls, result = await api.fetchPrices()
    assert.equal(result.ok, officialOk, result.message)
    assert.equal(directoryCalls, beforeCalls + 1, 'each sync attempts the directory once')
    assert.match(result.message, directoryOk ? /OpenRouter model prices refreshed/ : /OpenRouter price refresh failed/)
    const wire = JSON.parse(JSON.stringify(result.state))
    stateSchema.parse(wire)
    CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create().parse(wire)
    assert.equal(wire.config.prices.providers.openrouter.models['vendor/service'].cacheMiss, 2)
    assert.equal(wire.openrouterPriceHashes, undefined, 'private refresh bookkeeping stays off the RPC schema')
  }
  directoryOk = true
  let beforeTimer = directoryCalls
  await lifecycleTimers.get(3000).fn()
  assert.equal(directoryCalls, beforeTimer + 1, 'startup refresh reaches the public directory')
  beforeTimer = directoryCalls
  lifecycleTimers.get(3600_000).fn()
  for (let n = 0; n < 20; n++) await Promise.resolve()
  assert.equal(directoryCalls, beforeTimer + 1, 'hourly timer refreshes the directory')
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  assert.ok([...lifecycleTimers.values()].every(timer => timer.cleared))
  lifecycleTimers.get(3600_000).fn()
  assert.equal(directoryCalls, beforeTimer + 1, 'disposed timer cannot issue another request')
} finally {
  for (const cleanup of cleanups.reverse()) cleanup()
  Object.assign(globalThis, nativeTimers)
  for (const controller of controllers) controller.dispose()
  for (const ledger of ledgers) ledger.close()
  globalThis.fetch = originalFetch
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  assert.equal(dirname(root), tmpdir())
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] #156 OpenRouter: scoped repair, custom-price persistence, exact variants, refresh concurrency/failures/cleanup, live service and shipped codecs')
