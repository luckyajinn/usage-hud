// SVG art for the clean, classic and christmas themes. Pure: a View in, an SVG string out.
// The render hook wraps the string in the surface's Svg element; the terminal draws text.
import { ttlMs } from './data'
import type { CacheView, View, WindowView } from './data'
import { commandText, formatDuration } from './format'

export type ArtTheme = 'clean' | 'classic' | 'christmas'
export type Art = { source: string; width: number; height: number }
export type Version = { tested: string; actual: string | null }

/**
 * CSS pixels per cell. Svg sizes are CSS pixels while bodyColumns counts cells; the types
 * give no pixel size for a cell. Measured on the desktop app (CJ's PC): the band slot is
 * about 750 px at 99 columns and the docked pane about 320 px at 64 columns. An Svg wider
 * than its slot is scaled down (and looks small), so these sit just under the slot.
 */
export const BAND_CELL_PX = 7.5
export const PANE_CELL_PX = 5
/** The band is about two text rows tall. */
export const BAND_H = 44

const MIN = 60_000
const FONT = "system-ui, 'Segoe UI', sans-serif"

// ---- palettes ----

export type Palette = {
  panel: string; panel2: string; border: string; divider: string
  text: string; muted: string; faint: string
  track: string; good: string; mid: string; low: string; stale: string
  midText: string; lowText: string
  frost: string; hotText: string; flakeHot: string; flakeCold: string
  stripeA: string; stripeB: string
  snow: string; snowOpacity: number
  ornaments: [string, string, string]; leaf: string; berry: string
}

const XMAS_DARK: Palette = {
  panel: '#0d2a1b', panel2: '#123322', border: '#c9a54c', divider: '#2c5a3f',
  text: '#f6f1e3', muted: '#b9cdbf', faint: '#91a998',
  track: '#1e4630', good: '#d6343f', mid: '#e2b33c', low: '#b3202a', stale: '#5d7a67',
  midText: '#f2cb63', lowText: '#ff8a80',
  frost: '#a9dcf5', hotText: '#cdeeff', flakeHot: '#e8f7ff', flakeCold: '#7b8f82',
  stripeA: '#d6343f', stripeB: '#fbf5ee',
  snow: '#ffffff', snowOpacity: 0.16,
  ornaments: ['#d6343f', '#e2b33c', '#8fd0f2'], leaf: '#3f9a5c', berry: '#e0343f',
}
const XMAS_LIGHT: Palette = {
  panel: '#fbf8ef', panel2: '#f2eedf', border: '#b58a26', divider: '#dcd3b8',
  text: '#143421', muted: '#475f4f', faint: '#55695b',
  track: '#d5e9d8', good: '#c62f3a', mid: '#d6a21c', low: '#a3161f', stale: '#a9b6ad',
  midText: '#875c00', lowText: '#a3161f',
  frost: '#5fb2dc', hotText: '#1d6a99', flakeHot: '#3b93c9', flakeCold: '#9aa79f',
  stripeA: '#c62f3a', stripeB: '#ffffff',
  snow: '#9fbccf', snowOpacity: 0.45,
  ornaments: ['#c62f3a', '#c9961a', '#3b93c9'], leaf: '#2f7d48', berry: '#c62f3a',
}
const CLASSIC_DARK: Palette = {
  panel: '#1b1d21', panel2: '#1b1d21', border: '#34383e', divider: '#2f3338',
  text: '#e6e8eb', muted: '#a2a8b0', faint: '#8a919a',
  track: '#2f333a', good: '#3fb950', mid: '#d29922', low: '#f85149', stale: '#5c636c',
  midText: '#e3b341', lowText: '#ff7b72',
  frost: '#3fb950', hotText: '#56d364', flakeHot: '#56d364', flakeCold: '#6e7681',
  stripeA: '#3fb950', stripeB: '#3fb950',
  snow: '#ffffff', snowOpacity: 0,
  ornaments: ['#a2a8b0', '#a2a8b0', '#a2a8b0'], leaf: '#3fb950', berry: '#f85149',
}
const CLASSIC_LIGHT: Palette = {
  panel: '#ffffff', panel2: '#ffffff', border: '#d6dae0', divider: '#e4e7eb',
  text: '#1f2328', muted: '#57606a', faint: '#636c76',
  track: '#e6e9ed', good: '#1f883d', mid: '#bf8700', low: '#cf222e', stale: '#b4bac2',
  midText: '#8a5d00', lowText: '#cf222e',
  frost: '#1f883d', hotText: '#1a7f37', flakeHot: '#1a7f37', flakeCold: '#8c959f',
  stripeA: '#1f883d', stripeB: '#1f883d',
  snow: '#000000', snowOpacity: 0,
  ornaments: ['#57606a', '#57606a', '#57606a'], leaf: '#1f883d', berry: '#cf222e',
}

