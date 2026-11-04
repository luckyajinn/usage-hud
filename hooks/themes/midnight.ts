// The midnight look. Deep navy-black glass: a panel with a faint top highlight and a soft
// inner glow under a hairline border, light-weight type with big tabular numerals, thin
// glowing status dots, and hairline bars filled with a cool gradient that still reads as the
// threshold state (teal-green healthy, amber warning, coral-red low, slate stale; the cache is
// the signature cyan-to-violet). Calm, premium, a little futuristic.
//
// Layout differs from clean on purpose: in the band each block puts its caps label and tail on
// a small top row, and the big numeral shares the second row with its bar, which ends in a
// bright "leading edge" cap.
import type { View } from '../data'
import {
  BAND_H, FONT, bandTail, cacheReadout, cacheTone, esc, fitText, limitsNa, r1, text, textW, windowReadout,
} from '../artkit'
import type { Art, Fill, Palette, Readout, Span } from '../artkit'

/** Single letter in svg ids: 'uh' + ID_TAG + (dark ? 'd' : 'l') + 'b'. Pinned by tests: do not change. */
export const ID_TAG = 'm'

// ---- palette ----

const DARK: Palette = {
  panel: '#090d18', panel2: '#111a2e', border: '#25314d', divider: '#1d2742',
  text: '#e9effc', muted: '#9eabc6', faint: '#8d9ab6',
  track: '#18213a', good: '#2fd6a6', mid: '#f4b54a', low: '#ff6b7d', stale: '#55617d',
  midText: '#f7c46f', lowText: '#ff8d9a',
  frost: '#38c8f0', hotText: '#8fd0ff', hotRed: '#ff7b8a', coldBlue: '#7cc4ff',
}
const LIGHT: Palette = {
  panel: '#eef2f9', panel2: '#fcfdff', border: '#cfd7e8', divider: '#dde3ef',
  text: '#0c1426', muted: '#435069', faint: '#4f5b74',
  track: '#dfe5f0', good: '#0d9b7f', mid: '#c97a00', low: '#d8344c', stale: '#a9b3c6',
  midText: '#875400', lowText: '#b91f38',
  frost: '#0a87b0', hotText: '#1257a8', hotRed: '#b81d3a', coldBlue: '#0b57b0',
}

export function palette(dark: boolean): Palette {
  return dark ? DARK : LIGHT
}

/** Each state's gradient stops: the hue drifts within the state's family, cool end on the right. */
function stops(f: Fill, dark: boolean): [string, string] {
  if (dark) {
    if (f === 'good') return ['#2fd6a6', '#36c6f0'] // green-teal into cyan
    if (f === 'mid') return ['#f4b54a', '#f78a5c'] // amber into apricot
    if (f === 'low') return ['#ff6b7d', '#f2508f'] // coral into rose
    if (f === 'stale') return ['#4b5672', '#66728f'] // slate
    return ['#38c8f0', '#9d86ff'] // frost: cyan into violet
  }
  if (f === 'good') return ['#0d9b7f', '#0a8fb5']
  if (f === 'mid') return ['#c97a00', '#d95f2b']
  if (f === 'low') return ['#d8344c', '#c42a78']
  if (f === 'stale') return ['#a9b3c6', '#bcc4d4']
  return ['#0a87b0', '#6d4ee0']
}

const FILLS: Fill[] = ['good', 'mid', 'low', 'stale', 'frost']
/** The solid colour of a state (status dots, caps), or the stale slate when it has none. */
const solid = (f: Fill, p: Palette): string => (f === 'none' ? p.stale : p[f])

// ---- the glass card ----

/**
 * The svg root and the glass: the panel gradient (`${id}P`, listed first so the pinned id test
 * finds it), a soft radial glow from the top, a 1 px highlight along the top edge, the hairline
 * border, the per-state bar gradients (`${id}F<state>`) and a small blur for glows (`${id}G`).
 */
function glass(w: number, h: number, p: Palette, dark: boolean, id: string, body: string): string {
  const grads = FILLS.map(f => {
    const [a, b] = stops(f, dark)
    return `<linearGradient id="${id}F${f}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`
  }).join('')
  const glow = dark ? '#6c7cff' : '#7aa7ff'
  const hi = dark ? '#ffffff' : '#ffffff'
  const defs =
    `<linearGradient id="${id}P" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.panel2}"/><stop offset="1" stop-color="${p.panel}"/></linearGradient>` +
    `<radialGradient id="${id}R" cx=".5" cy="0" r="1" gradientTransform="translate(0 0) scale(1 ${r1(Math.min(1, 60 / h))})"><stop offset="0" stop-color="${glow}" stop-opacity="${dark ? 0.16 : 0.12}"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id}H" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${hi}" stop-opacity="0"/><stop offset=".5" stop-color="${hi}" stop-opacity="${dark ? 0.28 : 0.9}"/><stop offset="1" stop-color="${hi}" stop-opacity="0"/></linearGradient>` +
    `<filter id="${id}G" x="-50%" y="-300%" width="200%" height="700%"><feGaussianBlur stdDeviation="1.6"/></filter>` +
    grads
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
    `font-family="${esc(FONT)}" style="font-variant-numeric:tabular-nums">` +
    `<defs>${defs}</defs>` +
    `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="10" fill="url(#${id}P)"/>` +
    `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="10" fill="url(#${id}R)"/>` +
    `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="10" fill="none" stroke="${p.border}" stroke-width="1"/>` +
    `<rect x="10" y="1" width="${Math.max(0, w - 20)}" height="1" fill="url(#${id}H)"/>` +
    body + '</svg>'
}

