// The flat look. The quietest band: no card, no border, no bars. Each block is one line of
// text on a flat ground, like a well-made OS status bar: a small status dot, a muted label,
// the number, then the muted reset time. The dot is the only colour: green above 50% left,
// amber at 20-50, red under 20, grey when stale; the cache dot is green while hot, amber near
// its end, grey when cold. Hairline dividers sit between the blocks.
import type { View } from '../data'
import {
  BAND_H, FONT, MIN, bandTail, cacheReadout, esc, fitText, limitsNa, r1, text, textW, windowReadout,
} from '../artkit'
import type { Art, Palette, Readout, Span } from '../artkit'

/** Single letter in svg ids: 'uh' + ID_TAG + (dark ? 'd' : 'l') + 'b'. */
export const ID_TAG = 'f'

// ---- palette ----
// Text is neutral in every state; only `good`, `mid`, `low` and `stale` (the dot) carry hue.
const DARK: Palette = {
  panel: '#191a1c', panel2: '#191a1c', border: '#191a1c', divider: '#303236',
  text: '#e9eaec', muted: '#959aa1', faint: '#81868d',
  track: '#2a2c30', good: '#41c27a', mid: '#e8a93c', low: '#f26464', stale: '#62666d',
  midText: '#e9eaec', lowText: '#e9eaec',
  frost: '#41c27a', hotText: '#e9eaec',
}
const LIGHT: Palette = {
  panel: '#f7f7f8', panel2: '#f7f7f8', border: '#f7f7f8', divider: '#dfe1e4',
  text: '#1b1c1f', muted: '#5f646b', faint: '#6b7077',
  track: '#e6e7ea', good: '#1e9a55', mid: '#cc8a00', low: '#d93434', stale: '#a9aeb5',
  midText: '#1b1c1f', lowText: '#1b1c1f',
  frost: '#1e9a55', hotText: '#1b1c1f',
}

export function palette(dark: boolean): Palette {
  return dark ? DARK : LIGHT
}

// ---- drawing primitives ----

/** The ground: svg root, a flat panel "gradient" (id `${id}P`, both stops the panel), no border. */
function ground(w: number, h: number, p: Palette, id: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
    `font-family="${esc(FONT)}" style="font-variant-numeric:tabular-nums">` +
    `<defs><linearGradient id="${id}P" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.panel}"/><stop offset="1" stop-color="${p.panel}"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#${id}P)"/>` + body + '</svg>'
}

/** The status dot's colour. The cache is green while hot, amber in its last tenth (or minute). */
function dotColour(r: Readout, v: View | null, p: Palette): string {
  if (r.fill === 'good') return p.good
  if (r.fill === 'mid') return p.mid
  if (r.fill === 'low') return p.low
  if (r.fill === 'frost' && v && v.cache.state === 'hot') {
    const ttl = v.ttl === '1h' ? 60 * MIN : 5 * MIN
    return v.cache.leftMs <= Math.max(MIN, ttl * 0.1) ? p.mid : p.good
  }
  return p.stale
}

// ---- band ----

/** Baseline of the one text row, and the dot centred on the x-height of that row. */
const BASE = 26.5
const DOT_Y = 22.5
const DOT_R = 3.25
const DOT_W = 13
const LABEL_Z = 11.5
const VALUE_Z = 14
const UNIT_Z = 11.5
const TAIL_Z = 11.5
const LABEL_GAP = 6
const TAIL_GAP = 10

/** One way to say a block, richest first; `hot` is the cache's small leading word. */
type Variant = { label: string; hot: boolean; value: string; unit: string; tail: string }

function variantW(c: Variant): number {
  let w = DOT_W
  if (c.label) w += textW(c.label, LABEL_Z) + LABEL_GAP
  if (c.hot) w += textW('hot ', VALUE_Z)
  w += textW(c.value, VALUE_Z, true)
  if (c.unit) w += 3 + textW(c.unit, UNIT_Z)
  if (c.tail) w += TAIL_GAP + textW(c.tail, TAIL_Z)
  return w
}

/** How many limit tiers there are; the two limit blocks share one so they read alike. */
const LIMIT_TIERS = 8

/**
 * The variants of a block, richest first. Limits always give LIMIT_TIERS entries, one per tier:
 * full words, then the bare reset time, then no unit, short label, tight time, no time, number.
 */
function variants(r: Readout, isCache: boolean): Variant[] {
  const out: Variant[] = []
  const add = (label: string, hot: boolean, value: string, unit: string, tail: string) =>
    out.push({ label, hot, value, unit, tail })
  if (isCache) {
    if (r.value.startsWith('hot ')) {
      const m = r.value.slice(4)
      add(r.label, true, m, 'left', '')
      add(r.label, false, m, 'left', '')
      add(r.label, false, m, '', '')
      add('', false, m, '', '')
    } else {
      const why = bandTail(r, true)
      add(r.label, false, r.value, '', why)
      add(r.label, false, r.value, '', '')
      add('', false, r.value, '', '')
    }
    return out
  }
  // A rolled window says "reset" and needs no tail; others carry the reset time.
  const tail = r.dim && r.value === 'reset' ? '' : bandTail(r, false)
  const reached = r.detail.startsWith('limit reached')
  const time = r.detail.includes('resets in ') ? r.detail.replace(/^.*resets in /, '') : ''
  const full = tail ? r.detail : ''
  const mid = reached ? (time ? 'limit reached, ' + time : 'limit reached') : time || tail
  const short = reached ? 'limit reached' : time || tail
  const tight = time ? time.replace(/ /g, '') : reached ? 'limit' : tail
  add(r.label, false, r.value, r.unit, full)
  add(r.label, false, r.value, r.unit, mid)
  add(r.label, false, r.value, '', mid)
  add(r.label, false, r.value, '', short)
  add(r.short, false, r.value, '', short)
  add(r.short, false, r.value, '', tight)
  add(r.short, false, r.value, '', '')
  add('', false, r.value, '', '')
  return out
}

