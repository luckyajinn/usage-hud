import { expect, test } from 'claude-code/testing'
import type { CacheView, View, WindowView } from './data'
import { BAND_CELL_PX, BAND_H, altText, bandSvg, esc, palette, textW } from './art'
import type { Palette } from './art'

const M = 60_000
const H = 60 * M
const D = 24 * H

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

// The one look, pips. The loops below keep the theme name for their messages.
const THEMES = ['pips'] as const

test('every state, theme, scheme and width draws well-formed SVG under 20 KB', () => {
  for (const theme of THEMES) for (const dark of [true, false]) for (const [k, v] of Object.entries(STATES)) {
    for (const cols of [12, 24, 40, 64, 99, 140]) {
      const a = bandSvg(v, cols, dark)
      if (!wellFormed(a.source)) throw new Error(`malformed: ${theme} ${dark} ${k} ${cols}`)
      expect(a.source.length < 20_000).toBe(true)
      expect(a.source.length <= 131_072).toBe(true)
    }
  }
})

test('width follows the measured cell size; the band is about two rows tall', () => {
  // Measured on the desktop app: band about 750 px at 99 columns.
  for (const theme of THEMES) {
    expect(bandSvg(base(), 99, true).width).toBe(742)
    for (const cols of [1, 12, 24, 64, 99, 140]) {
      const bw = Math.max(60, Math.floor(cols * BAND_CELL_PX))
      const b = bandSvg(base(), cols, true)
      expect(b.width).toBe(bw)
      expect(b.height).toBe(BAND_H)
      expect(b.source).toContain(`width="${bw}" height="${BAND_H}" viewBox="0 0 ${bw} ${BAND_H}"`)
    }
  }
})

test('every state renders its label in the band', () => {
  const want: Record<string, string[]> = {
    ok: ['72%', '2h 14m', '40%', 'hot 52m'],
    none: ['--'],
    na: ['Limits n/a'],
    stale: ['88%'],
    rolled: ['reset'],
    exceeded: ['0%'],
    low: ['12%'],
    hotUnder10: ['hot 9m'],
    cold: ['cold'],
    resetting: ['99%'],
  }
  for (const theme of THEMES) for (const [k, v] of Object.entries(STATES)) {
    const band = words(bandSvg(v, 99, true).source)
    for (const w of want[k]!) {
      if (!band.includes(w) && !(k === 'na' && w === 'Limits n/a')) throw new Error(`band ${theme} ${k} lacks ${w}: ${band}`)
    }
  }
})

test('the art shows whole minutes only, so it changes at most once a minute', () => {
  for (const theme of THEMES) {
    const a = (ms: number) => words(bandSvg(base({ cache: hot(ms) }), 99, true).source)
    expect(a(9 * M + 59_000)).toContain('hot 9m')
    expect(a(9 * M + 1_000)).toContain('hot 9m')
    expect(a(9 * M + 59_000)).not.toContain(':')
    expect(a(30_000)).toContain('hot <1m')
    for (const cols of [99, 64]) {
      expect(bandSvg(base({ cache: hot(9 * M + 59_000) }), cols, true).source)
        .toBe(bandSvg(base({ cache: hot(9 * M + 1_000) }), cols, true).source)
    }
  }
})

