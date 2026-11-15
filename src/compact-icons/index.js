/** Personal compact footer; pricing and quota reads remain owned by upstream. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.compact-icons.js',
  factory: require => {
    const React = require('react')
    const { createElement: el } = React
    const css = 'COMPACT_ICONS_STYLE_SOURCE'
    // Codex glyph: Lobe Icons (MIT), https://github.com/lobehub/lobe-icons.
    // It identifies Codex, not an OpenAI endorsement.
    const CODEX_PATH = 'M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z'

    function mount(helpers) {
      const { Tooltip, makeT, resolveLocale, displayCostOf, formatMoneyUsd, peakView, usePeakClock,
        phaseLabelKeys, countdownText, codexQuotaSnapshot, fetchCodexQuota, useClickRefresh, clickableRefreshProps, clickRefreshTipLines } = helpers
      let style = document.getElementById('dsh-cost-meter-compact-icons')
      if (!style) { style = document.createElement('style'); style.id = 'dsh-cost-meter-compact-icons'; document.head.appendChild(style) }
      style.textContent = css

      function Ring({ kind, percent, detail, phase = '', refresh }) {
        const value = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null
        const circumference = 2 * Math.PI * 10
        const icon = kind === 'codex'
          ? el('svg', { className: 'cm-compact-icon', viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true },
            el('path', { fillRule: 'evenodd', clipRule: 'evenodd', d: CODEX_PATH }))
          : kind === 'claude'
            ? el('svg', { className: 'cm-compact-icon cm-compact-icon-claude', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', 'aria-hidden': true },
              el('path', { d: 'M12 3.4v17.2M4.6 7.7l14.8 8.6M19.4 7.7L4.6 16.3' }))
            : el('img', { className: 'cm-compact-icon', src: '/favicon.svg', alt: '', 'aria-hidden': true })
        return el(Tooltip, { portal: true, label: detail, side: 'top', delayMs: 250 },
          el('span', { className: 'cm-compact-item' + (refresh ? ' clickable' + (refresh.busy ? ' busy' : '') : ''),
            'data-cm-display': kind === 'codex' ? 'codex' : kind === 'dsh' ? 'peak' : 'today',
            ...(refresh ? clickableRefreshProps(refresh.busy, refresh.run) : { tabIndex: 0, role: 'img' }), 'aria-label': detail },
          el('span', { className: 'cm-compact-ring' },
            el('svg', { viewBox: '0 0 28 28', 'aria-hidden': true },
              el('circle', { className: 'cm-compact-track', cx: 14, cy: 14, r: 10 }),
              el('circle', { className: 'cm-compact-progress ' + phase + (kind === 'claude' ? ' claude' : '') + (value === null ? ' unavailable' : ''), cx: 14, cy: 14, r: 10,
                strokeDasharray: `${circumference * (value ?? 0) / 100} ${circumference}` })), icon)))
      }

      function claudeTodayOf(today, config) {
        let amount = 0, calls = 0, knownCalls = true, used = false
        for (const [key, bucket] of Object.entries(today?.byProviderModel ?? {})) {
          if (!bucket || typeof bucket !== 'object') continue
          if (!key.slice(key.indexOf(':') + 1).toLowerCase().includes('claude')) continue
          // Convert each bucket through upstream frozen-FX semantics before summing.
          amount += displayCostOf(bucket, config)
          used ||= bucket.cost > 0 || bucket.apiCost > 0 || bucket.calls > 0
          if (Number.isFinite(bucket.calls)) calls += bucket.calls
          else knownCalls = false
        }
        return used ? { amount, calls: knownCalls ? calls : null } : null
      }

      return function CompactFooter({ state, preview = false }) {
        const config = state.config
        const t = makeT(resolveLocale(config))
        const english = resolveLocale(config) === 'en'
        const now = usePeakClock(config, preview ? Date.now() : undefined)
        const source = config.codexQuotaSource ?? 'auto'
        const codexOn = config.codexQuotaEnabled === true && config.codexQuotaSidebar !== false
        const refresh = useClickRefresh(!preview && codexOn ? () => fetchCodexQuota(true, true, source) : null)
        // SidebarFooter already subscribes to the upstream cache; do not add polling.
        const codex = preview && state.displayPreviewCodex ? state.displayPreviewCodex : codexQuotaSnapshot()
        const weekly = codex.source === source && codex.status === 'ok' && now - codex.fetchedAt < 10 * 60000 ? codex.windows.weekly : null
        const remaining = Number.isFinite(weekly?.percent) ? 100 - weekly.percent : null
        const codexDetail = [remaining === null ? `${t('codexQuotaTitle')} · ${codex.message || t('codexQuotaUnavailable')}` :
          `${t('codexQuotaTitle')} · ${english ? 'remaining' : '剩余'} ${Math.round(remaining * 10) / 10}% · ${weekly.resetsAt ? new Date(weekly.resetsAt).toLocaleString() : '—'}`,
          ...(!preview && codexOn ? clickRefreshTipLines(t, refresh) : [])].join(' · ')
        const view = peakView(config, now)
        const phaseRemaining = view ? Math.max(0, Math.min(100, (view.nextAtMs - now) / (8 * 3600000) * 100)) : null
        const peakDetail = view ? `${t(phaseLabelKeys(view).notice)} · ${view.nextIntoPeak ? t('nextPeakIn', { time: countdownText(view, now, t) }) : t('nextOffPeakIn', { time: countdownText(view, now, t) })} · ${new Date(view.nextAtMs).toLocaleString()}` : ''
        const showToday = config.sidebar !== false && config.hideTodayCost !== true
        const today = displayCostOf(state.today, config)
        const amount = formatMoneyUsd(today, config)
        const claude = showToday ? claudeTodayOf(state.today, config) : null
        const claudeCost = claude?.amount ?? 0
        const share = today > 0 && claudeCost > 0 ? Math.min(100, claudeCost / today * 100) : 0
        const claudeDetail = claude ? english
          ? `Claude today ${formatMoneyUsd(claudeCost, config)}${claude.calls === null ? '' : ` · ${claude.calls} calls`} · ${share.toFixed(1)}% of today`
          : `Claude 今日 ${formatMoneyUsd(claudeCost, config)}${claude.calls === null ? '' : ` · ${claude.calls} 次调用`} · 占今日 ${share.toFixed(1)}%` : ''
        if (!codexOn && !view && !showToday) return null
        return el('div', { className: 'cm-compact-footer' },
          el('div', { className: 'cm-compact-rings' },
            codexOn ? el(Ring, { kind: 'codex', percent: remaining, detail: codexDetail, refresh: preview ? null : refresh }) : null,
            view ? el(Ring, { kind: 'dsh', percent: phaseRemaining, phase: view.weekend || view.holiday ? 'weekend' : view.inPeak ? 'peak' : '', detail: peakDetail }) : null,
            claude ? el(Ring, { kind: 'claude', percent: share, detail: claudeDetail }) : null),
          showToday ? el(Tooltip, { portal: true, label: `${t('todayCostTitle')} · ${amount}`, side: 'top', delayMs: 250 },
            el('span', { className: 'cm-compact-amount', 'data-cm-display': 'today', tabIndex: 0, 'aria-label': `${t('todayCostTitle')} ${amount}` }, amount)) : null)
      }
    }
    return { mount }
  },
})