// Clean reads only panel..lowText, frost and hotText; the festive fields (stripes, snow,
// ornaments, leaf, berry, flake colours) exist to satisfy Palette and are never drawn.
const CLEAN_DARK: Palette = {
  panel: '#14161a', panel2: '#14161a', border: '#262a31', divider: '#23272e',
  text: '#f1f3f5', muted: '#a0a7b1', faint: '#8d949e',
  track: '#262a31', good: '#3dbb78', mid: '#e0a526', low: '#ef5b5b', stale: '#5a616b',
  midText: '#e8b23a', lowText: '#ff7b7b',
  frost: '#4cb8d4', hotText: '#6dc9e0', flakeHot: '#4cb8d4', flakeCold: '#6b727c',
  stripeA: '#3dbb78', stripeB: '#3dbb78',
  snow: '#ffffff', snowOpacity: 0,
  ornaments: ['#a0a7b1', '#a0a7b1', '#a0a7b1'], leaf: '#3dbb78', berry: '#ef5b5b',
}
const CLEAN_LIGHT: Palette = {
  panel: '#ffffff', panel2: '#ffffff', border: '#e3e6ea', divider: '#eceef1',
  text: '#14161a', muted: '#4a525c', faint: '#5c646f',
  track: '#e9ecef', good: '#17894f', mid: '#c27c00', low: '#d93a3a', stale: '#b4bac2',
  midText: '#8a5a00', lowText: '#c42b2b',
  frost: '#0f8aa3', hotText: '#0a6f86', flakeHot: '#0f8aa3', flakeCold: '#9aa1ab',
  stripeA: '#17894f', stripeB: '#17894f',
  snow: '#000000', snowOpacity: 0,
  ornaments: ['#4a525c', '#4a525c', '#4a525c'], leaf: '#17894f', berry: '#d93a3a',
}

export function palette(theme: ArtTheme, dark: boolean): Palette {
  if (theme === 'christmas') return dark ? XMAS_DARK : XMAS_LIGHT
  if (theme === 'clean') return dark ? CLEAN_DARK : CLEAN_LIGHT
  return dark ? CLASSIC_DARK : CLASSIC_LIGHT
}

// ---- helpers ----

