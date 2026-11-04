// The mono look. Swiss-minimal monochrome: a flat near-black (or white) ground, no card chrome,
// and typography doing the work: large light numerals, tiny tracked uppercase labels, plenty of
// air. Bars are sliders: a 2 px hairline track with a solid marker at the amount left. Colour
// is a single accent and only means trouble: neutral when healthy (>50%), amber at 20-50,
// red under 20, mid grey when a reading is stale. Healthy stays quiet; trouble stands out.
import type { View } from '../data'
import {
  BAND_H, bandTail, cacheReadout, esc, fitSize, fitText, limitsNa, r1, text, textW, windowReadout, wrapText,
} from '../artkit'
import type { Art, Fill, Palette, Readout, Span, Version } from '../artkit'

/** Single letter in svg ids: 'uh' + ID_TAG + (dark ? 'd' : 'l') + ('b' | 'p'). */
export const ID_TAG = 'o'

/** Neo-grotesk first, then the platform sans; light weights carry the numerals. */
const FONT = "'Helvetica Neue', 'Segoe UI', system-ui, sans-serif"

// ---- palette ----
// `good` and `frost` are neutral on purpose: a healthy marker is just white (or black).
const DARK: Palette = {
  panel: '#0c0c0d', panel2: '#0c0c0d', border: '#222224', divider: '#232325',
  text: '#f4f4f4', muted: '#a6a6a6', faint: '#8c8c8c',
  track: '#38383b', good: '#f4f4f4', mid: '#f2a531', low: '#ff4f4f', stale: '#6b6b6e',
  midText: '#f5b14a', lowText: '#ff6e6e',
  frost: '#d6d6d6', hotText: '#f4f4f4',
}
const LIGHT: Palette = {
  panel: '#ffffff', panel2: '#ffffff', border: '#e6e6e6', divider: '#e8e8e8',
  text: '#111111', muted: '#545454', faint: '#6b6b6b',
  track: '#d0d0d0', good: '#111111', mid: '#d98a00', low: '#e0261f', stale: '#a9a9a9',
  midText: '#985800', lowText: '#c41d18',
  frost: '#2e2e2e', hotText: '#111111',
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

/** The one accent a readout gets: neutral, amber, red, grey; null when there is no marker. */
function accent(f: Fill, p: Palette): string | null {
  if (f === 'good') return p.good
  if (f === 'mid') return p.mid
  if (f === 'low') return p.low
  if (f === 'stale') return p.stale
  if (f === 'frost') return p.frost
  return null
}

/**
 * The slider: a 2 px hairline track, end ticks, optional threshold ticks at 20 and 50, and a
 * solid round marker at the amount left. No marker when there is nothing to mark (n/a, cold).
 */
function slider(x: number, cy: number, w: number, r: Readout, p: Palette, o: { rad: number; ticks: boolean }): string {
  const y = cy - 1
  let s = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="2" fill="${p.track}"/>`
  const tick = (tx: number, th: number) => `<rect x="${r1(tx - 0.5)}" y="${r1(cy - th / 2)}" width="1" height="${th}" fill="${p.track}"/>`
  s += tick(x + 0.5, 7) + tick(x + w - 0.5, 7)
  if (o.ticks) s += tick(x + w * 0.2, 5) + tick(x + w * 0.5, 5)
  const c = accent(r.fill, p)
  if (c) {
    const fr = Number.isFinite(r.frac) ? Math.min(1, Math.max(0, r.frac)) : 0
    const mx = x + o.rad + (w - o.rad * 2) * fr
    // A panel-coloured halo cuts the track around the marker, so it reads as sitting on it.
    s += `<circle cx="${r1(mx)}" cy="${r1(cy)}" r="${o.rad + 2}" fill="${p.panel}"/>`
    s += `<circle cx="${r1(mx)}" cy="${r1(cy)}" r="${o.rad}" fill="${c}"/>`
  }
  return s
}

/** Tracked caps: textW plus the letter-spacing the text gets. */
const capsW = (s: string, size: number, spacing: number) => textW(s, size, true) + spacing * [...s].length

/** The colour of the trailing words: red when the limit is reached, else muted. */
const tailFill = (t: string, p: Palette) => (t.startsWith('limit reached') ? p.lowText : p.muted)

// ---- band ----

const B_LABEL_Y = 14
const B_LABEL_Z = 9
const B_SPACE = 1.4
const B_NUM_Y = 37
const B_TRACK_Y = 29.5
const B_TAIL_Z = 10.5

/**
 * One band block, two rows. Top: tiny tracked caps label left, the tail (reset time, as-of
 * note, cold reason) right. Bottom: the light numeral, then the slider filling the rest.
 * Priority when narrow: numeral, then label, then slider, then tail.
 */
function bandBlock(x: number, w: number, r: Readout, p: Palette, compact: boolean, isCache: boolean): string {
  let s = ''
  // Top row: label, then the longest tail that still fits beside it.
  const labels = [r.label.toUpperCase(), r.short.toUpperCase()]
  const label = labels.find(l => capsW(l, B_LABEL_Z, B_SPACE) <= w)
  let lw = 0
  if (label) {
    s += text(x, B_LABEL_Y, [{ text: label, fill: p.muted }], { size: B_LABEL_Z, weight: 600, spacing: B_SPACE })
    lw = capsW(label, B_LABEL_Z, B_SPACE) + 10
  }
  const full = [r.detail, r.extra].filter(t => t).join(', ')
  // A reached limit keeps its words ahead of the bare reset time.
  const reached = r.detail.startsWith('limit reached') ? ['limit reached'] : []
  const short = [r.detail.replace(/resets in /, ''), ...reached, r.detail.replace(/^.*resets in /, '')]
  const tails = isCache
    ? [bandTail(r, true)]
    : r.dim ? [full, bandTail(r, false), r.extra, ...short] : [full, bandTail(r, false), ...short, r.extra]
  const tail = tails.find(t => t && textW(t, B_TAIL_Z) <= w - lw)
  if (tail) s += text(x + w, B_LABEL_Y, [{ text: tail, fill: tailFill(tail, p) }], { size: B_TAIL_Z, anchor: 'end' })

  // Bottom row: "hot" is a small word before the cache minutes.
  const word = isCache && r.value.startsWith('hot ') ? 'hot' : ''
  const num = word ? r.value.slice(4) : r.value
  const wordZ = 10
  const wordW = word ? textW(word, wordZ) + 4 : 0
  const max = compact ? 21 : 24
  // Keep room for a slider of at least 28 px if the numeral can be a little smaller for it.
  const SL = 28
  let z = fitSize(num, max, 13, w - wordW - SL - 10)
  const withSlider = z !== null
  z ??= fitSize(num, max, 9, w - wordW)
  let numText = num
  let showWord = !!word
  if (z === null) {
    showWord = false
    const f = fitText(num, 13, 8, w)
    z = f.size; numText = f.text
  }
  const spans: Span[] = []
  if (showWord) spans.push({ text: word, fill: p.muted, size: wordZ, weight: 400 })
  spans.push({ text: numText, fill: r.valueFill, dx: showWord ? 4 : 0 })
  s += text(x, B_NUM_Y, spans, { size: z, weight: 300 })
  if (withSlider) {
    const sx = x + (showWord ? wordW : 0) + textW(numText, z) + 10
    s += slider(sx, B_TRACK_Y, x + w - sx, r, p, { rad: 3.5, ticks: !isCache && x + w - sx >= 60 })
  }
  return r.dim ? `<g opacity=".85">${s}</g>` : s
}

/** The strip above the prompt. `W` is the finished pixel width; `idTag` is the svg id letter. */
export function band(v: View, W: number, dark: boolean, idTag: string = ID_TAG): Art {
  const p = palette(dark)
  const id = 'uh' + idTag + (dark ? 'd' : 'l') + 'b'
  const H = BAND_H
  const pad = W < 200 ? 6 : W < 420 ? 12 : 18
  const gap = W < 200 ? 8 : W < 420 ? 18 : 36
  const compact = W < 560
  const inner = W - pad * 2
  const cache = cacheReadout(v, p)
  let body = ''
  if (limitsNa(v)) {
    // Both windows say the same: one wide quiet block (an empty slider), then the cache.
    const w1 = (inner - gap) * (2 / 3)
    const w2 = inner - gap - w1
    const r: Readout = { ...windowReadout(v.fiveHour, p), label: '5-hour · 7-day', short: 'Limits', value: 'Limits n/a', detail: 'no subscription limits' }
    body += bandBlock(pad, w1, r, p, compact, false)
    body += bandBlock(pad + w1 + gap, w2, cache, p, compact, true)
  } else {
    const bw = (inner - gap * 2) / 3
    const reads = [windowReadout(v.fiveHour, p), windowReadout(v.sevenDay, p), cache]
    reads.forEach((r, i) => { body += bandBlock(pad + i * (bw + gap), bw, r, p, compact, i === 2) })
    // Hairline column rules in the gutters: the Swiss grid, barely there.
    if (gap >= 18) for (const i of [1, 2]) {
      const gx = pad + i * (bw + gap) - gap / 2
      body += `<rect x="${r1(gx)}" y="9" width="1" height="28" fill="${p.divider}"/>`
    }
  }
  body += `<rect x="0" y="${H - 1}" width="${W}" height="1" fill="${p.divider}"/>`
  return { source: ground(W, H, p, id, body), width: W, height: H }
}

// ---- pane ----

/** The docked pane: a tracked caps title over a hairline, three numbered blocks, a quiet footer. */
export function pane(v: View, W: number, dark: boolean, version: Version, idTag: string = ID_TAG): Art {
  const p = palette(dark)
  const id = 'uh' + idTag + (dark ? 'd' : 'l') + 'p'
  const narrow = W < 260
  const pad = narrow ? 14 : 24
  const big = narrow ? 44 : 60
  const inner = W - pad * 2
  const dsize = narrow ? 11 : 12
  const lh = narrow ? 14 : 16
  const capZ = narrow ? 9 : 9.5
  const capS = narrow ? 1.4 : 1.8
  const hairline = (y: number) => `<rect x="${pad}" y="${r1(y)}" width="${inner}" height="1" fill="${p.divider}"/>`
  let body = ''

  // Title: tiny tracked caps, then the only rule above the blocks.
  let y = narrow ? 24 : 32
  const title = fitText('USAGE LEFT', capZ, 8, inner, true)
  body += text(pad, y, [{ text: title.text, fill: p.muted }], { size: title.size, weight: 600, spacing: capS })
  y += narrow ? 10 : 14
  body += hairline(y)
  y += narrow ? 22 : 32

  let n = 0
  const block = (r: Readout, labels: string[]): void => {
    n++
    // Label row: caps label left, the block number right in faint (dropped when tight).
    const caps = labels.map(l => l.toUpperCase())
    const idx = '0' + n
    const idxW = capsW(idx, capZ, capS)
    const label = caps.find(l => capsW(l, capZ, capS) <= inner - idxW - 10)
    let s = ''
    if (label) {
      s += text(pad, y, [{ text: label, fill: p.muted }], { size: capZ, weight: 600, spacing: capS })
      s += text(pad + inner, y, [{ text: idx, fill: p.faint }], { size: capZ, weight: 400, spacing: capS, anchor: 'end' })
    } else {
      const f = fitText(caps[caps.length - 1]!, capZ, 7, inner - caps[caps.length - 1]!.length * capS, true)
      s += text(pad, y, [{ text: f.text, fill: p.muted }], { size: f.size, weight: 600, spacing: capS })
    }

    // Hero: a thin numeral; "hot" before and "left" after are small. Shrink, then drop the unit.
    const word = r.value.startsWith('hot ') ? 'hot' : ''
    const num = word ? r.value.slice(4) : r.value
    const smallOf = (z: number) => Math.max(10, Math.round(z * 0.24))
    const widthAt = (z: number, unit: boolean) =>
      (word ? textW(word, smallOf(z)) + 6 : 0) + textW(num, z) + (unit && r.unit ? textW(r.unit, smallOf(z)) + 6 : 0)
    let z = big
    let unit = true
    while (z > 18 && widthAt(z, unit) > inner) z--
    if (widthAt(z, unit) > inner) { unit = false; z = big; while (z > 14 && widthAt(z, unit) > inner) z-- }
    const small = smallOf(z)
    const numRoom = inner - (word ? textW(word, small) + 6 : 0)
    const spans: Span[] = []
    if (word) spans.push({ text: word, fill: p.muted, size: small, weight: 400 })
    spans.push({ text: widthAt(z, unit) > inner ? fitText(num, z, 10, numRoom).text : num, fill: r.valueFill, dx: word ? 6 : 0 })
    if (unit && r.unit) spans.push({ text: r.unit, fill: p.muted, size: small, weight: 400, dx: 6 })
    const by = y + 10 + z * 0.78
    s += text(pad, by, spans, { size: z, weight: 200 })

    // Slider, full width, then the details in small muted type.
    const ty = by + (narrow ? 14 : 18)
    s += slider(pad, ty, inner, r, p, { rad: narrow ? 4 : 5, ticks: !word && r.value !== 'cold' })
    const lines = wrapText([r.detail, r.extra].filter(t => t).join(', '), dsize, inner, 3)
    let ly = ty + (narrow ? 20 : 26)
    const df = r.detail.startsWith('limit reached') ? p.lowText : p.muted
    lines.forEach((l, i) => { s += text(pad, ly + i * lh, [{ text: l, fill: df }], { size: dsize }) })
    ly += Math.max(0, lines.length - 1) * lh
    body += r.dim ? `<g opacity=".85">${s}</g>` : s
    y = ly + (narrow ? 34 : 48)
  }

  if (limitsNa(v)) {
    block({ ...windowReadout(v.fiveHour, p), label: 'Limits', detail: 'no subscription limits on this plan' }, ['Limits'])
  } else {
    const w5 = windowReadout(v.fiveHour, p)
    const w7 = windowReadout(v.sevenDay, p)
    block(w5, [w5.label, w5.short])
    block(w7, [w7.label, w7.short])
  }
  block(cacheReadout(v, p), ['Prompt cache', 'Cache'])

  // Footer: the engine the mod was tested on, and a flag for any other.
  y -= narrow ? 16 : 22
  body += hairline(y)
  y += narrow ? 18 : 22
  const fz = narrow ? 10 : 10.5
  const footText = 'tested on ' + version.tested
  const foot = fitText(footText, fz, 8, inner)
  const untested = version.actual !== null && version.actual !== version.tested
  const note = `untested engine ${version.actual ?? ''}`
  const oneLine = foot.text === footText && textW(footText + '  ' + note, fz) <= inner - 8
  const spans: Span[] = [{ text: foot.text, fill: p.faint }]
  if (untested && oneLine) spans.push({ text: note, fill: p.midText, dx: 8 })
  body += text(pad, y, spans, { size: foot.size })
  if (untested && !oneLine) {
    for (const l of wrapText(note, fz, inner, 2)) {
      y += 15
      body += text(pad, y, [{ text: l, fill: p.midText }], { size: fz })
    }
  }
  const H = Math.ceil(y + (narrow ? 16 : 22))
  return { source: ground(W, H, p, id, body), width: W, height: H }
}
