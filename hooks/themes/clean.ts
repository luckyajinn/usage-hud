// The clean look (default). A quiet card: the number leads, labels are small muted caps, bars
// are thin solid pills, and the only colour is the threshold (good, mid, low, stale) and the
// calm cache blue. Also the base the stub themes re-export until they get their own look.
import type { View } from '../data'
import {
  BAND_H, bandTail, cacheReadout, fillPaint, fitSize, fitText, frame, limitsNa, pill, r1, text, textW,
  windowReadout, wrapText,
} from '../artkit'
import type { Art, Palette, Readout, Span, Version } from '../artkit'

/** Single letter in svg ids: 'uh' + ID_TAG + (dark ? 'd' : 'l') + ('b' | 'p'). Pinned by tests: do not change. */
export const ID_TAG = 'n'

const DARK: Palette = {
  panel: '#14161a', panel2: '#14161a', border: '#262a31', divider: '#23272e',
  text: '#f1f3f5', muted: '#a0a7b1', faint: '#8d949e',
  track: '#262a31', good: '#3dbb78', mid: '#e0a526', low: '#ef5b5b', stale: '#5a616b',
  midText: '#e8b23a', lowText: '#ff7b7b',
  frost: '#4cb8d4', hotText: '#6dc9e0',
}
const LIGHT: Palette = {
  panel: '#ffffff', panel2: '#ffffff', border: '#e3e6ea', divider: '#eceef1',
  text: '#14161a', muted: '#4a525c', faint: '#5c646f',
  track: '#e9ecef', good: '#17894f', mid: '#c27c00', low: '#d93a3a', stale: '#b4bac2',
  midText: '#8a5a00', lowText: '#c42b2b',
  frost: '#0f8aa3', hotText: '#0a6f86',
}

export function palette(dark: boolean): Palette {
  return dark ? DARK : LIGHT
}