/** Escapes text for SVG content and attribute values. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** Rough text width in px for the system font; errs wide so nothing overlaps. */
export function textW(s: string, size: number, bold = false): number {
  let w = 0
  for (const ch of s) {
    if (ch === ' ') w += 0.28
    else if (/[0-9]/.test(ch)) w += 0.6
    else if (/[mwMW%]/.test(ch)) w += 0.86
    else if (/[il.,:'|!]/.test(ch)) w += 0.3
    else if (/[A-Z]/.test(ch)) w += 0.68
    else w += 0.56
  }
  return w * size * (bold ? 1.06 : 1)
}

const r1 = (n: number) => Math.round(n * 10) / 10

type Span = { text: string; fill: string; size?: number; weight?: number; dx?: number }
/** One text chunk of tspans; `anchor` end right-aligns the whole chunk. */
function text(x: number, y: number, spans: Span[], o: { size: number; weight?: number; anchor?: 'end'; spacing?: number }): string {
  const attrs = `x="${r1(x)}" y="${r1(y)}" font-size="${o.size}"` +
    (o.weight ? ` font-weight="${o.weight}"` : '') +
    (o.anchor ? ` text-anchor="${o.anchor}"` : '') +
    (o.spacing ? ` letter-spacing="${o.spacing}"` : '')
  const body = spans.map(s =>
    `<tspan fill="${s.fill}"` +
    (s.size ? ` font-size="${s.size}"` : '') +
    (s.weight ? ` font-weight="${s.weight}"` : '') +
    (s.dx ? ` dx="${s.dx}"` : '') +
    `>${esc(s.text)}</tspan>`).join('')
  return `<text ${attrs}>${body}</text>`
}

// ---- what each readout says ----

type Fill = 'candy' | 'good' | 'mid' | 'low' | 'stale' | 'frost' | 'none'
type Readout = {
  label: string; short: string
  value: string; unit: string; valueFill: string
  detail: string; extra: string
  frac: number; fill: Fill; dim: boolean
}

function limitFill(w: Extract<WindowView, { percentLeft: number }>, theme: ArtTheme): Fill {
  if (w.state !== 'ok') return 'stale'
  if (w.exceeded || w.percentLeft < 20) return 'low'
  if (w.percentLeft <= 50) return 'mid'
  return theme === 'christmas' ? 'candy' : 'good'
}

function windowReadout(w: WindowView, p: Palette, theme: ArtTheme): Readout {
  const label = w.label === '5h' ? '5-hour' : '7-day'
  const base = { label, short: w.label, unit: '', extra: '', frac: 0, fill: 'none' as Fill, dim: false }
  if (w.state === 'none') return { ...base, value: '--', valueFill: p.muted, detail: 'no reading yet' }
  if (w.state === 'na') return { ...base, value: 'n/a', valueFill: p.muted, detail: 'no subscription limits' }
  const age = w.state === 'ok' ? '' : 'as of ' + formatDuration(w.ageMs)
  if (w.state === 'rolled') return { ...base, value: 'reset', valueFill: p.muted, detail: 'window has reset', extra: age, dim: true }
  const fill = limitFill(w, theme)
  const valueFill = w.state !== 'ok' ? p.muted : fill === 'low' ? p.lowText : fill === 'mid' ? p.midText : p.text
  let detail = ''
  if (w.resetting) detail = 'resetting now'
  else if (w.resetsInMs !== null) detail = 'resets in ' + formatDuration(w.resetsInMs)
  if (w.exceeded) detail = detail ? 'limit reached, ' + detail : 'limit reached'
  return {
    ...base, value: `${w.percentLeft}%`, unit: 'left', valueFill, detail, extra: age,
    frac: w.percentLeft / 100, fill, dim: w.state !== 'ok',
  }
}

const COLD: Record<Extract<CacheView, { state: 'cold' }>['reason'], string> = {
  new: 'new chat', expired: 'expired', compacted: 'compacted', cleared: 'cleared',
  'resume-expired': 'expired on resume', model: 'model changed',
}

/** Whole minutes only, so the art changes at most once a minute. */
const wholeMin = (ms: number): string => (ms < MIN ? '<1m' : Math.floor(ms / MIN) + 'm')

function cacheReadout(v: View, p: Palette): Readout {
  const c = v.cache
  const base = { label: 'Cache', short: 'Cache', unit: '', extra: '', dim: false }
  if (c.state === 'cold') {
    return { ...base, value: 'cold', valueFill: p.faint, detail: COLD[c.reason], frac: 0, fill: 'none' }
  }
  const last = c.leftMs <= MIN
  return {
    ...base, value: 'hot ' + wholeMin(c.leftMs), valueFill: last ? p.midText : p.hotText,
    detail: `${v.ttl} cache lifetime, an estimate`, frac: (Math.max(0.5, Math.floor(c.leftMs / MIN)) * MIN) / ttlMs(v.ttl), fill: last ? 'mid' : 'frost',
  }
}

// ---- glyphs ----

/**
 * Ids carry the variant (theme, scheme, size) so two drawings on one page never
 * borrow each other's gradients; drawings of one variant share identical defs.
 */
type Kit = { theme: ArtTheme; id: string }
// The letters are pinned by tests (christmas ids): do not change them.
const KIT_TAG: Record<ArtTheme, string> = { christmas: 'x', clean: 'n', classic: 'c' }
const kitOf = (theme: ArtTheme, dark: boolean, kind: 'b' | 'p'): Kit =>
  ({ theme, id: 'uh' + KIT_TAG[theme] + (dark ? 'd' : 'l') + kind })

/** True when neither window has a subscription limit to show. */
const limitsNa = (v: View): boolean => v.fiveHour.state === 'na' && v.sevenDay.state === 'na'

function defs(p: Palette, k: Kit, h: number): string {
  let d = `<linearGradient id="${k.id}P" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.panel2}"/><stop offset="1" stop-color="${p.panel}"/></linearGradient>`
  if (k.theme === 'christmas') {
    const s = Math.max(6, Math.round(h * 0.9))
    d += `<pattern id="${k.id}C" class="stripes" width="${s}" height="${s}" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">` +
      `<rect width="${s}" height="${s}" fill="${p.stripeA}"/><rect width="${r1(s / 2)}" height="${s}" fill="${p.stripeB}"/></pattern>`
    d += `<linearGradient id="${k.id}F" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.frost}" stop-opacity=".8"/><stop offset="1" stop-color="${p.flakeHot}"/></linearGradient>`
  }
  return `<defs>${d}</defs>`
}

function fillPaint(f: Fill, p: Palette, k: Kit): string {
  if (f === 'candy') return k.theme === 'christmas' ? `url(#${k.id}C)` : p.good
  if (f === 'frost') return k.theme === 'christmas' ? `url(#${k.id}F)` : p.frost
  if (f === 'good') return p.good
  if (f === 'mid') return p.mid
  if (f === 'low') return p.low
  if (f === 'stale') return p.stale
  return 'none'
}

/** A rounded pill bar: the track, then the fill as a pill of its own (at least a dot wide). */
function pill(x: number, y: number, w: number, h: number, frac: number, f: Fill, p: Palette, k: Kit): string {
  const r = h / 2
  let s = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${h}" rx="${r}" fill="${p.track}"/>`
  const fr = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0
  if (fr > 0 && f !== 'none') {
    const fw = Math.max(h, w * fr)
    s += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(fw)}" height="${h}" rx="${r}" fill="${fillPaint(f, p, k)}"/>`
    // A soft highlight along the top of the fill.
    if (k.theme === 'christmas' && fw > h * 2) {
      s += `<rect x="${r1(x + r)}" y="${r1(y + h * 0.16)}" width="${r1(fw - h)}" height="${r1(h * 0.24)}" rx="${r1(h * 0.12)}" fill="#ffffff" opacity=".2"/>`
    }
  }
  return s
}

/** A bauble: cap, body and a glint. Anything but christmas draws a plain dot. */
function ornament(cx: number, cy: number, r: number, color: string, p: Palette, k: Kit): string {
  if (k.theme !== 'christmas') return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r * 0.6)}" fill="${color}"/>`
  return `<g class="ornament"><rect x="${r1(cx - r * 0.38)}" y="${r1(cy - r * 1.32)}" width="${r1(r * 0.76)}" height="${r1(r * 0.5)}" rx="${r1(r * 0.12)}" fill="${p.border}"/>` +
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${color}"/>` +
    `<circle cx="${r1(cx - r * 0.35)}" cy="${r1(cy - r * 0.35)}" r="${r1(r * 0.3)}" fill="#ffffff" opacity=".55"/></g>`
}

