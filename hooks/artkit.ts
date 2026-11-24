// Shared pieces of the SVG art: text measuring, the readouts the pips look draws (what each
// block says), fitting helpers and the constants of the surfaces.
// ./themes/pips imports this file (and ./data, ./format) and nothing else from the art code.
import { shownPercent, ttlMs } from './data'
import type { CacheView, View, WindowView } from './data'
import { formatDuration } from './format'

export type Art = { source: string; width: number; height: number }

/** Colours a theme draws with. Every field is read by at least one drawing or test. */
export type Palette = {
  panel: string; panel2: string; border: string; divider: string
  text: string; muted: string; faint: string
  track: string; good: string; mid: string; low: string; stale: string
  midText: string; lowText: string
  frost: string; hotText: string
  /** Optional: a theme sets these to colour the cache text red (hot) and blue (cold). */
  hotRed?: string; coldBlue?: string
}

/** What a bar is filled with: the threshold colours, the cache blue, or nothing. */
export type Fill = 'good' | 'mid' | 'low' | 'stale' | 'frost' | 'none'

/**
 * CSS pixels per cell. Svg sizes are CSS pixels while bodyColumns counts cells; the types
 * give no pixel size for a cell. Measured on the desktop app (CJ's PC): the band slot is
 * about 750 px at 99 columns. An Svg wider than its slot is scaled down (and looks small),
 * so this sits just under the slot.
 */
export const BAND_CELL_PX = 7.5
/** The band is about two text rows tall. */
export const BAND_H = 44

export const MIN = 60_000
export const FONT = "system-ui, 'Segoe UI', sans-serif"

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

/** Rounds to one decimal. */
export const r1 = (n: number) => Math.round(n * 10) / 10

export type Span = { text: string; fill: string; size?: number; weight?: number; dx?: number }
/** One text chunk of tspans; `anchor` end right-aligns the whole chunk. */
export function text(x: number, y: number, spans: Span[], o: { size: number; weight?: number; anchor?: 'end'; spacing?: number }): string {
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

/** The largest whole size in [min, max] at which `s` fits in `w`, or null. */
export function fitSize(s: string, max: number, min: number, w: number, bold = false): number | null {
  for (let z = max; z >= min; z--) if (textW(s, z, bold) <= w) return z
  return null
}

/** `s` at the largest size down to `min` that fits `w`; if none does, cut with an ellipsis. */
export function fitText(s: string, size: number, min: number, w: number, bold = false): { text: string; size: number } {
  const z = fitSize(s, size, min, w, bold) ?? min
  if (textW(s, z, bold) <= w) return { text: s, size: z }
  const cs = [...s]
  while (cs.length > 1 && textW(cs.join('') + '…', z, bold) > w) cs.pop()
  return { text: cs.join('') + '…', size: z }
}

/** True when neither window has a subscription limit to show. */
export const limitsNa = (v: View): boolean => v.fiveHour.state === 'na' && v.sevenDay.state === 'na'

// ---- what each readout says ----

export type Readout = {
  label: string; short: string
  value: string; unit: string; valueFill: string
  detail: string; extra: string
  frac: number; fill: Fill; dim: boolean
}

export function limitFill(w: Extract<WindowView, { percentLeft: number }>): Fill {
  if (w.state !== 'ok') return 'stale'
  if (w.exceeded || w.percentLeft < 20) return 'low'
  if (w.percentLeft <= 50) return 'mid'
  return 'good'
}

export function windowReadout(w: WindowView, p: Palette): Readout {
  const label = w.label === '5h' ? '5-hour' : '7-day'
  const base = { label, short: w.label, unit: '', extra: '', frac: 0, fill: 'none' as Fill, dim: false }
  if (w.state === 'none') return { ...base, value: '--', valueFill: p.muted, detail: 'no reading yet' }
  if (w.state === 'na') return { ...base, value: 'n/a', valueFill: p.muted, detail: 'no subscription limits' }
  if (w.state === 'rolled') return { ...base, value: 'reset', valueFill: p.muted, detail: 'window has reset', dim: true }
  const fill = limitFill(w)
  const valueFill = w.state !== 'ok' ? p.muted : fill === 'low' ? p.lowText : fill === 'mid' ? p.midText : p.text
  let detail = ''
  if (w.resetting) detail = 'resetting now'
  else if (w.resetsInMs !== null) detail = 'resets in ' + formatDuration(w.resetsInMs)
  if (w.exceeded) detail = detail ? 'limit reached, ' + detail : 'limit reached'
  // The colour (fill) follows the percent left; the number and bar follow the usage option.
  const shown = shownPercent(w)
  return {
    ...base, value: `${shown.percent}%`, unit: shown.word, valueFill, detail,
    frac: shown.percent / 100, fill, dim: w.state !== 'ok',
  }
}

export const COLD: Record<Extract<CacheView, { state: 'cold' }>['reason'], string> = {
  new: 'new chat', expired: 'expired', compacted: 'compacted', cleared: 'cleared',
  'resume-expired': 'expired on resume', model: 'model changed',
}

/** Whole minutes only, so the art changes at most once a minute. */
export const wholeMin = (ms: number): string => (ms < MIN ? '<1m' : Math.floor(ms / MIN) + 'm')

export function cacheReadout(v: View, p: Palette): Readout {
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

/** The cache readout with the theme's hot-red / cold-blue text, when the palette defines them. */
export function cacheTone(r: Readout, v: View, p: Palette): Readout {
  const c = v.cache.state === 'hot' ? p.hotRed : p.coldBlue
  return c ? { ...r, valueFill: c } : r
}

/** Short trailing words for the band: the reset time, or the cold reason; never the cache note. */
export function bandTail(r: Readout, isCache: boolean): string {
  if (isCache) return r.value === 'cold' ? r.detail : ''
  return [r.detail.replace(/^resets in /, ''), r.extra].filter(t => t).join(', ')
}

// ---- drawing helpers ----

/** The solid colour of a bar fill, or 'none'. */
export function fillPaint(f: Fill, p: Palette): string {
  if (f === 'good') return p.good
  if (f === 'mid') return p.mid
  if (f === 'low') return p.low
  if (f === 'stale') return p.stale
  if (f === 'frost') return p.frost
  return 'none'
}