// ---- marks ----

/** A thin glowing status dot: a halo ring, a blurred glow and a bright core. */
function dot(cx: number, cy: number, f: Fill, p: Palette, id: string): string {
  const c = solid(f, p)
  const lit = f !== 'none' && f !== 'stale'
  return (lit ? `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="3" fill="${c}" opacity=".7" filter="url(#${id}G)"/>` : '') +
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="3.4" fill="none" stroke="${c}" stroke-opacity=".45" stroke-width="1"/>` +
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="1.7" fill="${c}"/>`
}

/**
 * A hairline bar: the track, then the gradient fill with a soft glow under it and a bright cap at
 * its leading edge. A fraction above zero always shows at least a short stub.
 */
function bar(x: number, y: number, w: number, h: number, frac: number, f: Fill, p: Palette, id: string): string {
  let s = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${h}" rx="${h / 2}" fill="${p.track}"/>`
  const fr = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0
  // An emptied window (limit reached): the whole track glows faintly in the low colour.
  if (fr === 0 && f === 'low') s += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${h}" rx="${h / 2}" fill="url(#${id}Flow)" opacity=".3"/>`
  if (fr > 0 && f !== 'none') {
    const fw = Math.max(h * 2, w * fr)
    const lit = f !== 'stale'
    if (lit) s += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(fw)}" height="${h}" rx="${h / 2}" fill="url(#${id}F${f})" opacity=".55" filter="url(#${id}G)"/>`
    s += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(fw)}" height="${h}" rx="${h / 2}" fill="url(#${id}F${f})"/>`
    if (lit) s += `<circle cx="${r1(x + fw - h / 2)}" cy="${r1(y + h / 2)}" r="${r1(h * 0.9)}" fill="${stops(f, p === DARK)[1]}" stroke="${p === DARK ? '#ffffff' : p.panel2}" stroke-opacity=".7" stroke-width=".8"/>`
  }
  return s
}

/** Hero spans: "hot" as a small muted word before the cache minutes, else the value alone. */
function heroSpans(r: Readout, value: string, z: number, p: Palette): { spans: Span[]; w: number } {
  if (value.startsWith('hot ')) {
    const small = Math.round(z * 0.5)
    const num = value.slice(4)
    return {
      spans: [{ text: 'hot', fill: r.valueFill, size: small, weight: 400 },{ text: num, fill: r.valueFill, dx: 4 }],
      w: textW('hot', small) + 4 + textW(num, z),
    }
  }
  return { spans: [{ text: value, fill: r.valueFill }], w: textW(value, z) }
}

// ---- band ----

const TOP = 14 // baseline of the top row (dot, caps label, tail)
const HERO = 36 // baseline of the numeral row
const BAR_H = 3
const BAR_Y = 29 // the bar sits level with the middle of the numerals
const DOT_W = 11
const LABEL_Z = 9.5
const LABEL_SP = 1.4
const TAIL_Z = 10.5
const BAR_MIN = 22

const capsW = (s: string, z = LABEL_Z) => textW(s, z) + s.length * LABEL_SP

/**
 * One band block. Top row: dot, caps label, and the muted tail at the right, longest first and
 * dropped when it would touch the label. Second row: the light numeral, then its bar; when the
 * block is too narrow for both, the bar drops to a hairline under the numeral.
 */
/** The value candidates of a block, longest first ("hot 52m" may shorten to "52m"). */
const heroValues = (r: Readout, isCache: boolean): string[] =>
  isCache && r.value.startsWith('hot ') ? [r.value, r.value.slice(4)] : [r.value]
const HERO_INLINE_MIN = 14
/** True when some value of the block fits beside an inline bar at a readable size. */
const fitsInline = (r: Readout, w: number, isCache: boolean, p: Palette): boolean =>
  heroValues(r, isCache).some(v => heroSpans(r, v, HERO_INLINE_MIN, p).w <= w - BAR_MIN - 8)

function bandBlock(x: number, w: number, r: Readout, p: Palette, id: string, compact: boolean, isCache: boolean, inlineOk: boolean): string {
  let s = ''
  // Top row.
  const wantDot = w >= 70
  const lx = x + (wantDot ? DOT_W : 0)
  const labels = [r.label, r.short].map(l => l.toUpperCase())
  const label = (compact ? labels.slice(1) : labels).find(l => lx + capsW(l) <= x + w) ?? labels.find(l => lx + capsW(l) <= x + w)
  if (wantDot) s += dot(x + 3.4, TOP - 3.3, r.fill, p, id)
  let used = lx
  if (label) {
    s += text(lx, TOP, [{ text: label, fill: p.muted }], { size: LABEL_Z, weight: 500, spacing: LABEL_SP })
    used = lx + capsW(label)
  }
  const room = x + w - used - 10
  const full = [r.detail, r.extra].filter(t => t).join(', ')
  const short = [r.detail.replace(/resets in /, ''), r.detail.replace(/^.*resets in /, '')]
  const tails = isCache
    ? [bandTail(r, true)]
    : r.dim ? [full, bandTail(r, false), r.extra, ...short] : [full, bandTail(r, false), ...short, r.extra]
  const tail = tails.find(t => t && textW(t, TAIL_Z) <= room)
  if (tail) s += text(x + w, TOP, [{ text: tail, fill: p.muted }], { size: TAIL_Z, anchor: 'end' })

  // Numeral row: the largest size that leaves room for an inline bar, else (decided for the
  // whole band so the three blocks match) the bar drops under the numeral.
  const values = heroValues(r, isCache)
  const max = compact ? 19 : 22
  let pick: { value: string; z: number; inline: boolean } | undefined
  for (const inline of inlineOk ? [true, false] : [false]) {
    const avail = w - (inline ? BAR_MIN + 8 : 0)
    const min = inline ? HERO_INLINE_MIN : 12
    const top = inline ? max : Math.min(max, 17)
    for (const v of values) {
      for (let z = top; z >= min && !pick; z--) if (heroSpans(r, v, z, p).w <= avail) pick = { value: v, z, inline }
      if (pick) break
    }
    if (pick) break
  }
  if (pick) {
    const h = heroSpans(r, pick.value, pick.z, p)
    s += text(x, HERO, h.spans, { size: pick.z, weight: 300 })
    if (pick.inline) {
      const bx = x + h.w + 8
      s += bar(bx, BAR_Y, x + w - bx, BAR_H, r.frac, r.fill, p, id)
    } else {
      s += bar(x, 39.5, w, 2, r.frac, r.fill, p, id)
    }
  } else {
    const t = fitText(values[values.length - 1]!, 13, 7, w)
    s += text(x, HERO - 2, [{ text: t.text, fill: r.valueFill }], { size: t.size, weight: 300 })
    s += bar(x, 39.5, w, 2, r.frac, r.fill, p, id)
  }
  return r.dim ? `<g opacity=".8">${s}</g>` : s
}

/** The strip above the prompt. `W` is the finished pixel width; `idTag` is the svg id letter. */
export function band(v: View, W: number, dark: boolean, idTag: string = ID_TAG): Art {
  const p = palette(dark)
  const id = 'uh' + idTag + (dark ? 'd' : 'l') + 'b'
  const H = BAND_H
  const pad = W < 200 ? 6 : W < 420 ? 11 : 16
  const gap = W < 200 ? 7 : W < 420 ? 14 : 26
  const compact = W < 560
  const inner = W - pad * 2
  const cache = cacheTone(cacheReadout(v, p), v, p)
  let body = ''
  // Hairline separators between blocks, fading top and bottom, only when there is room.
  const sep = (x: number) => gap >= 14 ? `<rect x="${r1(x)}" y="9" width="1" height="${H - 18}" fill="${p.divider}"/>` : ''
  if (limitsNa(v)) {
    // Both windows say the same: one wide quiet block (no label row clutter), then the cache.
    const w1 = (inner - gap) * (2 / 3)
    const w2 = inner - gap - w1
    const wantDot = w1 >= 70
    if (wantDot) body += dot(pad + 3.4, TOP - 3.3, 'none', p, id)
    const lab = 'NO SUBSCRIPTION LIMITS'
    const lx = pad + (wantDot ? DOT_W : 0)
    if (lx + capsW(lab) <= pad + w1) body += text(lx, TOP, [{ text: lab, fill: p.muted }], { size: LABEL_Z, weight: 500, spacing: LABEL_SP })
    const t = fitText('Limits n/a', compact ? 17 : 19, 8, w1)
    body += text(pad, HERO, [{ text: t.text, fill: p.muted }], { size: t.size, weight: 300 })
    const bx = pad + textW(t.text, t.size) + 8
    if (pad + w1 - bx >= BAR_MIN) body += bar(bx, BAR_Y, pad + w1 - bx, BAR_H, 0, 'none', p, id)
    body += sep(pad + w1 + gap / 2)
    body += bandBlock(pad + w1 + gap, w2, cache, p, id, compact, true, fitsInline(cache, w2, true, p))
  } else {
    const bw = (inner - gap * 2) / 3
    const reads = [windowReadout(v.fiveHour, p), windowReadout(v.sevenDay, p), cache]
    const inlineOk = reads.every((r, i) => fitsInline(r, bw, i === 2, p))
    reads.forEach((r, i) => {
      const x = pad + i * (bw + gap)
      if (i > 0) body += sep(x - gap / 2)
      body += bandBlock(x, bw, r, p, id, compact, i === 2, inlineOk)
    })
  }
  return { source: glass(W, H, p, dark, id, body), width: W, height: H }
}