/** The cache glyph: a snowflake for christmas, a plain dot for the other themes. */
function cacheIcon(cx: number, cy: number, r: number, color: string, k: Kit): string {
  if (k.theme !== 'christmas') return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r * 0.5)}" fill="${color}"/>`
  return snowflake(cx, cy, r, color)
}

/** Six-armed snowflake with small branches. */
function snowflake(cx: number, cy: number, r: number, color: string): string {
  let d = ''
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2
    d += `M${r1(cx)} ${r1(cy)}L${r1(cx + Math.cos(a) * r)} ${r1(cy + Math.sin(a) * r)}`
    const bx = cx + Math.cos(a) * r * 0.55
    const by = cy + Math.sin(a) * r * 0.55
    for (const sg of [-1, 1]) {
      const b = a + sg * 0.75
      d += `M${r1(bx)} ${r1(by)}L${r1(bx + Math.cos(b) * r * 0.38)} ${r1(by + Math.sin(b) * r * 0.38)}`
    }
  }
  return `<path class="snowflake" d="${d}" stroke="${color}" stroke-width="${r1(Math.max(1, r * 0.17))}" stroke-linecap="round" fill="none"/>`
}

/** Holly: two pointed leaves with a centre vein, and three berries. */
function holly(cx: number, cy: number, s: number, p: Palette): string {
  // A leaf along +x, length 1, with three points each side; scaled by s.
  const leafD = 'M0 0C.12-.1.2-.26.32-.2C.38-.34.5-.36.58-.26C.66-.38.8-.36.86-.22C.94-.2 1-.1 1.05 0' +
    'C1-.1 1 .1 1.05 0C1 .1.94.2.86.22C.8.36.66.38.58.26C.5.36.38.34.32.2C.2.26.12.1 0 0Z'
  const leaf = (rot: number) =>
    `<g transform="translate(${r1(cx)} ${r1(cy)}) rotate(${rot}) scale(${r1(s)})">` +
    `<path d="${leafD}" fill="${p.leaf}"/><path d="M.06 0L.98 0" stroke="${p.panel}" stroke-opacity=".45" stroke-width=".035"/></g>`
  const berry = (dx: number, dy: number) =>
    `<circle cx="${r1(cx + dx * s)}" cy="${r1(cy + dy * s)}" r="${r1(s * 0.13)}" fill="${p.berry}"/>`
  return `<g class="holly">${leaf(200)}${leaf(-20)}${berry(-0.1, -0.12)}${berry(0.12, -0.1)}${berry(0.01, 0.07)}</g>`
}

