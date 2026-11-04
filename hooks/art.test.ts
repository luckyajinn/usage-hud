import { expect, test } from 'claude-code/testing'
import type { CacheView, View, WindowView } from './data'
import { BAND_CELL_PX, BAND_H, PANE_CELL_PX, altText, bandSvg, esc, palette, paneSvg, textW } from './art'
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

// Every art theme: the generic tests below run against each, so a new look is covered by listing it here.
const THEMES: ArtTheme[] = ['clean', 'classic', 'midnight', 'paper', 'terminal', 'sunset', 'mono']

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
  for (const theme of THEMES) {
    expect(bandSvg(base(), 99, theme, true).width).toBe(742)
    expect(paneSvg(base(), 64, theme, true, VER).width).toBe(320)
    for (const cols of [1, 12, 24, 64, 99, 140]) {
      const bw = Math.max(60, Math.floor(cols * BAND_CELL_PX))
      const b = bandSvg(base(), cols, theme, true)
      expect(b.width).toBe(bw)
      expect(b.height).toBe(BAND_H)
      expect(b.source).toContain(`width="${bw}" height="${BAND_H}" viewBox="0 0 ${bw} ${BAND_H}"`)
      const pw = Math.max(120, Math.floor(cols * PANE_CELL_PX))
      const p = paneSvg(base(), cols, theme, true, VER)
      expect(p.width).toBe(pw)
      expect(p.source).toContain(`viewBox="0 0 ${pw} ${p.height}"`)
    }
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
  const pane = (v: View) => words(paneSvg(v, 64, 'clean', true, VER).source)
  expect(pane(STATES.na!)).toContain('LIMITS')
  expect(pane(STATES.na!)).toContain('n/a')
  expect(pane(STATES.exceeded!)).toContain('left')
  expect(pane(STATES.exceeded!)).toContain('limit reached')
  expect(pane(STATES.cold!)).toContain('compacted')
  expect(pane(STATES.ok!)).toContain('resets in 2h 14m')
  expect(pane(STATES.resetting!)).toContain('resetting now')
  expect(pane(STATES.ok!)).toContain('tested on 2.1.316')
  for (const theme of THEMES) {
    expect(words(paneSvg(base(), 64, theme, true, { tested: '2.1.316', actual: '2.1.400' }).source)).toContain('untested engine 2.1.400')
  }
})

test('the art shows whole minutes only, so it changes at most once a minute', () => {
  for (const theme of THEMES) {
    const a = (ms: number) => words(bandSvg(base({ cache: hot(ms) }), 99, theme, true).source)
    expect(a(9 * M + 59_000)).toContain('hot 9m')
    expect(a(9 * M + 1_000)).toContain('hot 9m')
    expect(a(9 * M + 59_000)).not.toContain(':')
    expect(a(30_000)).toContain('hot <1m')
    for (const cols of [99, 64]) {
      expect(bandSvg(base({ cache: hot(9 * M + 59_000) }), cols, theme, true).source)
        .toBe(bandSvg(base({ cache: hot(9 * M + 1_000) }), cols, theme, true).source)
      expect(paneSvg(base({ cache: hot(9 * M + 59_000) }), cols, theme, true, VER).source)
        .toBe(paneSvg(base({ cache: hot(9 * M + 1_000) }), cols, theme, true, VER).source)
    }
  }
})