test('text placed in the SVG is escaped', () => {
  expect(esc(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
})

test('palettes switch with the theme and with dark or light', () => {
  const panels = new Set<string>()
  for (const theme of THEMES) {
    expect(palette(true).panel).not.toBe(palette(false).panel)
    for (const dark of [true, false]) {
      const p = palette(dark)
      panels.add(p.panel)
      expect(bandSvg(base(), 99, dark).source).toContain(`stop-color="${p.panel}"`)
    }
  }
  expect(panels.size).toBe(2)
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
    const p: Palette = palette(dark)
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
    expect(bandSvg(base(), 99, dark).source).toBe(bandSvg(base(), 99, dark).source)
  }
})

test('alt is the command readout on one line', () => {
  const a = altText(base())
  expect(a.includes('\n')).toBe(false)
  expect(a).toContain('5-hour: 72% left, resets in 2h 14m')
  expect(a).toContain('Cache: hot')
  expect(a).toContain('Cache state is an estimate.')
})

test('usage used: every look shows the percent used and the alt says used', () => {
  const used = (w: WindowView): WindowView => ({ ...w, usage: 'used' }) as WindowView
  const v = base({ fiveHour: used(win('5h', 72, 2 * H + 14 * M)), sevenDay: used(win('7d', 40, 3 * D + 4 * H)) })
  expect(altText(v)).toContain('5-hour: 28% used, resets in 2h 14m 7-day: 60% used, resets in 3d 4h')
  for (const theme of THEMES) for (const dark of [true, false]) {
    const s = bandSvg(v, 99, dark).source
    expect(s).toContain('28%')
    expect(s).toContain('60%')
    expect(s.includes('72%')).toBe(false)
    // The drawing changes with the option.
    expect(s === bandSvg(base(), 99, dark).source).toBe(false)
  }
})

test('system fonts with tabular numbers, no embedded font, no animation', () => {
  for (const theme of THEMES) {
    const s = bandSvg(base(), 99, true).source
    expect(s).toContain('font-family="')
    expect(s).toContain('font-variant-numeric:tabular-nums')
    for (const k of ['@font-face', '<animate', '<script', 'base64']) expect(s.includes(k)).toBe(false)
  }
  // The default system stack.
  expect(bandSvg(base(), 99, true).source).toContain('font-family="system-ui, &#39;Segoe UI&#39;, sans-serif"')
})

test('gradient ids are unique per theme and scheme, and every url() resolves', () => {
  const owner = new Map<string, string>()
  for (const theme of THEMES) for (const dark of [true, false]) {
    const art = bandSvg(base(), 99, dark)
    const ids = [...art.source.matchAll(/ id="([^"]+)"/g)].map(m => m[1]!)
    const key = `${theme}/${dark ? 'dark' : 'light'}`
    expect(ids.length > 0).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      if (owner.has(id) && owner.get(id) !== key) throw new Error(`id ${id} used by ${owner.get(id)} and ${key}`)
      owner.set(id, key)
    }
    for (const m of art.source.matchAll(/url\(#([^)]+)\)/g)) expect(ids.includes(m[1]!)).toBe(true)
  }
  expect([...owner].filter(([, k]) => k.startsWith('pips/')).length).toBe(2)
})

test('svg ids keep their pinned letter: i for pips', () => {
  const tag = (dark: boolean): string => /id="uh(\w)([dl])bP"/.exec(bandSvg(base(), 99, dark).source)!.slice(1).join('')
  expect(tag(true)).toBe('id')
  expect(tag(false)).toBe('il')
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

test('pips: band text stays inside the box and clear of its neighbours, columns 12 to 200', () => {
  for (const dark of [true, false]) for (const [k, v] of Object.entries(STATES)) {
    for (let cols = 12; cols <= 200; cols++) {
      const a = bandSvg(v, cols, dark)
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

// ---- pips: cache bars red while hot, all ten blue when cold ----

test('pips: hot cache pips are hotRed, a cold cache lights all ten in coldBlue', () => {
  for (const dark of [true, false]) {
    const p = palette(dark)
    const rects = (svg: string, c: string) => (svg.match(new RegExp(`<rect [^>]*fill="${c}"`, 'g')) ?? []).length
    const hotSvg = bandSvg(base({ cache: hot(41 * M) }), 99, dark).source
    expect(rects(hotSvg, p.hotRed!)).toBeGreaterThan(0)
    const coldSvg = bandSvg(base({ cache: { state: 'cold', reason: 'expired' } }), 99, dark).source
    expect(rects(coldSvg, p.coldBlue!)).toBe(10)
  }
})

test('pips: bars at 99 columns are tall (21 px) and widen to fill the strip', () => {
  const sizes = (svg: string): [number, number][] =>
    [...svg.matchAll(/<rect x="[^"]+" y="[^"]+" width="([\d.]+)" height="([\d.]+)" rx/g)].map(m => [Number(m[1]), Number(m[2])])
  const full = sizes(bandSvg(base({ cache: hot(41 * M) }), 99, true).source)
  expect(full.length).toBe(30)
  for (const [w, h] of full) { expect(h).toBe(21); expect(w).toBeGreaterThanOrEqual(6); expect(w).toBeLessThanOrEqual(12.6) }
  // Longer words (a cold cache, a reached limit) may take a rung down, still tall.
  for (const v of [STATES.cold!, STATES.exceeded!]) {
    const bars = sizes(bandSvg(v, 99, true).source)
    expect(bars.length).toBe(30)
    for (const [w, h] of bars) expect(h).toBeGreaterThanOrEqual(17.5)
  }
  // Narrower, the bars stay tall: the words give way first.
  for (const [w, h] of sizes(bandSvg(base({ cache: hot(41 * M) }), 56, true).source)) expect(h).toBeGreaterThan(w * 1.5)
})