// Snow dots: fixed fractions of the box, so the art is the same every draw.
const SNOW: [number, number, number][] = [
  [0.03, 0.22, 1.2], [0.11, 0.78, 0.9], [0.19, 0.35, 1.4], [0.27, 0.85, 1.0], [0.36, 0.15, 0.8],
  [0.44, 0.62, 1.3], [0.52, 0.28, 1.0], [0.61, 0.9, 1.2], [0.69, 0.12, 1.4], [0.77, 0.55, 0.9],
  [0.86, 0.3, 1.2], [0.94, 0.8, 1.0], [0.07, 0.5, 0.8], [0.57, 0.48, 0.8], [0.83, 0.92, 0.8],
  [0.31, 0.5, 0.9], [0.98, 0.12, 0.9], [0.48, 0.95, 1.0],
]
function snow(w: number, h: number, p: Palette, scale: number): string {
  if (p.snowOpacity <= 0) return ''
  return `<g class="snow" fill="${p.snow}" opacity="${p.snowOpacity}">` +
    SNOW.map(([fx, fy, r]) => `<circle cx="${r1(fx * w)}" cy="${r1(fy * h)}" r="${r1(r * scale)}"/>`).join('') + '</g>'
}

function frame(w: number, h: number, p: Palette, k: Kit, body: string, barH: number, snowScale: number): string {
  const rx = k.theme === 'christmas' ? 10 : 8
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
    `font-family="${esc(FONT)}" style="font-variant-numeric:tabular-nums">` +
    defs(p, k, barH) +
    `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${rx}" fill="url(#${k.id}P)" stroke="${p.border}" stroke-width="1"/>` +
    (k.theme === 'christmas' ? snow(w, h, p, snowScale) : '') +
    body + '</svg>'
}

/** One line for a reader that cannot see the art: the command readout on one line. */
export function altText(v: View): string {
  return commandText(v).split('\n').join(' ')
}

// ---- band ----

const BAND_BAR_Y = 27
const BAND_BAR_H = 9

/** Short trailing words for the band: the reset time, or the cold reason; never the cache note. */
function bandTail(r: Readout, isCache: boolean): string {
  if (isCache) return r.value === 'cold' ? r.detail : ''
  return [r.detail.replace(/^resets in /, ''), r.extra].filter(t => t).join(', ')
}

function bandBlock(x: number, w: number, r: Readout, icon: string, p: Palette, k: Kit, compact: boolean, isCache: boolean): string {
  const size = compact ? 13 : 14
  const iconW = compact ? 0 : 16
  const label = compact ? r.short : r.label
  const labelW = textW(label, 12, true)
  const valW = textW(r.value, size, true)
  const showLabel = iconW + labelW + 8 + valW <= w
  const room = w - (showLabel ? iconW + labelW + 10 : 0)
  const spans: Span[] = [{ text: r.value, fill: r.valueFill, weight: 700 }]
  const tail = bandTail(r, isCache)
  if (tail && valW + 8 + textW(tail, 11.5) <= room) spans.push({ text: tail, fill: p.muted, size: 11.5, weight: 400, dx: 7 })
  else if (r.extra && valW + 8 + textW(r.extra, 11.5) <= room) spans.push({ text: r.extra, fill: p.muted, size: 11.5, weight: 400, dx: 7 })
  let s = ''
  if (showLabel) {
    if (!compact) s += icon
    s += text(x + iconW, 18.5, [{ text: label, fill: p.muted }], { size: 12, weight: 600 })
  }
  s += text(x + w, 19, spans, { size, anchor: 'end' })
  s += pill(x, BAND_BAR_Y, w, BAND_BAR_H, r.frac, r.fill, p, k)
  return r.dim ? `<g opacity=".8">${s}</g>` : s
}

function divider(x: number, h: number, p: Palette): string {
  return `<rect x="${r1(x)}" y="9" width="1" height="${h - 18}" fill="${p.divider}"/>`
}

