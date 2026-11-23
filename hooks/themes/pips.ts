// The pips look. Simple and friendly, like a battery or signal indicator: a flat ground with
// no card chrome, and each block on one centred line: a small muted label, a row of ten small
// rounded squares (pips) lit for the amount shown, then the percent and the reset time in
// regular weight. Lit pips carry the colour: green above 50% left, amber 20-50, red under 20,
// grey when stale, a calm blue for the hot cache (all unlit when cold). Unlit pips are a faint
// track. A reached limit tints its unlit pips red so the block still says so at a glance.
import type { View, WindowView } from '../data'
import {
  BAND_H, FONT, bandTail, cacheReadout, esc, fillPaint, fitText, limitsNa, r1, text, textW, windowReadout,
} from '../artkit'
import type { Art, Palette, Readout, Span } from '../artkit'

/** Single letter in svg ids: 'uh' + ID_TAG + (dark ? 'd' : 'l') + 'b'. */
export const ID_TAG = 'i'

// ---- palette ----
// Text stays neutral; `good`, `mid`, `low`, `stale` and `frost` are the lit pip colours.
const DARK: Palette = {
  panel: '#17181b', panel2: '#17181b', border: '#17181b', divider: '#26282c',
  text: '#e8eaed', muted: '#9aa0a8', faint: '#7d838c',
  track: '#2e3136', good: '#46c37b', mid: '#e8a93a', low: '#f0625d', stale: '#6a7079',
  midText: '#e8eaed', lowText: '#ff8a85',
  frost: '#5aa9f0', hotText: '#e8eaed',
}
const LIGHT: Palette = {
  panel: '#ffffff', panel2: '#ffffff', border: '#ffffff', divider: '#eceef1',
  text: '#1d2025', muted: '#5a616b', faint: '#6b727c',
  track: '#e2e5e9', good: '#1f9d57', mid: '#d48a00', low: '#d93a35', stale: '#a7adb5',
  midText: '#1d2025', lowText: '#c42b26',
  frost: '#2f7fd1', hotText: '#1d2025',
}
/** The faint red the unlit pips of a reached limit take (mixed over the panel by opacity). */
const REACHED_OPACITY = 0.32

export function palette(dark: boolean): Palette {
  return dark ? DARK : LIGHT
}

// ---- drawing ----

/** The ground: svg root, a flat panel "gradient" (id `${id}P`, both stops the panel), no border. */
function ground(w: number, h: number, p: Palette, id: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
    `font-family="${esc(FONT)}" style="font-variant-numeric:tabular-nums">` +
    `<defs><linearGradient id="${id}P" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.panel}"/><stop offset="1" stop-color="${p.panel}"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#${id}P)"/>` + body + '</svg>'
}

const PIPS = 10

/** How many of the ten pips are lit: rounded, but never zero for a reading above zero. */
export function litCount(frac: number): number {
  const f = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0
  if (f <= 0) return 0
  return Math.min(PIPS, Math.max(1, Math.round(f * PIPS)))
}

type Pip = { size: number; gap: number }
const pipsW = (g: Pip, one = false) => (one ? g.size : g.size * PIPS + g.gap * (PIPS - 1))

/**
 * Ten rounded squares centred on `cy`: the first `lit` in the fill colour, the rest track.
 * With `one`, a single status pip: lit in the fill colour when anything is left.
 */
function pips(x: number, cy: number, g: Pip, b: Block, p: Palette, one = false): string {
  const count = one ? 1 : PIPS
  const lit = b.r.fill === 'none' ? 0 : one ? Math.min(1, litCount(b.r.frac)) : litCount(b.r.frac)
  const on = fillPaint(b.r.fill, p)
  const y = cy - g.size / 2
  const rx = r1(Math.max(1, g.size * 0.28))
  let s = ''
  for (let i = 0; i < count; i++) {
    const px = x + i * (g.size + g.gap)
    const isOn = i < lit
    const fill = isOn ? on : b.reached ? p.low : p.track
    const op = !isOn && b.reached ? ` fill-opacity="${REACHED_OPACITY}"` : ''
    s += `<rect x="${r1(px)}" y="${r1(y)}" width="${g.size}" height="${g.size}" rx="${rx}" fill="${fill}"${op}/>`
  }
  return s
}

// ---- layout ----

