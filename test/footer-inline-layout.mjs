// Optional browser regression: PLAYWRIGHT_MODULE may point at a locally installed Playwright index.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const source = readFileSync(new URL('../src/client/01-open-styles-i18n.js', import.meta.url), 'utf8')
let css = vm.runInNewContext(source.match(/const css = (\[[\s\S]*?\]\.join\('\\n'\))/)[1])
// Optionally validate the installed artifact itself, not only source rules.
if (process.env.FOOTER_CLIENT_BUNDLE) {
  let factory
  const styles = []
  const document = { querySelector: () => null, createElement: () => ({ dataset: {} }), head: { appendChild: node => styles.push(node.textContent) } }
  vm.runInNewContext(readFileSync(process.env.FOOTER_CLIENT_BUNDLE, 'utf8'), { document, navigator: { language: 'en' }, window: { __ModuleLoader__: { load: value => { factory = value.factory } } } })
  factory(name => name === 'react' ? { createElement() {}, Fragment: 'fragment' } : {})
  assert.equal(styles.length, 1, 'installed client injects one stylesheet')
  css = styles[0]
}
const hostStyles = process.env.FOOTER_HOST_STYLES ? JSON.parse(readFileSync(process.env.FOOTER_HOST_STYLES, 'utf8')) : null
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) })
let cases = 0
try {
  const page = await browser.newPage()
  // DSH 0.2.1 SlotOutlet inserts a real DOM anchor even though display:contents has no box.
  // Keep the unwrapped legacy case too: CSS child combinators must handle both DOM trees.
  for (const wrapped of [false, true]) for (const host of ['native', 'better-tasks']) {
    const foot = host === 'native' ? (hostStyles?.sidebarClasses.footArea ?? 'host_footArea') : 'dbt-foot'
    const settings = host === 'native' ? (hostStyles?.sidebarClasses.settingsArea ?? 'host_settingsArea') : 'dbt-settings'
    const actionsClass = host === 'native' ? (hostStyles?.sidebarClasses.footerActions ?? '') : 'dbt-footer-actions'
    for (const extra of [false, true]) for (const label of ['', '升级', '安装中 75%']) {
      const outlet = (name, content) => wrapped ? '<div data-slot="' + name + '" style="display:contents">' + content + '</div>' : content
      const actions = (extra ? '<div id="extra">Other footer action</div><div id="extra2">Another action</div>' : '') +
        '<div class="cm-compact-footer"><span class="cm-compact-item"><span class="cm-compact-ring"><svg viewBox="0 0 28 28"><circle class="cm-compact-track" cx="14" cy="14" r="11"/></svg><svg class="cm-compact-icon" viewBox="0 0 14 14"><rect width="14" height="14"/></svg></span></span><span class="cm-compact-item"><span class="cm-compact-ring"><svg viewBox="0 0 28 28"><circle class="cm-compact-track" cx="14" cy="14" r="11"/></svg><svg class="cm-compact-icon" viewBox="0 0 14 14"><rect width="14" height="14"/></svg></span></span><span class="cm-compact-amount">¥1234567.89</span></div>'
      const trigger = '<div class="host_triggerRow ' + (hostStyles?.settingsClasses.triggerRow ?? '') + '"><button class="settings ' + (hostStyles?.settingsClasses.trigger ?? '') + '">⚙<span class="' + (hostStyles?.settingsClasses.triggerLabel ?? '') + '">设置</span></button>' +
        (label ? '<button class="update ' + (hostStyles?.updateClasses.indicator ?? '') + '"><span class="' + (hostStyles?.updateClasses.icon ?? '') + '">↓</span><span>' + label + '</span></button>' : '') + '</div>'
      await page.setContent(
        '<style>body{margin:0;font:14px Arial}.foot{display:flex;flex-direction:column;width:240px}.actions{display:flex}.settings-area{flex:none}.host_triggerRow{display:flex;align-items:center;gap:8px;width:calc(100% + 4px);margin:4px -2px}.settings{display:flex;align-items:center;flex:1;min-width:0;overflow:hidden;gap:8px;border:0;padding:0 8px;height:42px}.settings span{white-space:nowrap;overflow:hidden}.update{flex:none;height:28px;border:0}' + (hostStyles ? hostStyles.sidebarCSS + hostStyles.settingsCSS + hostStyles.betterTasksCSS : '') + css + '</style>' +
        '<div class="foot ' + foot + '"><div class="actions ' + actionsClass + '">' + outlet('sidebar.footer.action', actions) +
        '</div><div class="settings-area ' + settings + '">' + outlet('sidebar.settings', trigger) + '</div></div>')
      for (const width of [220, 240, 260, 280, 320]) {
        await page.locator('.foot').evaluate((element, value) => { element.style.width = value + 'px' }, width)
        const rects = await page.evaluate(() => {
          const rect = selector => { const element = document.querySelector(selector); if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } }
          return { foot: rect('.foot'), settings: rect('.settings-area'), update: rect('.update'), cost: rect('.cm-compact-footer'), extra: rect('#extra'), extra2: rect('#extra2'), lastRing: rect('.cm-compact-item:nth-child(2) .cm-compact-ring'), lastIcon: rect('.cm-compact-item:nth-child(2) .cm-compact-icon') }
        })
        const context = JSON.stringify({ wrapped, host, extra, label, width, rects })
        assert.ok(Math.abs(rects.settings.y + rects.settings.height / 2 - rects.cost.y - rects.cost.height / 2) < 1, 'same row: ' + context)
        assert.ok(rects.settings.right <= rects.cost.x && (!rects.update || rects.update.right <= rects.cost.x), 'official controls before cost: ' + context)
        assert.ok(rects.cost.right <= rects.foot.right + 1, 'cost stays inside footer: ' + context)
        assert.ok(rects.cost.height <= rects.settings.height, 'no extra footer row: ' + context)
        assert.ok(rects.lastRing.right <= rects.cost.right + 1 && rects.lastIcon.right <= rects.cost.right + 1, 'rings remain inside shrinking cost column: ' + context)
        if (extra) {
          assert.ok(rects.extra.bottom <= rects.extra2.y, 'other actions do not overlap: ' + context)
          assert.ok(rects.extra2.bottom <= rects.settings.y, 'other actions remain above: ' + context)
        }
        cases++
      }
    }
  }
  console.log('[ok] inline footer browser geometry: ' + cases + ' cases (slot anchors + legacy, native/replacement, update/install, extra actions, 220–320px); CSS=' + (process.env.FOOTER_CLIENT_BUNDLE ? 'installed bundle' : 'source') + '; host=' + (hostStyles ? 'shipped styles' : 'minimal fixture'))
} finally { await browser.close() }
