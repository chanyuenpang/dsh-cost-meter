import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Ledger, sanitizeConfig } from '../lib/store.js'
import { stateSchema } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'
import { apply } from '../lib/index.js'
import { queryCustomBalance } from '../lib/custom-balance.js'

// Exercise real HTTP serialization, the service/RPC boundary and disk persistence.
const received = []
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  received.push({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ data: { balance: 12.5 } }))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const url = `http://127.0.0.1:${server.address().port}/balance`
const row = { enabled: true, request: { url, method: 'POST', headers: {} }, extract: { remaining: 'data.balance' } }
const root = mkdtempSync(join(tmpdir(), 'cm-post-body-')), oldHome = process.env.DSH_HOME, cleanups = []
const raw = '{"account":"测试","id":9007199254740993,"filter":{"active":true}}'
let api
try {
  process.env.DSH_HOME = root
  apply({ on: () => () => {}, inject() {}, get: () => undefined,
    effect: fn => { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose) },
    provide: (name, service) => { if (name === 'costMeter') api = service }, logger: { info() {}, warn() {}, error() {} },
  })
  const original = sanitizeConfig({ customBalances: [row, { ...row, enabled: false, request: { ...row.request, body: { second: true } } }] }).customBalances
  await api.updateConfig({ locale: 'en', balance: { display: 'off' }, goQuota: { enabled: false }, customBalances: original })
  const codec = CLIENT_CONTRIBUTION.descriptors.find(d => d.method === 'getState').result.create()
  let state
  for (const body of [raw, { nested: [1, false, null] }, '[]', 'null', 'false', '0', '"a JSON string"', undefined]) {
    const entries = structuredClone(original)
    entries[0].request.body = body
    state = await api.updateConfig(JSON.parse(JSON.stringify({ customBalances: entries })))
    for (const decoded of [stateSchema.parse(state), codec.parse(JSON.parse(JSON.stringify(state)))]) {
      assert.equal(JSON.stringify(decoded.config.customBalances[0].request.body), JSON.stringify(body))
      assert.equal(JSON.stringify(decoded.config.customBalances[1].request.body), '{"second":true}')
    }
    const result = await api.refreshCustomBalance(0)
    assert.equal(result.ok, true)
    assert.equal(result.state.customBalances[0].remaining, 12.5)
    const sent = received.at(-1)
    assert.equal(sent.method, 'POST')
    assert.equal(sent.body, body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body))
    assert.equal(sent.headers['content-type'], body === undefined ? undefined : 'application/json')
  }
  for (const name of ['content-type', 'Content-Type', 'CONTENT-TYPE']) {
    await queryCustomBalance({ get: () => undefined }, { customBalance: { ...row, request: { ...row.request, body: raw, headers: { [name]: 'application/vnd.balance+json' } } } })
    assert.equal(received.at(-1).headers['content-type'], 'application/vnd.balance+json', 'HTTP header names are case-insensitive')
  }
  await queryCustomBalance({ get: () => undefined }, { customBalance: { ...row, request: { ...row.request, method: 'GET', body: raw } } })
  assert.equal(received.at(-1).body, '')
  assert.equal(received.at(-1).headers['content-type'], undefined)
  for (const dispose of cleanups.splice(0).reverse()) dispose()
  const disk = JSON.parse(readFileSync(join(root, 'storages', 'cost-meter', 'ledger.json'), 'utf8'))
  assert.equal(disk.config.customBalances[0].request.body, undefined, 'clearing a saved body survives disk serialization')
  assert.deepEqual(disk.config.customBalances[1].request.body, { second: true })
  const reopened = Ledger.open()
  assert.equal(reopened.config.customBalances[0].request.body, undefined)
  assert.deepEqual(reopened.config.customBalances[1].request.body, { second: true })
  reopened.close()
  const legacy = sanitizeConfig({ customBalance: { ...row, request: { ...row.request, body: raw } } })
  assert.equal(legacy.customBalances[0].request.body, raw, 'legacy configuration migration preserves the body')
} finally {
  for (const dispose of cleanups.reverse()) dispose()
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] #165: POST body, JSON text/types, real HTTP headers, GET omission, codecs, clearing and restart persistence')
