import { expect, test } from 'claude-code/testing'
import type { CacheView, View, WindowView } from './data'
import { BAND_CELL_PX, BAND_H, PANE_CELL_PX, altText, bandSvg, esc, palette, paneSvg } from './art'
import type { ArtTheme, Palette } from './art'

const M = 60_000
const H = 60 * M
const D = 24 * H
const VER = { tested: '2.1.316', actual: null }

const win = (label: '5h' | '7d', percentLeft: number, resetsInMs: number | null, extra: Partial<WindowView> = {}): WindowView =>
  ({ label, state: 'ok', percentLeft, exceeded: false, resetsInMs, resetting: false, ageMs: 0, ...extra }) as WindowView
const hot = (leftMs: number): CacheView => ({ state: 'hot', leftMs })
const base = (o: Partial<View> = {}): View => ({
  fiveHour: win('5h', 72, 2 * H + 14 * M),
  sevenDay: win('7d', 40, 3 * D + 4 * H),
  cache: hot(52 * M + 10_000),
  ttl: '1h',
  ...o,
})

// Every state the art draws.
const STATES: Record<string, View> = {
  ok: base(),
  none: base({ fiveHour: { label: '5h', state: 'none' }, sevenDay: { label: '7d', state: 'none' } }),
  na: base({ fiveHour: { label: '5h', state: 'na' }, sevenDay: { label: '7d', state: 'na' } }),
  stale: base({ fiveHour: win('5h', 88, 3 * H, { state: 'stale', ageMs: 12 * M }) }),
  rolled: base({ sevenDay: win('7d', 30, null, { state: 'rolled', ageMs: 12 * M }) }),
  exceeded: base({ sevenDay: win('7d', 0, 26 * H, { exceeded: true }) }),
  low: base({ fiveHour: win('5h', 12, 41 * M) }),
  hotUnder10: base({ cache: hot(9 * M + 30_000) }),
  cold: base({ cache: { state: 'cold', reason: 'compacted' } }),
  resetting: base({ fiveHour: win('5h', 99, null, { resetting: true }) }),
}

