import { expect, test } from 'claude-code/testing'
import type { CacheView, View, WindowView } from './data'
import { BAND_CELL_PX, BAND_H, altText, bandSvg, esc, palette, textW } from './art'
import type { ArtTheme, Palette } from './art'

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

// Every art theme: the generic tests below run against each, so a new look is covered by listing it here.
const THEMES: ArtTheme[] = ['clean', 'classic', 'midnight', 'paper', 'terminal', 'sunset', 'mono']

test('every state, theme, scheme and width draws well-formed SVG under 20 KB', () => {
  for (const theme of THEMES) for (const dark of [true, false]) for (const [k, v] of Object.entries(STATES)) {
    for (const cols of [12, 24, 40, 64, 99, 140]) {
      const a = bandSvg(v, cols, theme, dark)
      if (!wellFormed(a.source)) throw new Error(`malformed: ${theme} ${dark} ${k} ${cols}`)
      expect(a.source.length < 20_000).toBe(true)
      expect(a.source.length <= 131_072).toBe(true)
    }
  }
})

test('width follows the measured cell size; the band is about two rows tall', () => {
  // Measured on the desktop app: band about 750 px at 99 columns.
  for (const theme of THEMES) {
    expect(bandSvg(base(), 99, theme, true).width).toBe(742)
    for (const cols of [1, 12, 24, 64, 99, 140]) {
      const bw = Math.max(60, Math.floor(cols * BAND_CELL_PX))
      const b = bandSvg(base(), cols, theme, true)
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
    for (const w of want[k]!) {
      if (!band.includes(w) && !(k === 'na' && w === 'Limits n/a')) throw new Error(`band ${theme} ${k} lacks ${w}: ${band}`)
    }
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
    }
  }
})

test('text placed in the SVG is escaped', () => {
  expect(esc(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
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
  for (const theme of THEMES) {
    const s = bandSvg(base(), 99, theme, true).source
    expect(s).toContain('font-family="')
    expect(s).toContain('font-variant-numeric:tabular-nums')
    for (const k of ['@font-face', '<animate', '<script', 'base64']) expect(s.includes(k)).toBe(false)
  }
  // The default stack, for the looks that use it.
  for (const theme of ['clean', 'classic'] as const) {
    expect(bandSvg(base(), 99, theme, true).source).toContain('font-family="system-ui, &#39;Segoe UI&#39;, sans-serif"')
  }
})

// ---- clean theme ----

const cleanBandOf = (v: View, cols = 99, dark = true) => bandSvg(v, cols, 'clean', dark)
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
  }
})

test('clean: the band is exactly floor(cols * BAND_CELL_PX) by BAND_H', () => {
  expect(cleanBandOf(base(), 99).width).toBe(742)
  for (let cols = 1; cols <= 200; cols++) {
    const bw = Math.max(60, Math.floor(cols * BAND_CELL_PX))
    const b = cleanBandOf(base(), cols)
    expect(b.width).toBe(bw)
    expect(b.height).toBe(BAND_H)
    expect(b.source).toContain(`width="${bw}" height="${BAND_H}" viewBox="0 0 ${bw} ${BAND_H}"`)
  }
})

test('clean: no decoration: no pattern, highlight or second gradient', () => {
  for (const dark of [true, false]) for (const v of Object.values(STATES)) {
    const x = cleanBandOf(v, 99, dark).source
    for (const k of ['<pattern', 'ornament', 'opacity=".2"']) {
      if (x.includes(k)) throw new Error(`clean draws ${k}`)
    }
    // One gradient only: the panel. No frost or flake gradient.
    expect((x.match(/<linearGradient/g) ?? []).length).toBe(1)
  }
})