const CY = BAND_H / 2
const LABEL_Z = 11
const VALUE_Z = 13
const TAIL_Z = 12
/** Space after the label, after the pips, and before the tail. */
const GAP_LABEL = 7
const GAP_PIPS = 9
const GAP_TAIL = 7
/** Baseline that puts the middle of the digits on the pip centre line. */
const BASE = CY + 4.5

type Block = { r: Readout; label: string; isCache: boolean; reached: boolean }
/** What one block draws at a given step of the narrowing ladder; `level` 0 is the fullest. */
type Choice = { level: number; label: boolean; value: string; tail: string; one?: boolean }

/**
 * Text options for a block, fullest first. Levels: 0 value, unit word and full tail; 1 the
 * short tail (time only); 2 no tail; 3 no unit word; 4 the cache minutes without "hot";
 * 5 one status pip instead of ten; 6 no label either. A block whose options collapse keeps
 * the lowest level of each distinct look.
 */
function options(b: Block): Choice[] {
  const r = b.r
  const unit = r.unit ? `${r.value} ${r.unit}` : r.value
  const full = bandTail(r, b.isCache)
  // The short tail keeps only the time ("limit reached" is also said by the red-tinted pips).
  const short = b.isCache ? full : r.detail.replace(/^.*resets in /, '').replace(/^limit reached$/, '')
  const bare = b.isCache && r.value.startsWith('hot ') ? r.value.slice(4) : r.value
  // A reached limit keeps its percent (0%) like every other look, and says "limit reached"
  // in words while there is room; the narrower levels fall back to the time only.
  const first: Choice = b.reached
    ? { level: 0, label: true, value: r.value, tail: r.detail.replace(/resets in /, '') }
    : { level: 0, label: true, value: unit, tail: full }
  const all: Choice[] = [
    first,
    { level: 1, label: true, value: unit, tail: short },
    { level: 2, label: true, value: unit, tail: '' },
    { level: 3, label: true, value: r.value, tail: '' },
    { level: 4, label: true, value: bare, tail: '' },
    { level: 5, label: true, value: bare, tail: '', one: true },
    { level: 6, label: false, value: bare, tail: '', one: true },
  ]
  const key = (c: Choice) => `${c.label}|${c.value}|${c.tail}|${!!c.one}`
  return all.filter((c, i) => all.findIndex(d => key(d) === key(c)) === i)
}

/** Space after the label and after the pips, by pip size: tighter when the pips are small. */
const gaps = (g: Pip) => (g.size >= 6 ? { label: GAP_LABEL, pips: GAP_PIPS } : { label: 5, pips: 6 })

function choiceW(b: Block, c: Choice, g: Pip): number {
  const gp = gaps(g)
  let w = pipsW(g, c.one) + gp.pips + textW(c.value, VALUE_Z)
  if (c.label) w += textW(b.label, LABEL_Z) + gp.label
  if (c.tail) w += GAP_TAIL + textW(c.tail, TAIL_Z)
  return w
}

/** The colour of the trailing words: red when the limit is reached, else muted. */
const tailFill = (t: string, p: Palette) => (t.startsWith('limit reached') ? p.lowText : p.muted)

/** Draws one block from `x`: label, pips, value, tail, all on the one centre line. */
function drawBlock(x: number, b: Block, c: Choice, g: Pip, p: Palette): string {
  const gp = gaps(g)
  let at = x
  let s = ''
  if (c.label) {
    s += text(at, BASE - 0.5, [{ text: b.label, fill: p.muted }], { size: LABEL_Z, weight: 500 })
    at += textW(b.label, LABEL_Z) + gp.label
  }
  s += pips(at, CY, g, b, p, c.one)
  at += pipsW(g, c.one) + gp.pips
  const spans: Span[] = [{ text: c.value, fill: p.text }]
  // A cold cache reads as one phrase: "cold, expired".
  if (c.tail && b.r.value === 'cold') spans.push({ text: ', ' + c.tail, fill: p.muted, size: TAIL_Z })
  else if (c.tail) spans.push({ text: c.tail, fill: tailFill(c.tail, p), size: TAIL_Z, dx: GAP_TAIL })
  s += text(at, BASE, spans, { size: VALUE_Z, weight: 400 })
  return b.r.dim ? `<g opacity=".7">${s}</g>` : s
}