/** Text content of the drawing, entities decoded. */
const words = (svg: string): string =>
  [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(m => m[1]!).join(' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/** A small XML well-formedness check: balanced tags, quoted attributes, no raw & or <. */
function wellFormed(svg: string): boolean {
  if (!svg.startsWith('<svg ') || !svg.endsWith('</svg>')) return false
  const stack: string[] = []
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g
  let at = 0
  for (let m = re.exec(svg); m; m = re.exec(svg)) {
    const between = svg.slice(at, m.index)
    if (/[<>]/.test(between) || /&(?!(amp|lt|gt|quot|#39);)/.test(between)) return false
    at = m.index + m[0].length
    const [, close, name, , self] = m
    if (close) {
      if (stack.pop() !== name) return false
    } else if (!self) stack.push(name!)
  }
  return at === svg.length && stack.length === 0
}

const THEMES: ArtTheme[] = ['christmas', 'classic']

test('every state, theme, scheme and width draws well-formed SVG under 20 KB', () => {
  for (const theme of THEMES) for (const dark of [true, false]) for (const [k, v] of Object.entries(STATES)) {
    for (const cols of [12, 24, 40, 64, 99, 140]) {
      for (const a of [bandSvg(v, cols, theme, dark), paneSvg(v, cols, theme, dark, VER)]) {
        if (!wellFormed(a.source)) throw new Error(`malformed: ${theme} ${dark} ${k} ${cols}`)
        expect(a.source.length < 20_000).toBe(true)
        expect(a.source.length <= 131_072).toBe(true)
      }
    }
  }
})

test('width follows the measured cell sizes; the band is about two rows tall', () => {
  // Measured on the desktop app: band about 750 px at 99 columns, pane about 320 px at 64.
  expect(bandSvg(base(), 99, 'christmas', true).width).toBe(742)
  expect(paneSvg(base(), 64, 'christmas', true, VER).width).toBe(320)
  for (const cols of [24, 64, 99]) {
    const bw = Math.max(60, Math.floor(cols * BAND_CELL_PX))
    const b = bandSvg(base(), cols, 'christmas', true)
    expect(b.width).toBe(bw)
    expect(b.height).toBe(BAND_H)
    expect(b.source).toContain(`width="${bw}" height="${BAND_H}" viewBox="0 0 ${bw} ${BAND_H}"`)
    const pw = Math.max(120, Math.floor(cols * PANE_CELL_PX))
    const p = paneSvg(base(), cols, 'christmas', true, VER)
    expect(p.width).toBe(pw)
    expect(p.source).toContain(`viewBox="0 0 ${pw} ${p.height}"`)
  }
})

test('every state renders its label in the band and the pane', () => {
  const want: Record<string, string[]> = {
    ok: ['72%', '2h 14m', '40%', 'hot 52m'],
    none: ['--'],
    na: ['Limits n/a'],
    stale: ['88%', 'as of 12m'],
    rolled: ['reset'],
    exceeded: ['0%'],
    low: ['12%'],
    hotUnder10: ['hot 9m'],
    cold: ['cold'],
    resetting: ['99%'],
  }
  for (const theme of THEMES) for (const [k, v] of Object.entries(STATES)) {
    const band = words(bandSvg(v, 99, theme, true).source)
    const pane = words(paneSvg(v, 64, theme, true, VER).source)
    for (const w of want[k]!) {
      if (!band.includes(w) && !(k === 'na' && w === 'Limits n/a')) throw new Error(`band ${theme} ${k} lacks ${w}: ${band}`)
      if (k !== 'na' && !pane.includes(w)) throw new Error(`pane ${theme} ${k} lacks ${w}: ${pane}`)
    }
  }
  // The pane spells the details out.
  const pane = (v: View) => words(paneSvg(v, 64, 'christmas', true, VER).source)
  expect(pane(STATES.na!)).toContain('LIMITS')
  expect(pane(STATES.na!)).toContain('n/a')
  expect(pane(STATES.exceeded!)).toContain('left')
  expect(pane(STATES.exceeded!)).toContain('limit reached')
  expect(pane(STATES.cold!)).toContain('compacted')
  expect(pane(STATES.ok!)).toContain('resets in 2h 14m')
  expect(pane(STATES.resetting!)).toContain('resetting now')
  expect(pane(STATES.ok!)).toContain('tested on 2.1.316')
  expect(words(paneSvg(base(), 64, 'christmas', true, { tested: '2.1.316', actual: '2.1.400' }).source)).toContain('untested engine 2.1.400')
})

test('the art shows whole minutes only, so it changes at most once a minute', () => {
  const a = (ms: number) => words(bandSvg(base({ cache: hot(ms) }), 99, 'christmas', true).source)
  expect(a(9 * M + 59_000)).toContain('hot 9m')
  expect(a(9 * M + 1_000)).toContain('hot 9m')
  expect(a(9 * M + 59_000)).not.toContain(':')
  expect(a(30_000)).toContain('hot <1m')
  expect(bandSvg(base({ cache: hot(9 * M + 59_000) }), 99, 'christmas', true).source)
    .toBe(bandSvg(base({ cache: hot(9 * M + 1_000) }), 99, 'christmas', true).source)
})

test('text placed in the SVG is escaped', () => {
  expect(esc(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
  const p = paneSvg(base(), 64, 'christmas', true, { tested: '2.1.316', actual: '<x&"y\'>' })
  expect(wellFormed(p.source)).toBe(true)
  expect(p.source).toContain('&lt;x&amp;&quot;y&#39;&gt;')
  expect(p.source.includes('<x&')).toBe(false)
})

test('christmas has candy stripes, a snowflake, ornaments, holly and snow; classic has none', () => {
  const x = bandSvg(base(), 99, 'christmas', true).source + paneSvg(base(), 64, 'christmas', true, VER).source
  expect(x).toContain('<pattern')
  expect(x).toContain('class="stripes"')
  expect(x).toContain('class="snowflake"')
  expect(x).toContain('class="ornament"')
  expect(x).toContain('class="holly"')
  expect(x).toContain('class="snow"')
  const c = bandSvg(base(), 99, 'classic', true).source + paneSvg(base(), 64, 'classic', true, VER).source
  for (const k of ['<pattern', 'stripes', 'snowflake', 'ornament', 'holly', 'class="snow"']) expect(c.includes(k)).toBe(false)
})

test('christmas fills: stripes over 50 left, gold 20 to 50, deep red under 20', () => {
  const p = palette('christmas', true)
  const fills = (pl: number) => bandSvg(base({ fiveHour: win('5h', pl, H), sevenDay: { label: '7d', state: 'none' }, cache: { state: 'cold', reason: 'new' } }), 99, 'christmas', true).source
  expect(fills(80)).toContain('fill="url(#uhxdbC)"')
  expect(fills(40)).toContain(`fill="${p.mid}"`)
  expect(fills(40).includes('url(#uhxdbC)')).toBe(false)
  expect(fills(10)).toContain(`fill="${p.low}"`)
  // Classic: solid green, amber, red.
  const q = palette('classic', true)
  const cl = (pl: number) => bandSvg(base({ fiveHour: win('5h', pl, H) }), 99, 'classic', true).source
  expect(cl(80)).toContain(`fill="${q.good}"`)
  expect(cl(40)).toContain(`fill="${q.mid}"`)
  expect(cl(10)).toContain(`fill="${q.low}"`)
})

test('palettes switch with the theme and with dark or light', () => {
  const panels = new Set<string>()
  for (const theme of THEMES) for (const dark of [true, false]) {
    const p = palette(theme, dark)
    panels.add(p.panel)
    expect(bandSvg(base(), 99, theme, dark).source).toContain(`stop-color="${p.panel}"`)
  }
  expect(panels.size).toBe(4)
  // Empty track: dark green on dark, pale green on light.
  expect(palette('christmas', true).track).toBe('#1e4630')
  expect(palette('christmas', false).track).toBe('#d5e9d8')
})

// WCAG contrast of each text colour against the panel.
const lum = (hex: string): number => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

test('text contrast against the panel is at least 4.5:1 in every palette', () => {
  for (const theme of THEMES) for (const dark of [true, false]) {
    const p: Palette = palette(theme, dark)
    for (const k of ['text', 'muted', 'faint', 'midText', 'lowText', 'hotText'] as const) {
      for (const bg of [p.panel, p.panel2]) {
        const r = contrast(p[k], bg)
        if (r < 4.5) throw new Error(`${theme} ${dark ? 'dark' : 'light'} ${k} ${r.toFixed(2)}`)
      }
    }
  }
})

test('no randomness: the same view draws the same string', () => {
  expect(bandSvg(base(), 99, 'christmas', true).source).toBe(bandSvg(base(), 99, 'christmas', true).source)
  expect(paneSvg(base(), 64, 'christmas', true, VER).source).toBe(paneSvg(base(), 64, 'christmas', true, VER).source)
})

test('alt is the command readout on one line', () => {
  const a = altText(base())
  expect(a.includes('\n')).toBe(false)
  expect(a).toContain('5-hour: 72% left, resets in 2h 14m')
  expect(a).toContain('Cache: hot')
  expect(a).toContain('Cache state is an estimate.')
})

test('system fonts with tabular numbers, no embedded font, no animation', () => {
  const s = paneSvg(base(), 64, 'christmas', true, VER).source
  expect(s).toContain('font-family="system-ui, &#39;Segoe UI&#39;, sans-serif"')
  expect(s).toContain('font-variant-numeric:tabular-nums')
  for (const k of ['@font-face', '<animate', '<script', 'base64']) expect(s.includes(k)).toBe(false)
})
