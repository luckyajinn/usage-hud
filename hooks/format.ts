// Presentation: turns a View into text segments. Pure, no engine calls.
import { ttlMs } from './data'
import type { CacheView, View, WindowView } from './data'

export type Tone = 'normal' | 'warning' | 'error' | 'success' | 'dim' | 'track'
/**
 * `num` marks a changing number (percent, countdown): drawn with tabular digits.
 * `bar` marks a bar cell run: its text is spaces, drawn with `tone` as the background.
 */
export type Seg = { text: string; tone: Tone; num?: true; bar?: true }

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const seg = (text: string, tone: Tone): Seg => ({ text, tone })
const dim = (text: string): Seg => seg(text, 'dim')
const num = (text: string, tone: Tone): Seg => ({ text, tone, num: true })

/** <1m, 14m, 2h 14m, 3d 4h. Floors; compact drops the space. */
export function formatDuration(ms: number, compact = false): string {
  const sp = compact ? '' : ' '
  if (!Number.isFinite(ms) || ms < MIN) return '<1m'
  if (ms < HOUR) return `${Math.floor(ms / MIN)}m`
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR)
    const m = Math.floor((ms % HOUR) / MIN)
    return `${h}h${sp}${m}m`
  }
  const d = Math.floor(ms / DAY)
  const h = Math.floor((ms % DAY) / HOUR)
  return `${d}d${sp}${h}h`
}