/** The first variant index that fits `w`, or the list length when none does. */
function firstFit(cs: Variant[], w: number): number {
  const i = cs.findIndex(c => variantW(c) <= w)
  return i < 0 ? cs.length : i
}

/** One block: dot, label, number (with its unit), muted tail, all on one baseline. */
function bandBlock(x: number, w: number, r: Readout, p: Palette, isCache: boolean, v: View | null, from = 0): string {
  const dot = `<circle cx="${r1(x + DOT_R)}" cy="${DOT_Y}" r="${DOT_R}" fill="${dotColour(r, v, p)}"/>`
  const valueFill = r.dim || r.value === '--' || r.value === 'n/a' ? p.muted : p.text
  const c = variants(r, isCache).slice(from).find(c => variantW(c) <= w)
  if (!c) {
    // Narrower than the bare number: the number alone, cut to fit.
    const f = fitText(r.value, VALUE_Z, 8, w, true)
    return text(x, BASE, [{ text: f.text, fill: valueFill }], { size: f.size, weight: 600 })
  }
  // One text element: the browser places each part after the last, so gaps are exact even
  // where textW (which errs wide) would leave uneven air. textW only picks the variant.
  const spans: Span[] = []
  if (c.label) spans.push({ text: c.label, fill: p.muted, size: LABEL_Z, weight: 500 })
  const lead = c.label ? LABEL_GAP : 0
  // "hot" and its minutes are separate spans joined by a dx gap (not a trailing space), so the
  // words read "hot 41m" to a reader of the svg text.
  if (c.hot) spans.push({ text: 'hot', fill: p.muted, size: VALUE_Z, weight: 400, dx: lead })
  spans.push({ text: c.value, fill: valueFill, size: VALUE_Z, weight: 600, dx: c.hot ? 4 : lead })
  if (c.unit) spans.push({ text: c.unit, fill: p.muted, size: UNIT_Z, weight: 400, dx: 3 })
  // A reached limit's words stay in the text colour; the red dot already says how bad.
  if (c.tail) spans.push({ text: c.tail, fill: c.tail.startsWith('limit reached') ? p.text : p.muted, size: TAIL_Z, weight: 400, dx: TAIL_GAP })
  const s = dot + text(x + DOT_W, BASE, spans, { size: VALUE_Z })
  return r.dim ? `<g opacity=".75">${s}</g>` : s
}

/** A hairline between two blocks, a little shorter than the text row is tall. */
const divider = (x: number, p: Palette) => `<rect x="${r1(x - 0.5)}" y="15" width="1" height="15" fill="${p.divider}"/>`

/** The strip above the prompt. `W` is the finished pixel width; `idTag` is the svg id letter. */
export function band(v: View, W: number, dark: boolean, idTag: string = ID_TAG): Art {
  const p = palette(dark)
  const id = 'uh' + idTag + (dark ? 'd' : 'l') + 'b'
  const H = BAND_H
  const pad = W < 200 ? 6 : W < 420 ? 10 : 16
  const gap = W < 200 ? 8 : W < 420 ? 14 : 24
  const inner = W - pad * 2
  const cache = cacheReadout(v, p)
  let body = ''
  if (limitsNa(v)) {
    // Both windows say the same: one wide quiet block, then the cache.
    const w1 = (inner - gap) * (2 / 3)
    const w2 = inner - gap - w1
    const r: Readout = { ...windowReadout(v.fiveHour, p), label: 'Limits', short: 'Limits', value: 'n/a', detail: 'no subscription limits' }
    body += bandBlock(pad, w1, r, p, false, null)
    if (gap >= 14) body += divider(pad + w1 + gap / 2, p)
    body += bandBlock(pad + w1 + gap, w2, cache, p, true, v)
  } else {
    const bw = (inner - gap * 2) / 3
    const reads = [windowReadout(v.fiveHour, p), windowReadout(v.sevenDay, p), cache]
    // Both limits drop words at the same step, so the two blocks read alike. A reached limit
    // has longer words; it does not set the step, it just goes on dropping from it.
    const plain = reads.slice(0, 2).filter(r => !r.detail.startsWith('limit reached'))
    const tier = Math.min(LIMIT_TIERS - 1, Math.max(0, ...plain.map(r => firstFit(variants(r, false), bw))))
    reads.forEach((r, i) => {
      const x = pad + i * (bw + gap)
      if (i > 0 && gap >= 14) body += divider(x - gap / 2, p)
      body += bandBlock(x, bw, r, p, i === 2, v, i < 2 ? tier : 0)
    })
  }
  return { source: ground(W, H, p, id, body), width: W, height: H }
}