/** The strip above the prompt: one row of three blocks, BAND_H tall, columns * BAND_CELL_PX wide. */
export function bandSvg(v: View, columns: number, theme: ArtTheme, dark: boolean): Art {
  const p = palette(theme, dark)
  const k = kitOf(theme, dark, 'b')
  const W = Math.max(60, Math.floor(Math.floor(columns) * BAND_CELL_PX))
  if (theme === 'clean') return cleanBand(v, W, p, k)
  const H = BAND_H
  const pad = W < 420 ? 10 : 16
  const gap = W < 420 ? 14 : 28
  const compact = W < 560
  const inner = W - pad * 2
  const na = limitsNa(v)
  const cache = cacheReadout(v, p)
  const flake = (x: number) => cacheIcon(x + 6, 14, 5.5, v.cache.state === 'hot' ? p.flakeHot : p.flakeCold, k)
  let body = ''
  if (na) {
    // Both windows say the same: one wide block, then the cache.
    const w1 = (inner - gap) * (2 / 3)
    const w2 = inner - gap - w1
    if (!compact) body += ornament(pad + 6, 15, 4.5, p.ornaments[0], p, k)
    body += text(pad + (compact ? 0 : 16), 18.5, [{ text: 'Limits n/a', fill: p.muted }], { size: 12, weight: 600 })
    body += pill(pad, BAND_BAR_Y, w1, BAND_BAR_H, 0, 'none', p, k)
    body += divider(pad + w1 + gap / 2, H, p)
    const cx = pad + w1 + gap
    body += bandBlock(cx, w2, cache, flake(cx), p, k, compact, true)
  } else {
    const bw = (inner - gap * 2) / 3
    const reads = [windowReadout(v.fiveHour, p, theme), windowReadout(v.sevenDay, p, theme), cache]
    reads.forEach((r, i) => {
      const x = pad + i * (bw + gap)
      const icon = i < 2 ? ornament(x + 6, 15, 4.5, p.ornaments[i] ?? p.muted, p, k) : flake(x)
      if (i > 0) body += divider(x - gap / 2, H, p)
      body += bandBlock(x, bw, r, icon, p, k, compact, i === 2)
    })
  }
  return { source: frame(W, H, p, k, body, BAND_BAR_H, 1), width: W, height: H }
}

// ---- pane ----

/** The docked pane: a vertical card with 5-hour, 7-day and Cache blocks and a footer. */
export function paneSvg(v: View, columns: number, theme: ArtTheme, dark: boolean, version: Version): Art {
  const p = palette(theme, dark)
  const k = kitOf(theme, dark, 'p')
  const W = Math.max(120, Math.floor(Math.floor(columns) * PANE_CELL_PX))
  if (theme === 'clean') return cleanPane(v, W, p, k, version)
  const narrow = W < 360
  const pad = narrow ? 14 : 24
  const big = narrow ? 24 : 34
  const barH = narrow ? 10 : 14
  const inner = W - pad * 2
  let body = ''

  // Header: a caption and, for christmas, a holly sprig.
  const headH = narrow ? 34 : 46
  body += text(pad, headH * 0.62, [{ text: 'Usage left', fill: p.text }], { size: narrow ? 13 : 15, weight: 650 })
  if (theme === 'christmas') body += holly(W - pad - (narrow ? 14 : 20), headH * 0.5, narrow ? 13 : 19, p)
  let y = headH
  body += `<rect x="${pad}" y="${y}" width="${inner}" height="1" fill="${p.divider}"/>`
  y += narrow ? 14 : 20

  const block = (r: Readout, icon: string): void => {
    let s = icon
    s += text(pad + 18, y + 11, [{ text: r.label.toUpperCase(), fill: p.muted }], { size: 11.5, weight: 650, spacing: 1.2 })
    const by = y + 22 + big * 0.82
    const spans: Span[] = [{ text: r.value, fill: r.valueFill }]
    if (r.unit) spans.push({ text: r.unit, fill: p.muted, size: Math.round(big * 0.42), weight: 500, dx: 6 })
    s += text(pad, by, spans, { size: big, weight: 700 })
    const barY = by + (narrow ? 10 : 14)
    s += pill(pad, barY, inner, barH, r.frac, r.fill, p, k)
    const line = [r.detail, r.extra].filter(t => t).join(', ')
    const ly = barY + barH + (narrow ? 16 : 20)
    if (line) s += text(pad, ly, [{ text: line, fill: p.muted }], { size: narrow ? 11.5 : 12.5 })
    body += r.dim ? `<g opacity=".8">${s}</g>` : s
    y = ly + (narrow ? 20 : 28)
  }

  const na = limitsNa(v)
  if (na) {
    block({ ...windowReadout(v.fiveHour, p, theme), label: 'Limits' }, ornament(pad + 6, y + 7, 5, p.ornaments[0], p, k))
  } else {
    block(windowReadout(v.fiveHour, p, theme), ornament(pad + 6, y + 7, 5, p.ornaments[0], p, k))
    block(windowReadout(v.sevenDay, p, theme), ornament(pad + 6, y + 7, 5, p.ornaments[1], p, k))
  }
  const c = cacheReadout(v, p)
  block({ ...c, label: 'Prompt cache' }, cacheIcon(pad + 6, y + 7, 6.5, v.cache.state === 'hot' ? p.flakeHot : p.flakeCold, k))

  // Footer: the engine the mod was tested on, and a flag for any other.
  body += `<rect x="${pad}" y="${y - 8}" width="${inner}" height="1" fill="${p.divider}"/>`
  const foot = 'tested on ' + version.tested
  y += 12
  const spans: Span[] = [{ text: foot, fill: p.faint }]
  const untested = version.actual !== null && version.actual !== version.tested
  const note = `untested engine ${version.actual ?? ''}`
  const oneLine = textW(foot + '  ' + note, 11.5) <= inner
  if (untested && oneLine) spans.push({ text: note, fill: p.midText, dx: 8 })
  body += text(pad, y, spans, { size: 11.5 })
  if (untested && !oneLine) {
    y += 16
    body += text(pad, y, [{ text: note, fill: p.midText }], { size: 11.5 })
  }
  const H = Math.ceil(y + (narrow ? 12 : 16))
  return { source: frame(W, H, p, k, body, barH, narrow ? 1 : 1.4), width: W, height: H }
}