test('text placed in the SVG is escaped', () => {
  expect(esc(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
  for (const theme of THEMES) {
    const p = paneSvg(base(), 64, theme, true, { tested: '2.1.316', actual: '<x&"y\'>' })
    expect(wellFormed(p.source)).toBe(true)
    expect(p.source).toContain('&lt;x&amp;&quot;y&#39;&gt;')
    expect(p.source.includes('<x&')).toBe(false)
  }
})

test('classic bar fills: solid green over 50, amber 20 to 50, red under 20', () => {
  const q = palette('classic', true)
  const cl = (pl: number) => bandSvg(base({ fiveHour: win('5h', pl, H) }), 99, 'classic', true).source
  expect(cl(80)).toContain(`fill="${q.good}"`)
  expect(cl(40)).toContain(`fill="${q.mid}"`)
  expect(cl(10)).toContain(`fill="${q.low}"`)
})

test('palettes switch with the theme and with dark or light', () => {
  const panels = new Set<string>()
  for (const theme of THEMES) {
    expect(palette(theme, true).panel).not.toBe(palette(theme, false).panel)
    for (const dark of [true, false]) {
      const p = palette(theme, dark)
      panels.add(p.panel)
      expect(bandSvg(base(), 99, theme, dark).source).toContain(`stop-color="${p.panel}"`)
      expect(paneSvg(base(), 64, theme, dark, VER).source).toContain(`stop-color="${p.panel}"`)
    }
  }
  // At least classic dark, clean dark and the white light panel they share.
  expect(panels.size >= 3).toBe(true)
  expect(palette('classic', true).panel).not.toBe(palette('clean', true).panel)
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
  for (const theme of THEMES) for (const dark of [true, false]) {
    expect(bandSvg(base(), 99, theme, dark).source).toBe(bandSvg(base(), 99, theme, dark).source)
    expect(paneSvg(base(), 64, theme, dark, VER).source).toBe(paneSvg(base(), 64, theme, dark, VER).source)
  }
})

test('alt is the command readout on one line', () => {
  const a = altText(base())
  expect(a.includes('\n')).toBe(false)
  expect(a).toContain('5-hour: 72% left, resets in 2h 14m')
  expect(a).toContain('Cache: hot')
  expect(a).toContain('Cache state is an estimate.')
})

test('system fonts with tabular numbers, no embedded font, no animation', () => {
  for (const theme of THEMES) for (const s of [bandSvg(base(), 99, theme, true).source, paneSvg(base(), 64, theme, true, VER).source]) {
    expect(s).toContain('font-family="')
    expect(s).toContain('font-variant-numeric:tabular-nums')
    for (const k of ['@font-face', '<animate', '<script', 'base64']) expect(s.includes(k)).toBe(false)
  }
  // The default stack, for the looks that use it.
  for (const theme of ['clean', 'classic'] as const) {
    expect(paneSvg(base(), 64, theme, true, VER).source).toContain('font-family="system-ui, &#39;Segoe UI&#39;, sans-serif"')
  }
})

// ---- clean theme ----

const cleanBandOf = (v: View, cols = 99, dark = true) => bandSvg(v, cols, 'clean', dark)
const cleanPaneOf = (v: View, cols = 64, dark = true, ver = VER) => paneSvg(v, cols, 'clean', dark, ver)
/** True when a bar (a rounded rect) is filled with this colour. Status dots are circles, so they do not match. */
const hasBar = (svg: string, color: string): boolean => new RegExp(`<rect [^>]*rx="[^"]*" fill="${color}"`).test(svg)

test('clean: well-formed, deterministic and small at every width, scheme and state', () => {
  for (const dark of [true, false]) for (const [k, v] of Object.entries(STATES)) {
    for (let cols = 12; cols <= 200; cols += 7) {
      const b = cleanBandOf(v, cols, dark)
      if (!wellFormed(b.source)) throw new Error(`malformed band: ${dark} ${k} ${cols}`)
      expect(b.source.length < 20_000).toBe(true)
      expect(b.source).toBe(cleanBandOf(v, cols, dark).source)
    }
    for (let cols = 12; cols <= 80; cols += 4) {
      const p = cleanPaneOf(v, cols, dark)
      if (!wellFormed(p.source)) throw new Error(`malformed pane: ${dark} ${k} ${cols}`)
      expect(p.source.length < 20_000).toBe(true)
      expect(p.source).toBe(cleanPaneOf(v, cols, dark).source)
    }
  }
})

test('clean: the band is exactly floor(cols * BAND_CELL_PX) by BAND_H, the pane follows the width rule', () => {
  expect(cleanBandOf(base(), 99).width).toBe(742)
  expect(cleanPaneOf(base(), 64).width).toBe(320)
  for (let cols = 1; cols <= 200; cols++) {
    const bw = Math.max(60, Math.floor(cols * BAND_CELL_PX))
    const b = cleanBandOf(base(), cols)
    expect(b.width).toBe(bw)
    expect(b.height).toBe(BAND_H)
    expect(b.source).toContain(`width="${bw}" height="${BAND_H}" viewBox="0 0 ${bw} ${BAND_H}"`)
  }
  for (let cols = 1; cols <= 120; cols++) {
    const pw = Math.max(120, Math.floor(cols * PANE_CELL_PX))
    const p = cleanPaneOf(base(), cols)
    expect(p.width).toBe(pw)
    expect(p.source).toContain(`width="${pw}" height="${p.height}" viewBox="0 0 ${pw} ${p.height}"`)
  }
})

test('clean: no decoration: no pattern, highlight or second gradient', () => {
  for (const dark of [true, false]) for (const v of Object.values(STATES)) {
    for (const x of [cleanBandOf(v, 99, dark).source, cleanPaneOf(v, 64, dark).source]) {
      for (const k of ['<pattern', 'ornament', 'opacity=".2"']) {
        if (x.includes(k)) throw new Error(`clean draws ${k}`)
      }
      // One gradient only: the panel. No frost or flake gradient.
      expect((x.match(/<linearGradient/g) ?? []).length).toBe(1)
    }
  }
})

test('clean: bar colour follows the threshold, green over 50, amber 20 to 50, red under 20', () => {
  for (const dark of [true, false]) {
    const p = palette('clean', dark)
    const view = (pl: number) => base({ fiveHour: win('5h', pl, H), sevenDay: { label: '7d', state: 'none' }, cache: { state: 'cold', reason: 'new' } })
    const bandOf = (pl: number) => cleanBandOf(view(pl), 99, dark).source
    const paneOf = (pl: number) => cleanPaneOf(view(pl), 64, dark).source
    const want = (pl: number): 'good' | 'mid' | 'low' => (pl > 50 ? 'good' : pl >= 20 ? 'mid' : 'low')
    for (const pl of [100, 80, 51, 50, 40, 20, 19, 10, 1]) {
      for (const svg of [bandOf(pl), paneOf(pl)]) {
        for (const c of ['good', 'mid', 'low'] as const) {
          if (hasBar(svg, p[c]) !== (c === want(pl))) throw new Error(`${dark} ${pl}% expected ${want(pl)}, ${c} ${hasBar(svg, p[c])}`)
        }
        expect(hasBar(svg, p.stale)).toBe(false)
      }
    }
    // The big number takes the matching text colour.
    expect(bandOf(80)).toContain(`fill="${p.text}">80%`)
    expect(bandOf(40)).toContain(`fill="${p.midText}">40%`)
    expect(bandOf(10)).toContain(`fill="${p.lowText}">10%`)
    expect(paneOf(80)).toContain(`fill="${p.text}">80%`)
    expect(paneOf(40)).toContain(`fill="${p.midText}">40%`)
    expect(paneOf(10)).toContain(`fill="${p.lowText}">10%`)
    // A reached limit is red even though the number is 0.
    const ex = base({ sevenDay: win('7d', 0, 26 * H, { exceeded: true }) })
    for (const svg of [cleanBandOf(ex, 99, dark).source, cleanPaneOf(ex, 64, dark).source]) {
      expect(svg).toContain(`fill="${p.lowText}">0%`)
      expect(svg).toContain(`fill="${p.low}"`)
    }
    // Stale readings draw the stale grey bar, dimmed, with the number in muted text.
    const st = STATES.stale!
    for (const svg of [cleanBandOf(st, 99, dark).source, cleanPaneOf(st, 64, dark).source]) {
      expect(hasBar(svg, p.stale)).toBe(true)
      expect(hasBar(svg, p.good)).toBe(false)
      expect(svg).toContain('<g opacity=".8">')
      expect(svg).toContain(`fill="${p.muted}">88%`)
    }
    // A fresh view has no dimmed group.
    expect(cleanBandOf(base(), 99, dark).source.includes('opacity=')).toBe(false)
  }
})

test('clean: the cache bar is calm blue while hot, mid when under a minute, and absent when cold', () => {
  for (const dark of [true, false]) {
    const p = palette('clean', dark)
    const hotB = cleanBandOf(base(), 99, dark).source
    const hotP = cleanPaneOf(base(), 64, dark).source
    expect(hasBar(hotB, p.frost)).toBe(true)
    expect(hasBar(hotP, p.frost)).toBe(true)
    expect(hotB).toContain(`fill="${p.hotText}">hot 52m`)
    expect(hotP).toContain(`fill="${p.hotText}" dx="6">52m`)
    expect(words(hotP)).toContain('hot 52m')
    expect(words(hotP)).toContain('1h cache lifetime, an estimate')

    const cold = STATES.cold!
    const coldB = cleanBandOf(cold, 99, dark).source
    const coldP = cleanPaneOf(cold, 64, dark).source
    for (const svg of [coldB, coldP]) {
      expect(hasBar(svg, p.frost)).toBe(false)
      expect(svg.includes(p.hotText)).toBe(false)
      expect(svg).toContain(`fill="${p.faint}">cold`)
    }
    expect(words(coldB)).toContain('compacted')
    expect(words(coldP)).toContain('compacted')
    expect(words(coldP).includes('lifetime')).toBe(false)

    const last = base({ cache: hot(30_000) })
    expect(hasBar(cleanBandOf(last, 99, dark).source, p.mid)).toBe(true)
    expect(hasBar(cleanBandOf(last, 99, dark).source, p.frost)).toBe(false)
    expect(words(cleanBandOf(last, 99, dark).source)).toContain('hot <1m')
    expect(words(cleanPaneOf(last, 64, dark).source)).toContain('<1m')
  }
})

test('clean: Limits n/a draws one wide quiet block in the band and a Limits block in the pane', () => {
  for (const dark of [true, false]) {
    const p = palette('clean', dark)
    const b = cleanBandOf(STATES.na!, 99, dark).source
    expect(words(b)).toContain('Limits n/a')
    expect(words(b)).toContain('hot 52m')
    expect(b.includes('%')).toBe(false)
    expect(b.includes('5-HOUR')).toBe(false)
    expect(b).toContain(`fill="${p.muted}">Limits n/a`)
    expect(hasBar(b, p.good) || hasBar(b, p.mid) || hasBar(b, p.low)).toBe(false)
    const pane = words(cleanPaneOf(STATES.na!, 64, dark).source)
    expect(pane).toContain('LIMITS')
    expect(pane).toContain('n/a')
    expect(pane).toContain('no subscription limits')
    expect(pane).toContain('PROMPT CACHE')
    expect(pane.includes('5-HOUR')).toBe(false)
    expect(pane.includes('7-DAY')).toBe(false)
  }
  // One window n/a but not the other is not the combined block.
  const one = base({ fiveHour: { label: '5h', state: 'na' } })
  expect(words(cleanBandOf(one).source).includes('Limits n/a')).toBe(false)
})

test('clean: stale and rolled windows say when they were last read', () => {
  const st = STATES.stale!
  expect(words(cleanBandOf(st).source)).toContain('as of 12m')
  expect(words(cleanPaneOf(st).source)).toContain('as of 12m')
  expect(words(cleanPaneOf(st).source)).toContain('88%')
  // A fresh reading never says "as of".
  expect(words(cleanBandOf(base()).source).includes('as of')).toBe(false)
  expect(words(cleanPaneOf(base()).source).includes('as of')).toBe(false)
  const ro = STATES.rolled!
  expect(words(cleanBandOf(ro).source)).toContain('reset')
  expect(words(cleanPaneOf(ro).source)).toContain('window has reset')
  expect(words(cleanPaneOf(ro).source)).toContain('as of 12m')
})

test('clean: the pane spells out the details, and the art changes at most once a minute', () => {
  const pane = (v: View) => words(cleanPaneOf(v).source)
  expect(pane(STATES.ok!)).toContain('Usage left')
  expect(pane(STATES.ok!)).toContain('5-HOUR')
  expect(pane(STATES.ok!)).toContain('7-DAY')
  expect(pane(STATES.ok!)).toContain('resets in 2h 14m')
  expect(pane(STATES.ok!)).toContain('tested on 2.1.316')
  expect(pane(STATES.exceeded!)).toContain('limit reached')
  expect(pane(STATES.resetting!)).toContain('resetting now')
  expect(pane(STATES.none!)).toContain('--')
  expect(pane(STATES.none!)).toContain('no reading yet')
  expect(cleanBandOf(base({ cache: hot(9 * M + 59_000) })).source).toBe(cleanBandOf(base({ cache: hot(9 * M + 1_000) })).source)
  expect(cleanPaneOf(base({ cache: hot(9 * M + 59_000) })).source).toBe(cleanPaneOf(base({ cache: hot(9 * M + 1_000) })).source)
})

test('clean: text placed in the art is escaped', () => {
  const p = cleanPaneOf(base(), 64, true, { tested: '<t&>', actual: '<x&"y\'>' })
  expect(wellFormed(p.source)).toBe(true)
  expect(p.source).toContain('&lt;t&amp;&gt;')
  expect(p.source).toContain('&lt;x&amp;&quot;y&#39;&gt;')
  expect(p.source.includes('<x&')).toBe(false)
  expect(p.source.includes('<t&')).toBe(false)
  // Narrow, where the note wraps, still escapes.
  const n = cleanPaneOf(base(), 24, false, { tested: '2.1.316', actual: '<x&"y\'>' })
  expect(wellFormed(n.source)).toBe(true)
  expect(n.source.includes('<x&')).toBe(false)
})

test('gradient ids are unique per theme, scheme and surface, and every url() resolves', () => {
  const owner = new Map<string, string>()
  for (const theme of THEMES) for (const dark of [true, false]) {
    for (const [kind, art] of [['band', bandSvg(base(), 99, theme, dark)], ['pane', paneSvg(base(), 64, theme, dark, VER)]] as const) {
      const ids = [...art.source.matchAll(/ id="([^"]+)"/g)].map(m => m[1]!)
      const key = `${theme}/${dark ? 'dark' : 'light'}/${kind}`
      expect(ids.length > 0).toBe(true)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) {
        if (owner.has(id) && owner.get(id) !== key) throw new Error(`id ${id} used by ${owner.get(id)} and ${key}`)
        owner.set(id, key)
      }
      for (const m of art.source.matchAll(/url\(#([^)]+)\)/g)) expect(ids.includes(m[1]!)).toBe(true)
    }
  }
  expect([...owner].filter(([, k]) => k.startsWith('clean/')).length).toBe(4)
})

test('svg ids keep their pinned letters: n for clean, c for classic, one letter per theme', () => {
  const tag = (theme: ArtTheme, dark: boolean, kind: 'band' | 'pane'): string => {
    const a = kind === 'band' ? bandSvg(base(), 99, theme, dark) : paneSvg(base(), 64, theme, dark, VER)
    return /id="uh(\w)([dl])([bp])P"/.exec(a.source)!.slice(1).join('')
  }
  expect(tag('clean', true, 'band')).toBe('ndb')
  expect(tag('clean', false, 'pane')).toBe('nlp')
  expect(tag('classic', true, 'pane')).toBe('cdp')
  expect(tag('classic', false, 'band')).toBe('clb')
  expect(new Set(THEMES.map(t => tag(t, true, 'band')[0])).size).toBe(THEMES.length)
})

/** Every <text> in a drawing with its horizontal extent, as the art measures it (textW, letter-spacing, dx). */
function boxes(svg: string): { x0: number; x1: number; y: number; size: number; s: string }[] {
  const out: { x0: number; x1: number; y: number; size: number; s: string }[] = []
  for (const m of svg.matchAll(/<text x="([^"]+)" y="([^"]+)" font-size="([^"]+)"([^>]*)>(.*?)<\/text>/g)) {
    const [, xs, ys, zs, attrs, inner] = m
    const size = Number(zs)
    const weight = Number(/font-weight="(\d+)"/.exec(attrs!)?.[1] ?? 400)
    const spacing = Number(/letter-spacing="([\d.]+)"/.exec(attrs!)?.[1] ?? 0)
    const end = /text-anchor="end"/.test(attrs!)
    let w = 0
    let s = ''
    for (const t of inner!.matchAll(/<tspan fill="[^"]*"([^>]*)>([^<]*)<\/tspan>/g)) {
      const a = t[1]!
      const z = Number(/font-size="([\d.]+)"/.exec(a)?.[1] ?? size)
      const wt = Number(/font-weight="(\d+)"/.exec(a)?.[1] ?? weight)
      const dx = Number(/dx="([\d.]+)"/.exec(a)?.[1] ?? 0)
      const txt = t[2]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      w += dx + textW(txt, z, wt >= 600) + spacing * [...txt].length
      s += txt
    }
    const x = Number(xs)
    out.push({ x0: end ? x - w : x, x1: end ? x : x + w, y: Number(ys), size, s })
  }
  return out
}

test('clean: band text stays inside the box and clear of its neighbours, columns 12 to 200', () => {
  for (const dark of [true, false]) for (const [k, v] of Object.entries(STATES)) {
    for (let cols = 12; cols <= 200; cols++) {
      const a = cleanBandOf(v, cols, dark)
      const bs = boxes(a.source)
      expect(bs.length > 0).toBe(true)
      for (const b of bs) {
        const at = `${dark ? 'dark' : 'light'} ${k} ${cols}cols "${b.s}" ${b.x0.toFixed(1)}..${b.x1.toFixed(1)} of ${a.width}`
        if (b.x0 < 1 || b.x1 > a.width - 1) throw new Error(`band text outside: ${at}`)
        if (b.y > a.height - 1 || b.y - b.size < 0) throw new Error(`band text above or below: ${at} y=${b.y}`)
      }
      const row = [...bs].sort((m, n) => m.x0 - n.x0)
      for (let i = 1; i < row.length; i++) {
        if (row[i]!.x0 < row[i - 1]!.x1 - 0.01) {
          throw new Error(`band text overlaps: ${dark ? 'dark' : 'light'} ${k} ${cols}cols "${row[i - 1]!.s}" and "${row[i]!.s}"`)
        }
      }
    }
  }
})

test('clean: pane text stays inside the box, columns 12 to 80', () => {
  const untested = { tested: '2.1.316', actual: '2.1.400-beta.12' }
  for (const dark of [true, false]) for (const [k, v] of Object.entries(STATES)) for (const ver of [VER, untested]) {
    for (let cols = 12; cols <= 80; cols++) {
      const a = cleanPaneOf(v, cols, dark, ver)
      const bs = boxes(a.source)
      expect(bs.length > 0).toBe(true)
      for (const b of bs) {
        const at = `${dark ? 'dark' : 'light'} ${k} ${cols}cols "${b.s}" ${b.x0.toFixed(1)}..${b.x1.toFixed(1)} of ${a.width}`
        if (b.x0 < 1 || b.x1 > a.width - 1) throw new Error(`pane text outside: ${at}`)
        if (b.y > a.height - 1) throw new Error(`pane text below the card: ${at} y=${b.y} of ${a.height}`)
      }
    }
  }
})

test('clean: the footer flags an untested engine, and only then', () => {
  for (const dark of [true, false]) {
    const p = palette('clean', dark)
    const odd = cleanPaneOf(base(), 64, dark, { tested: '2.1.316', actual: '2.1.400' }).source
    expect(words(odd)).toContain('tested on 2.1.316')
    expect(words(odd)).toContain('untested engine 2.1.400')
    expect(odd).toContain(`fill="${p.midText}" dx="8">untested engine 2.1.400`)
    // Narrow panes wrap the note onto its own line instead of cutting it.
    const narrow = words(cleanPaneOf(base(), 14, dark, { tested: '2.1.316', actual: '2.1.400' }).source)
    expect(narrow).toContain('untested')
    expect(narrow).toContain('2.1.400')
    for (const same of [{ tested: '2.1.316', actual: null }, { tested: '2.1.316', actual: '2.1.316' }]) {
      const s = cleanPaneOf(base(), 64, dark, same).source
      expect(s.includes('untested')).toBe(false)
      expect(words(s)).toContain('tested on 2.1.316')
    }
  }
})

test('clean: text colours keep 4.5:1 against the panel in dark and light', () => {
  // Relative luminance (WCAG 2.x) and the contrast ratio built on it.
  const rel = (hex: string): number => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
  }
  const ratio = (a: string, b: string): number => (Math.max(rel(a), rel(b)) + 0.05) / (Math.min(rel(a), rel(b)) + 0.05)
  expect(Math.round(ratio('#000000', '#ffffff'))).toBe(21)
  for (const dark of [true, false]) {
    const p = palette('clean', dark)
    for (const k of ['text', 'muted', 'faint', 'midText', 'lowText', 'hotText'] as const) {
      for (const bg of [p.panel, p.panel2]) {
        const r = ratio(p[k], bg)
        if (r < 4.5) throw new Error(`clean ${dark ? 'dark' : 'light'} ${k} ${r.toFixed(2)}`)
      }
    }
    // The bar fills are graphics: they should still be seen on the panel (3:1).
    for (const k of ['good', 'mid', 'low', 'frost'] as const) {
      const r = ratio(p[k], p.panel)
      if (r < 3) throw new Error(`clean ${dark ? 'dark' : 'light'} bar ${k} ${r.toFixed(2)}`)
    }
  }
})