/** Largest unit only: <1m, 14m, 2h, 3d. */
function formatMajor(ms: number): string {
  if (!Number.isFinite(ms) || ms < MIN) return '<1m'
  if (ms < HOUR) return `${Math.floor(ms / MIN)}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  return `${Math.floor(ms / DAY)}d`
}

/** Hot cache time left: mm:ss under 10 minutes, else whole minutes (41m). */
export function formatLeft(ms: number): string {
  if (Number.isFinite(ms) && ms >= 10 * MIN) return `${Math.floor(ms / MIN)}m`
  return formatClock(ms)
}

/** mm:ss, seconds rounded up, capped at 60:00. */
export function formatClock(ms: number): string {
  const s = Math.min(3600, Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000)))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

type Reading = Extract<WindowView, { state: 'ok' | 'stale' | 'rolled' }>

function percentTone(w: Reading): Tone {
  if (w.state !== 'ok') return 'dim'
  if (w.exceeded || w.percentLeft < 20) return 'error'
  if (w.percentLeft <= 50) return 'warning'
  return 'normal'
}

function cacheTone(c: CacheView): Tone {
  if (c.state === 'cold') return 'dim'
  return c.leftMs <= MIN ? 'warning' : 'success'
}

/** Bar fill colour: green over 50, amber 20 to 50, red under 20; dim when not live. */
function barTone(w: Reading): Tone {
  if (w.state !== 'ok') return 'dim'
  if (w.exceeded || w.percentLeft < 20) return 'error'
  if (w.percentLeft <= 50) return 'warning'
  return 'success'
}

/** A bar `width` cells wide, `fraction` (0..1) of it filled. Any fraction above 0 fills at least one cell. */
export function bar(fraction: number, width: number, fill: Tone): Seg[] {
  const w = Math.max(0, Math.floor(width))
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  let n = Math.round(f * w)
  if (f > 0 && n === 0 && w > 0) n = 1
  const out: Seg[] = []
  if (n > 0) out.push({ text: ' '.repeat(n), tone: fill, bar: true })
  if (w - n > 0) out.push({ text: ' '.repeat(w - n), tone: 'track', bar: true })
  return out
}

function windowBar(w: WindowView, width: number): Seg[] {
  if (w.state === 'ok' || w.state === 'stale') return bar(w.percentLeft / 100, width, barTone(w))
  return bar(0, width, 'dim')
}

function cacheBar(c: CacheView, ttl: View['ttl'], width: number): Seg[] {
  if (c.state === 'cold') return bar(0, width, 'dim')
  return bar(c.leftMs / ttlMs(ttl), width, cacheTone(c))
}

const COLD_REASON: Record<Extract<CacheView, { state: 'cold' }>['reason'], string> = {
  new: 'new',
  expired: 'expired',
  compacted: 'compacted',
  cleared: 'cleared',
  'resume-expired': 'expired on resume',
  model: 'model changed',
}

const LONG_LABEL = { '5h': '5-hour', '7d': '7-day' } as const

// ---- band ----

type Tier = 1 | 2 | 3 | 4 | 5

/** Reset part of a window for a band tier; empty when nothing to say. */
function bandReset(w: Reading, tier: Tier): Seg[] {
  if (w.resetting) {
    if (tier === 1) return [dim(', resetting')]
    if (tier <= 3) return [dim(' resetting')]
    return []
  }
  if (w.resetsInMs === null) return []
  const t = w.resetsInMs
  if (tier === 1) return [dim(', resets '), num(formatDuration(t), 'dim')]
  if (tier === 2) return [num(' ' + formatDuration(t), 'dim')]
  if (tier === 3) return [num(' ' + formatDuration(t, true), 'dim')]
  if (tier === 4) return [num(' ' + formatMajor(t), 'dim')]
  return []
}

function bandWindow(w: WindowView, tier: Tier): Seg[] {
  const label: Seg[] = tier === 5 ? [] : [dim(w.label + ' ')]
  if (w.state === 'none') return [...label, dim('--')]
  if (w.state === 'na') return [...label, dim('n/a')]
  // A rolled window's old percent is wrong now: say reset instead, in every tier.
  if (w.state === 'rolled') return [...label, dim(tier === 1 ? 'has reset' : 'reset')]
  const out: Seg[] = [...label, num(`${w.percentLeft}%`, percentTone(w))]
  if (tier <= 2) out.push(dim(' left'))
  out.push(...bandReset(w, tier))
  return out
}

function bandCache(c: CacheView, tier: Tier): Seg[] {
  const label: Seg[] = tier <= 2 ? [dim('Cache ')] : []
  if (c.state === 'cold') return [...label, dim('cold')]
  const tone = cacheTone(c)
  if (tier <= 3) return [...label, num('hot ' + formatLeft(c.leftMs), tone)]
  if (tier === 4) return [num('hot ' + formatMajor(c.leftMs), tone)]
  return [seg('hot', tone)]
}

function bandTier(v: View, tier: Tier): Seg[] {
  const sep = dim(tier === 1 ? '  |  ' : tier === 5 ? ' ' : ' | ')
  const parts: Seg[][] = []
  if (v.fiveHour.state === 'na' && v.sevenDay.state === 'na') {
    parts.push([dim(tier === 5 ? 'n/a' : 'Limits n/a')])
  } else {
    parts.push(bandWindow(v.fiveHour, tier), bandWindow(v.sevenDay, tier))
  }
  parts.push(bandCache(v.cache, tier))
  const out: Seg[] = []
  parts.forEach((p, i) => {
    if (i > 0) out.push(sep)
    out.push(...p)
  })
  return out
}

/** Band row with bars: `5h [bar] 98% 2h 56m | 7d [bar] 100% 6d 23h | Cache [bar] hot 52m`. */
function barWindow(w: WindowView, width: number): Seg[] {
  const out: Seg[] = [dim(w.label + ' ')]
  if (w.state === 'none') return [...out, dim('--')]
  if (w.state === 'na') return [...out, dim('n/a')]
  out.push(...windowBar(w, width))
  if (w.state === 'rolled') return [...out, dim(' reset')]
  out.push(dim(' '), num(`${w.percentLeft}%`, percentTone(w)))
  if (w.resetting) out.push(dim(' resetting'))
  else if (w.resetsInMs !== null) out.push(num(' ' + formatDuration(w.resetsInMs), 'dim'))
  return out
}

function barTier(v: View, width: number): Seg[] {
  const sep = dim('  |  ')
  const out: Seg[] = []
  if (v.fiveHour.state === 'na' && v.sevenDay.state === 'na') out.push(dim('Limits n/a'))
  else out.push(...barWindow(v.fiveHour, width), sep, ...barWindow(v.sevenDay, width))
  out.push(sep, dim('Cache '), ...cacheBar(v.cache, v.ttl, width), dim(' '))
  if (v.cache.state === 'cold') out.push(dim('cold'))
  else out.push(num('hot ' + formatLeft(v.cache.leftMs), cacheTone(v.cache)))
  return out
}

const textLength = (segs: Seg[]): number => segs.reduce((n, s) => n + s.text.length, 0)

/** Cuts segments to at most `columns` characters; drops empty segments. */
export function truncate(segs: Seg[], columns: number): Seg[] {
  const out: Seg[] = []
  let room = Math.max(0, Math.floor(columns))
  for (const s of segs) {
    if (room <= 0) break
    const text = s.text.slice(0, room)
    room -= text.length
    if (text.length > 0) out.push(text === s.text ? s : { ...s, text })
  }
  return out
}

/** Narrower than this, the band draws nothing (the render hook then calls next). */
export const BAND_MIN_COLUMNS = 6

/** One band row: the first tier (widest first) that fits `columns`; never wider. */
export function bandSegments(v: View, columns: number): Seg[] {
  if (!(columns >= BAND_MIN_COLUMNS)) return []
  const candidates: Seg[][] = [barTier(v, 10), barTier(v, 6)]
  for (const t of [1, 2, 3, 4, 5] as const) candidates.push(bandTier(v, t))
  for (const c of candidates) if (textLength(c) <= columns) return c
  return truncate(bandTier(v, 5), columns)
}

// ---- command ----

function commandWindow(w: WindowView): string {
  const name = LONG_LABEL[w.label]
  if (w.state === 'none') return `${name}: no reading yet`
  if (w.state === 'na') return `${name}: n/a (no subscription limits)`
  let s = `${name}: ${w.percentLeft}% left`
  if (w.exceeded) s += ' (limit reached)'
  if (w.state === 'rolled') s += ', window has reset since'
  else if (w.resetting) s += ', resetting now'
  else if (w.resetsInMs !== null) s += ', resets in ' + formatDuration(w.resetsInMs)
  if (w.state !== 'ok') s += ` (as of ${formatDuration(w.ageMs)} ago)`
  return s
}

function commandCache(v: View): string {
  const c = v.cache
  if (c.state === 'cold') return `Cache: cold (${COLD_REASON[c.reason]})`
  return `Cache: hot, ${formatLeft(c.leftMs)} left of ${v.ttl} TTL`
}

/** The /usage-hud answer: 5-hour, 7-day, cache, then the estimate note. */
export function commandText(v: View): string {
  return [commandWindow(v.fiveHour), commandWindow(v.sevenDay), commandCache(v), 'Cache state is an estimate.'].join('\n')
}
