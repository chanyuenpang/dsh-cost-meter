import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { gzipSync } from 'node:zlib'
import { queryCodingPlan, CODING_PLAN_ENDPOINTS } from '../lib/coding-plans.js'

const originalFetch = globalThis.fetch
const urls = CODING_PLAN_ENDPOINTS.zai
const key = 'synthetic-private-key-174'
const translate = (_locale, code) => code
const usage = { code: 200, data: { limits: [
  { type: 'TOKENS_LIMIT', unit: 3, percentage: 19 },
  { type: 'TOKENS_LIMIT', unit: 6, percentage: 81 },
] } }
const events = []
const options = { onAttempt: attempt => events.push(attempt) }
const query = opts => queryCodingPlan('zai', key, 'en', translate, opts ?? options)
let calls = []
const use = fn => {
  calls = []; events.length = 0
  globalThis.fetch = async (url, init) => {
    calls.push(url)
    assert.equal(init.headers.authorization, `Bearer ${key}`)
    assert.equal(init.redirect, 'manual')
    return fn(url, init)
  }
}
try {
  // Actual Node fetch + HTTP stream: no Content-Encoding header on gzip bytes.
  const server = createServer((_req, res) => res.end(gzipSync(JSON.stringify(usage))))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    use((_url, init) => originalFetch(`http://127.0.0.1:${server.address().port}`, init))
    const result = await query()
    assert.equal(result.endpoint, urls[0])
    assert.equal(result.windows.fiveHour.percent, 19)
    assert.equal(result.windows.weekly.percent, 81)
    assert.deepEqual(calls, [urls[0]])
    assert.equal(events[0].code, 'OK')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }

  // A malformed monitor response used to be silently converted to null, then
  // replaced by a legacy endpoint's HTTP 404. Preserve every candidate instead.
  use(url => url === urls[0] ? new Response(`SECRET_BODY ${key}`) : new Response('', { status: 404 }))
  await assert.rejects(query(), error => {
    assert.equal(error.code, 'QUOTA_CANDIDATES_FAILED')
    assert.equal(error.attempts.length, 6)
    assert.equal(error.attempts[0].code, 'INVALID_JSON')
    assert.match(error.message, /HTTP 200 \/ INVALID_JSON/)
    assert.match(error.message, /HTTP 404/)
    assert.equal(JSON.stringify(error).includes(key) || error.message.includes(key), false)
    assert.equal(error.soft, false)
    return true
  })
  assert.equal(events.length, 6)

  use(url => {
    if (url === urls[0]) throw Object.assign(new TypeError(`SECRET_ERROR ${key}`), { cause: { code: 'ECONNRESET' } })
    return new Response('', { status: 404 })
  })
  await assert.rejects(query(), error => {
    assert.equal(error.attempts[0].code, 'ECONNRESET')
    assert.equal(error.message.includes('SECRET_ERROR') || error.message.includes(key), false)
    return true
  })
  assert.equal(calls.filter(url => url === urls[0]).length, 2, 'Transient errors retry the original candidate')

  use(url => url === urls[1] ? new Response(JSON.stringify(usage)) : new Response('', { status: 401 }))
  assert.equal((await query()).endpoint, urls[1], 'Domestic credentials failure can fall back to the international endpoint')
  assert.deepEqual(events.map(e => e.code), ['UNAUTHORIZED', 'OK'])

  let released = 0
  use(url => new Response(new ReadableStream({ cancel() { released++ } }), { status: urls.indexOf(url) < 2 ? 401 : 404 }))
  await assert.rejects(query(), error => error.soft === true)
  assert.equal(released, 6, 'Unconsumed HTTP error bodies release their connections')

  use(url => url === urls[0] ? new Response(gzipSync('x'.repeat(300000))) : new Response('', { status: 404 }))
  await assert.rejects(query(), error => error.attempts[0].code === 'RESPONSE_TOO_LARGE')

  use(url => url === urls[0] ? new Response(JSON.stringify({ code: 1001, msg: key })) : new Response('', { status: 404 }))
  await assert.rejects(query(), error => error.attempts[0].stage === 'usage' && !error.message.includes(key))

  use(() => new Response(null, { status: 302, headers: { location: `https://example.test/${key}` } }))
  await assert.rejects(query(), error => error.attempts.every(e => e.status === 302) && !error.message.includes(key))
  assert.equal(calls.length, 6, 'Redirects cannot silently move quota credentials to another endpoint')

  const controller = new AbortController(), reason = new Error('cancel fixture')
  use((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    controller.abort(reason)
  }))
  await assert.rejects(query({ signal: controller.signal }), error => error === reason)
  assert.equal(calls.length, 1, 'Cancellation stops retries and fallback')
} finally { globalThis.fetch = originalFetch }
console.log('[ok] GLM: real HTTP bare gzip, bounded reads, per-candidate diagnostics, fallback, cancellation and redaction')