const P7: Pip = { size: 7, gap: 2.5 }
const P6: Pip = { size: 6, gap: 2 }
const P5: Pip = { size: 5, gap: 2 }
const P4: Pip = { size: 4, gap: 1.5 }
const P3: Pip = { size: 3, gap: 1 }
/**
 * The narrowing ladder: (pip size, deepest level a block may drop to). The reset time goes
 * before the pips shrink much, the unit word before the label; when even 4 px pips do not fit
 * each row becomes one status pip, and the label goes last of all.
 */
const LADDER: [Pip, number][] = [
  [P7, 0], [P6, 0], [P7, 1], [P6, 1], [P5, 1], [P6, 2], [P5, 2], [P5, 3], [P5, 4], [P4, 4], [P6, 5], [P5, 6],
]

/** The strip above the prompt. `W` is the finished pixel width; `idTag` is the svg id letter. */
export function band(v: View, W: number, dark: boolean, idTag: string = ID_TAG): Art {
  const p = palette(dark)
  const id = 'uh' + idTag + (dark ? 'd' : 'l') + 'b'
  const H = BAND_H
  const pad = W < 420 ? 6 : W < 560 ? 8 : 12
  const minGap = W < 420 ? 10 : W < 560 ? 12 : 18
  const cache: Block = { r: cacheReadout(v, p), label: 'cache', isCache: true, reached: false }
  const win = (r: Readout, w: WindowView): Block => ({ r, label: r.short, isCache: false, reached: 'exceeded' in w && w.exceeded })
  const blocks: Block[] = limitsNa(v)
    ? [{ r: { ...windowReadout(v.fiveHour, p), value: 'n/a' }, label: 'limits', isCache: false, reached: false }, cache]
    : [win(windowReadout(v.fiveHour, p), v.fiveHour), win(windowReadout(v.sevenDay, p), v.sevenDay), cache]
  const n = blocks.length
  const room = W - pad * 2 - minGap * (n - 1)
  const opts = blocks.map(options)

  // The two windows narrow together so they always read alike; the cache narrows on its own.
  const groups: number[][] = n === 3 ? [[0, 1], [2]] : [[0], [1]]
  // Walk the ladder; at each step narrow the widest group one option at a time until all fit.
  let g = P3
  let pick: number[] = blocks.map(() => opts[0]!.length - 1)
  for (const [pg, deepest] of LADDER) {
    const at = blocks.map(() => 0)
    const w = (i: number) => choiceW(blocks[i]!, opts[i]![at[i]!]!, pg)
    const total = () => blocks.reduce((s, _, i) => s + w(i), 0)
    const next = (i: number) => opts[i]![at[i]! + 1]
    const canDrop = (i: number) => !!next(i) && next(i)!.level <= deepest
    const gw = (grp: number[]) => Math.max(...grp.map(w))
    while (total() > room) {
      const can = groups.filter(grp => grp.some(canDrop))
      if (!can.length) break
      const grp = can.reduce((a, b) => (gw(b) > gw(a) ? b : a))
      // Every member steps down to the next level any of them has, so they stay in step.
      const lvl = Math.min(...grp.filter(canDrop).map(i => next(i)!.level))
      for (const i of grp) while (canDrop(i) && next(i)!.level <= lvl) at[i]!++
    }
    g = pg; pick = at
    if (total() <= room) break
  }

  // Even spacing: the same space at both ends and between blocks, but never under the minimums.
  const widths = blocks.map((b, i) => choiceW(b, opts[i]![pick[i]!]!, g))
  const sum = widths.reduce((s, x) => s + x, 0)
  let space = (W - sum) / (n + 1)
  let edge = space
  if (space < minGap || space < pad) { edge = pad; space = Math.max(0, (W - pad * 2 - sum) / (n - 1)) }
  let body = ''
  let x = edge
  blocks.forEach((b, i) => {
    const c = opts[i]![pick[i]!]!
    if (widths[i]! <= W - pad * 2) body += drawBlock(x, b, c, g, p)
    else {
      // Far too narrow for pips: the value alone, cut to fit.
      const t = fitText(c.value, VALUE_Z, 7, (W - pad * 2) / n)
      body += text(x, BASE, [{ text: t.text, fill: p.text }], { size: t.size })
    }
    x += widths[i]! + space
  })
  return { source: ground(W, H, p, id, body), width: W, height: H }
}