// ---- clean theme ----
// A quiet card: the number leads, labels are small muted caps, bars are thin solid pills,
// and the only colour is the threshold (good, mid, low, stale) and the calm cache blue.

/** The largest whole size in [min, max] at which `s` fits in `w`, or null. */
function fitSize(s: string, max: number, min: number, w: number, bold = false): number | null {
  for (let z = max; z >= min; z--) if (textW(s, z, bold) <= w) return z
  return null
}

/** `s` at the largest size down to `min` that fits `w`; if none does, cut with an ellipsis. */
function fitText(s: string, size: number, min: number, w: number, bold = false): { text: string; size: number } {
  const z = fitSize(s, size, min, w, bold) ?? min
  if (textW(s, z, bold) <= w) return { text: s, size: z }
  const cs = [...s]
  while (cs.length > 1 && textW(cs.join('') + '…', z, bold) > w) cs.pop()
  return { text: cs.join('') + '…', size: z }
}

/** Greedy word wrap into at most `maxLines` lines of width `w`; a line that still overflows is cut. */
function wrapText(s: string, size: number, w: number, maxLines: number): string[] {
  const lines: string[] = []
  // A duration like "2h 14m" stays on one line.
  const words = s.replace(/(\d+[dhm]) (?=\d+[dhm])/g, '$1\u0001').split(' ').filter(t => t).map(t => t.replace(/\u0001/g, ' '))
  for (const word of words) {
    const last = lines[lines.length - 1]
    if (last !== undefined && (textW(last + ' ' + word, size) <= w || lines.length >= maxLines)) lines[lines.length - 1] = last + ' ' + word
    else lines.push(word)
  }
  return lines.map(l => fitText(l, size, size, w).text)
}