test('clean: bar colour follows the threshold, green over 50, amber 20 to 50, red under 20', () => {
  for (const dark of [true, false]) {
    const p = palette('clean', dark)
    const view = (pl: number) => base({ fiveHour: win('5h', pl, H), sevenDay: { label: '7d', state: 'none' }, cache: { state: 'cold', reason: 'new' } })
    const bandOf = (pl: number) => cleanBandOf(view(pl), 99, dark).source
    const want = (pl: number): 'good' | 'mid' | 'low' => (pl > 50 ? 'good' : pl >= 20 ? 'mid' : 'low')
    for (const pl of [100, 80, 51, 50, 40, 20, 19, 10, 1]) {
      const svg = bandOf(pl)
      for (const c of ['good', 'mid', 'low'] as const) {
        if (hasBar(svg, p[c]) !== (c === want(pl))) throw new Error(`${dark} ${pl}% expected ${want(pl)}, ${c} ${hasBar(svg, p[c])}`)
      }
      expect(hasBar(svg, p.stale)).toBe(false)
    }
    // The big number takes the matching text colour.
    expect(bandOf(80)).toContain(`fill="${p.text}">80%`)
    expect(bandOf(40)).toContain(`fill="${p.midText}">40%`)
    expect(bandOf(10)).toContain(`fill="${p.lowText}">10%`)
    // A reached limit is red even though the number is 0.
    const ex = base({ sevenDay: win('7d', 0, 26 * H, { exceeded: true }) })
    const exSvg = cleanBandOf(ex, 99, dark).source
    expect(exSvg).toContain(`fill="${p.lowText}">0%`)
    expect(exSvg).toContain(`fill="${p.low}"`)
    // Stale readings draw the stale grey bar, dimmed, with the number in muted text.
    const st = STATES.stale!
    const stSvg = cleanBandOf(st, 99, dark).source
    expect(hasBar(stSvg, p.stale)).toBe(true)
    expect(hasBar(stSvg, p.good)).toBe(false)
    expect(stSvg).toContain('<g opacity=".8">')
    expect(stSvg).toContain(`fill="${p.muted}">88%`)
    // A fresh view has no dimmed group.
    expect(cleanBandOf(base(), 99, dark).source.includes('opacity=')).toBe(false)
  }
})

test('clean: the cache bar is calm blue while hot, mid when under a minute, and absent when cold', () => {
  for (const dark of [true, false]) {
    const p = palette('clean', dark)
    const hotB = cleanBandOf(base(), 99, dark).source
    expect(hasBar(hotB, p.frost)).toBe(true)
    expect(hotB).toContain(`fill="${p.hotText}">hot 52m`)

    const cold = STATES.cold!
    const coldB = cleanBandOf(cold, 99, dark).source
    expect(hasBar(coldB, p.frost)).toBe(false)
    expect(coldB.includes(p.hotText)).toBe(false)
    expect(coldB).toContain(`fill="${p.faint}">cold`)
    expect(words(coldB)).toContain('compacted')

    const last = base({ cache: hot(30_000) })
    expect(hasBar(cleanBandOf(last, 99, dark).source, p.mid)).toBe(true)
    expect(hasBar(cleanBandOf(last, 99, dark).source, p.frost)).toBe(false)
    expect(words(cleanBandOf(last, 99, dark).source)).toContain('hot <1m')
  }
})

test('clean: Limits n/a draws one wide quiet block in the band', () => {
  for (const dark of [true, false]) {
    const p = palette('clean', dark)
    const b = cleanBandOf(STATES.na!, 99, dark).source
    expect(words(b)).toContain('Limits n/a')
    expect(words(b)).toContain('hot 52m')
    expect(b.includes('%')).toBe(false)
    expect(b.includes('5-HOUR')).toBe(false)
    expect(b).toContain(`fill="${p.muted}">Limits n/a`)
    expect(hasBar(b, p.good) || hasBar(b, p.mid) || hasBar(b, p.low)).toBe(false)
  }
  // One window n/a but not the other is not the combined block.
  const one = base({ fiveHour: { label: '5h', state: 'na' } })
  expect(words(cleanBandOf(one).source).includes('Limits n/a')).toBe(false)
})

test('clean: stale and rolled windows say when they were last read', () => {
  const st = STATES.stale!
  expect(words(cleanBandOf(st).source)).toContain('as of 12m')
  expect(words(cleanBandOf(st).source)).toContain('88%')
  // A fresh reading never says "as of".
  expect(words(cleanBandOf(base()).source).includes('as of')).toBe(false)
  const ro = STATES.rolled!
  expect(words(cleanBandOf(ro).source)).toContain('reset')
  expect(words(cleanBandOf(ro).source)).toContain('as of 12m')
})

test('gradient ids are unique per theme and scheme, and every url() resolves', () => {
  const owner = new Map<string, string>()
  for (const theme of THEMES) for (const dark of [true, false]) {
    const art = bandSvg(base(), 99, theme, dark)
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
  expect([...owner].filter(([, k]) => k.startsWith('clean/')).length).toBe(2)
})

test('svg ids keep their pinned letters: n for clean, c for classic, one letter per theme', () => {
  const tag = (theme: ArtTheme, dark: boolean): string => {
    const a = bandSvg(base(), 99, theme, dark)
    return /id="uh(\w)([dl])bP"/.exec(a.source)!.slice(1).join('')
  }
  expect(tag('clean', true)).toBe('nd')
  expect(tag('clean', false)).toBe('nl')
  expect(tag('classic', true)).toBe('cd')
  expect(tag('classic', false)).toBe('cl')
  expect(new Set(THEMES.map(t => tag(t, true)[0])).size).toBe(THEMES.length)
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