/** The status dot of a block: its bar colour, or the stale grey when it has no bar. */
function dot(cx: number, cy: number, r: Readout, p: Palette): string {
  const c = r.fill === 'none' ? p.stale : fillPaint(r.fill, p)
  return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="3" fill="${c}"/>`
}

const DOT_W = 11
/** The dot sits level with the middle of the caps label, whatever size the hero is. */
const DOT_Y = 17.5
const BASE = 21
const BAR_Y = 31
const BAR_H = 6
/** Blocks narrower than this drop the status dot (the bar colour still says the same). */
const DOT_MIN_W = 100

/**
 * One band block: dot, caps label, big value, then the muted tail at the right.
 * The label has priority over the dot and over the hero's size: a bare "98% 100% 52m" says
 * nothing. A stale reading also keeps its "as of" note when there is any way to fit it.
 */
function bandBlock(x: number, w: number, r: Readout, p: Palette, compact: boolean, isCache: boolean): string {
  const size = compact ? 16 : 19
  const values = isCache && r.value.startsWith('hot ') ? [r.value, r.value.slice(4)] : [r.value]
  const label = (compact ? r.short : r.label).toUpperCase()
  const labelW = textW(label, 10, true) + label.length * 0.8 + 7
  const wantDot = w >= DOT_MIN_W
  // Room kept for the note: its width plus the 10 px margin the tail check below asks for.
  const stale = r.dim && r.extra ? textW(r.extra, 11) + 10 : 0

  type Hero = { text: string; size: number; dot: boolean; label: boolean }
  const place = (reserve: number): Hero | undefined => {
    const room = w - labelW - reserve - (wantDot ? DOT_W : 0)
    for (const c of values) {
      const z = fitSize(c, size, 12, room, true)
      if (z) return { text: c, size: z, dot: wantDot, label: true }
    }
    return undefined
  }
  let hero = (stale ? place(stale) : undefined) ?? place(0)
  // No room for the label at all (very narrow): the value, with a dot if it fits.
  if (!hero) {
    for (const c of values) {
      const z = fitSize(c, size, 12, w - DOT_W, true)
      if (z) { hero = { text: c, size: z, dot: true, label: false }; break }
    }
  }
  hero ??= { ...fitText(values[values.length - 1]!, size, 7, w, true), dot: false, label: false }

  const valW = textW(hero.text, hero.size, true)
  let at = x
  let s = ''
  if (hero.dot) { s += dot(x + 3, DOT_Y, r, p); at += DOT_W }
  if (hero.label) {
    s += text(at, BASE, [{ text: label, fill: p.muted }], { size: 10, weight: 600, spacing: 0.8 })
    at += labelW
  }
  s += text(at, BASE, [{ text: hero.text, fill: r.valueFill }], { size: hero.size, weight: 650 })
  const room = x + w - (at + valW) - 10
  const full = [r.detail, r.extra].filter(t => t).join(', ')
  // Longest first. A stale reading prefers its "as of" note over the reset time; a reached
  // limit keeps "limit reached" and then just the time.
  const short = [r.detail.replace(/resets in /, ''), r.detail.replace(/^.*resets in /, '')]
  const tails = isCache
    ? [bandTail(r, true)]
    : r.dim ? [full, bandTail(r, false), r.extra, ...short] : [full, bandTail(r, false), ...short, r.extra]
  const tail = tails.find(t => t && textW(t, 11) <= room)
  if (tail) s += text(x + w, BASE, [{ text: tail, fill: p.muted }], { size: 11, anchor: 'end' })
  s += pill(x, BAR_Y, w, BAR_H, r.frac, r.fill, p)
  return r.dim ? `<g opacity=".8">${s}</g>` : s
}

/** The strip above the prompt. `W` is the finished pixel width; `idTag` is the svg id letter. */
export function band(v: View, W: number, dark: boolean, idTag: string = ID_TAG): Art {
  const p = palette(dark)
  const id = 'uh' + idTag + (dark ? 'd' : 'l') + 'b'
  const H = BAND_H
  const pad = W < 200 ? 5 : W < 420 ? 10 : 16
  const gap = W < 200 ? 6 : W < 420 ? 14 : 28
  const compact = W < 560
  const inner = W - pad * 2
  const cache = cacheReadout(v, p)
  const na = limitsNa(v)
  let body = ''
  if (na) {
    // Both windows say the same: one wide quiet block, then the cache.
    const w1 = (inner - gap) * (2 / 3)
    const w2 = inner - gap - w1
    const t = fitText('Limits n/a', 12, 8, w1 - DOT_W)
    body += `<circle cx="${r1(pad + 3)}" cy="${DOT_Y}" r="3" fill="${p.stale}"/>`
    body += text(pad + DOT_W, BASE - 1, [{ text: t.text, fill: p.muted }], { size: t.size, weight: 500 })
    body += pill(pad, BAR_Y, w1, BAR_H, 0, 'none', p)
    body += bandBlock(pad + w1 + gap, w2, cache, p, compact, true)
  } else {
    const bw = (inner - gap * 2) / 3
    const reads = [windowReadout(v.fiveHour, p), windowReadout(v.sevenDay, p), cache]
    reads.forEach((r, i) => { body += bandBlock(pad + i * (bw + gap), bw, r, p, compact, i === 2) })
  }
  return { source: frame(W, H, p, id, body), width: W, height: H }
}

/** The docked pane: header, three stacked blocks (caps label, big value, thin bar, detail), footer. `W` is the finished pixel width. */
export function pane(v: View, W: number, dark: boolean, version: Version, idTag: string = ID_TAG): Art {
  const p = palette(dark)
  const id = 'uh' + idTag + (dark ? 'd' : 'l') + 'p'
  const narrow = W < 360
  const pad = narrow ? 14 : 22
  const big = narrow ? 26 : 36
  const barH = narrow ? 6 : 8
  const inner = W - pad * 2
  const dsize = narrow ? 11.5 : 12.5
  const lh = narrow ? 14 : 16
  const hairline = (y: number) => `<rect x="${pad}" y="${r1(y)}" width="${inner}" height="1" fill="${p.divider}"/>`
  let body = ''

  const headH = narrow ? 36 : 46
  const head = fitText('Usage left', narrow ? 13 : 15, 10, inner, true)
  body += text(pad, headH * 0.64, [{ text: head.text, fill: p.text }], { size: head.size, weight: 600 })
  body += hairline(headH)
  let y = headH + (narrow ? 16 : 24)

  const block = (r: Readout, labels: string[]): void => {
    let s = dot(pad + 3, y + 5, r, p)
    const lx = pad + DOT_W + 2
    const caps = labels.map(l => l.toUpperCase())
    const label = caps.find(l => textW(l, 10.5, true) + l.length <= inner - (lx - pad)) ?? caps[caps.length - 1]!
    const lab = fitText(label, 10.5, 8, inner - (lx - pad), true)
    s += text(lx, y + 9, [{ text: lab.text, fill: p.muted }], { size: lab.size, weight: 600, spacing: 1 })

    // Hero: "hot" is a small word before the number; the unit trails it. Shrink, then drop the unit.
    const word = r.value.startsWith('hot ') ? 'hot' : ''
    const num = word ? r.value.slice(4) : r.value
    const widthAt = (z: number, unit: boolean) =>
      (word ? textW(word, Math.round(z * 0.42), true) + 6 : 0) + textW(num, z, true) +
      (unit && r.unit ? textW(r.unit, Math.round(z * 0.42)) + 6 : 0)
    let z = big
    let unit = true
    while (z > 14 && widthAt(z, unit) > inner) z--
    if (widthAt(z, unit) > inner) { unit = false; z = big; while (z > 12 && widthAt(z, unit) > inner) z-- }
    const small = Math.round(z * 0.42)
    const numRoom = inner - (word ? textW(word, small, true) + 6 : 0)
    const spans: Span[] = []
    if (word) spans.push({ text: word, fill: p.muted, size: small, weight: 600 })
    spans.push({ text: widthAt(z, unit) > inner ? fitText(num, z, 8, numRoom, true).text : num, fill: r.valueFill, dx: word ? 6 : 0 })
    if (unit && r.unit) spans.push({ text: r.unit, fill: p.muted, size: small, weight: 500, dx: 6 })
    const by = y + 20 + z * 0.72
    s += text(pad, by, spans, { size: z, weight: 650 })

    const barY = by + (narrow ? 10 : 13)
    s += pill(pad, barY, inner, barH, r.frac, r.fill, p)
    const lines = wrapText([r.detail, r.extra].filter(t => t).join(', '), dsize, inner, 3)
    let ly = barY + barH + (narrow ? 15 : 18)
    lines.forEach((l, i) => { s += text(pad, ly + i * lh, [{ text: l, fill: p.muted }], { size: dsize }) })
    ly += Math.max(0, lines.length - 1) * lh
    body += r.dim ? `<g opacity=".8">${s}</g>` : s
    y = ly + (narrow ? 22 : 30)
  }

  const na = limitsNa(v)
  if (na) {
    block({ ...windowReadout(v.fiveHour, p), label: 'Limits' }, ['Limits'])
  } else {
    const w5 = windowReadout(v.fiveHour, p)
    const w7 = windowReadout(v.sevenDay, p)
    block(w5, [w5.label, w5.short])
    block(w7, [w7.label, w7.short])
  }
  block(cacheReadout(v, p), ['Prompt cache', 'Cache'])

  // Footer: the engine the mod was tested on, and a flag for any other.
  body += hairline(y - 12)
  y += 6
  const footText = 'tested on ' + version.tested
  const foot = fitText(footText, 11.5, 9, inner)
  const untested = version.actual !== null && version.actual !== version.tested
  const note = `untested engine ${version.actual ?? ''}`
  const oneLine = foot.text === footText && textW(footText + '  ' + note, 11.5) <= inner - 6
  const spans: Span[] = [{ text: foot.text, fill: p.faint }]
  if (untested && oneLine) spans.push({ text: note, fill: p.midText, dx: 8 })
  body += text(pad, y, spans, { size: foot.size })
  if (untested && !oneLine) {
    for (const l of wrapText(note, 11.5, inner, 2)) {
      y += 16
      body += text(pad, y, [{ text: l, fill: p.midText }], { size: 11.5 })
    }
  }
  const H = Math.ceil(y + (narrow ? 12 : 16))
  return { source: frame(W, H, p, id, body), width: W, height: H }
}