/** The status dot of a block: its bar colour, or the stale grey when it has no bar. */
function cleanDot(cx: number, cy: number, r: Readout, p: Palette, k: Kit): string {
  const c = r.fill === 'none' ? p.stale : fillPaint(r.fill, p, k)
  return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="3" fill="${c}"/>`
}

const CLEAN_DOT_W = 11
/** The dot sits level with the middle of the caps label, whatever size the hero is. */
const CLEAN_DOT_Y = 17.5
const CLEAN_BASE = 21
const CLEAN_BAR_Y = 31
const CLEAN_BAR_H = 6
/** Blocks narrower than this drop the status dot (the bar colour still says the same). */
const CLEAN_DOT_MIN_W = 100

/**
 * One band block: dot, caps label, big value, then the muted tail at the right.
 * The label has priority over the dot and over the hero's size: a bare "98% 100% 52m" says
 * nothing. A stale reading also keeps its "as of" note when there is any way to fit it.
 */
function cleanBandBlock(x: number, w: number, r: Readout, p: Palette, k: Kit, compact: boolean, isCache: boolean): string {
  const size = compact ? 16 : 19
  const values = isCache && r.value.startsWith('hot ') ? [r.value, r.value.slice(4)] : [r.value]
  const label = (compact ? r.short : r.label).toUpperCase()
  const labelW = textW(label, 10, true) + label.length * 0.8 + 7
  const wantDot = w >= CLEAN_DOT_MIN_W
  // Room kept for the note: its width plus the 10 px margin the tail check below asks for.
  const stale = r.dim && r.extra ? textW(r.extra, 11) + 10 : 0

  type Hero = { text: string; size: number; dot: boolean; label: boolean }
  const place = (reserve: number): Hero | undefined => {
    const room = w - labelW - reserve - (wantDot ? CLEAN_DOT_W : 0)
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
      const z = fitSize(c, size, 12, w - CLEAN_DOT_W, true)
      if (z) { hero = { text: c, size: z, dot: true, label: false }; break }
    }
  }
  hero ??= { ...fitText(values[values.length - 1]!, size, 7, w, true), dot: false, label: false }

  const valW = textW(hero.text, hero.size, true)
  let at = x
  let s = ''
  if (hero.dot) { s += cleanDot(x + 3, CLEAN_DOT_Y, r, p, k); at += CLEAN_DOT_W }
  if (hero.label) {
    s += text(at, CLEAN_BASE, [{ text: label, fill: p.muted }], { size: 10, weight: 600, spacing: 0.8 })
    at += labelW
  }
  s += text(at, CLEAN_BASE, [{ text: hero.text, fill: r.valueFill }], { size: hero.size, weight: 650 })
  const room = x + w - (at + valW) - 10
  const full = [r.detail, r.extra].filter(t => t).join(', ')
  // Longest first. A stale reading prefers its "as of" note over the reset time; a reached
  // limit keeps "limit reached" and then just the time.
  const short = [r.detail.replace(/resets in /, ''), r.detail.replace(/^.*resets in /, '')]
  const tails = isCache
    ? [bandTail(r, true)]
    : r.dim ? [full, bandTail(r, false), r.extra, ...short] : [full, bandTail(r, false), ...short, r.extra]
  const tail = tails.find(t => t && textW(t, 11) <= room)
  if (tail) s += text(x + w, CLEAN_BASE, [{ text: tail, fill: p.muted }], { size: 11, anchor: 'end' })
  s += pill(x, CLEAN_BAR_Y, w, CLEAN_BAR_H, r.frac, r.fill, p, k)
  return r.dim ? `<g opacity=".8">${s}</g>` : s
}

/** The strip above the prompt in the clean look. */
function cleanBand(v: View, W: number, p: Palette, k: Kit): Art {
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
    const t = fitText('Limits n/a', 12, 8, w1 - CLEAN_DOT_W)
    body += `<circle cx="${r1(pad + 3)}" cy="${CLEAN_DOT_Y}" r="3" fill="${p.stale}"/>`
    body += text(pad + CLEAN_DOT_W, CLEAN_BASE - 1, [{ text: t.text, fill: p.muted }], { size: t.size, weight: 500 })
    body += pill(pad, CLEAN_BAR_Y, w1, CLEAN_BAR_H, 0, 'none', p, k)
    body += cleanBandBlock(pad + w1 + gap, w2, cache, p, k, compact, true)
  } else {
    const bw = (inner - gap * 2) / 3
    const reads = [windowReadout(v.fiveHour, p, 'clean'), windowReadout(v.sevenDay, p, 'clean'), cache]
    reads.forEach((r, i) => { body += cleanBandBlock(pad + i * (bw + gap), bw, r, p, k, compact, i === 2) })
  }
  return { source: frame(W, H, p, k, body, CLEAN_BAR_H, 1), width: W, height: H }
}

/** The docked pane in the clean look: header, three stacked blocks (caps label, big value, thin bar, detail), footer. */
function cleanPane(v: View, W: number, p: Palette, k: Kit, version: Version): Art {
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
    let s = cleanDot(pad + 3, y + 5, r, p, k)
    const lx = pad + CLEAN_DOT_W + 2
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
    s += pill(pad, barY, inner, barH, r.frac, r.fill, p, k)
    const lines = wrapText([r.detail, r.extra].filter(t => t).join(', '), dsize, inner, 3)
    let ly = barY + barH + (narrow ? 15 : 18)
    lines.forEach((l, i) => { s += text(pad, ly + i * lh, [{ text: l, fill: p.muted }], { size: dsize }) })
    ly += Math.max(0, lines.length - 1) * lh
    body += r.dim ? `<g opacity=".8">${s}</g>` : s
    y = ly + (narrow ? 22 : 30)
  }

  const na = limitsNa(v)
  if (na) {
    block({ ...windowReadout(v.fiveHour, p, 'clean'), label: 'Limits' }, ['Limits'])
  } else {
    const w5 = windowReadout(v.fiveHour, p, 'clean')
    const w7 = windowReadout(v.sevenDay, p, 'clean')
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
  return { source: frame(W, H, p, k, body, barH, 1), width: W, height: H }
}
