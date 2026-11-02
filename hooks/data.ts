// Pure data rules for usage-hud (PLAN sections 5 and 6). No `$`, no engine calls.
import type { CacheStamp, Limit, LimitsSnap, Ttl, TtlSetting } from '../types'

export type WindowView =
  | { label: '5h' | '7d'; state: 'none' }                 // no reading at all
  | { label: '5h' | '7d'; state: 'na' }                   // no subscription limits
  | { label: '5h' | '7d'; state: 'ok' | 'stale' | 'rolled';
      percentLeft: number;        // integer 0..100, floor(100 - percentUsed) clamped
      exceeded: boolean;          // percentUsed >= 100
      resetsInMs: number | null;  // null when resetsAt missing or state 'rolled'
      resetting: boolean;         // resetsAt within 60 s in the past
      ageMs: number }             // now - observedAt
export type CacheView =
  | { state: 'hot'; leftMs: number }
  | { state: 'cold'; reason: 'new' | 'expired' | 'compacted' | 'cleared' | 'resume-expired' | 'model' }
export type View = { fiveHour: WindowView; sevenDay: WindowView; cache: CacheView; ttl: Ttl }

export type ViewInput = {
  now: number
  limits: LimitsSnap | null
  live: boolean            // a measure with readings arrived in this process
  turnDone: boolean        // a main step with usage (a response) arrived in this process
  cache: CacheStamp | null
  model: string | null     // current main model (last main step), null = unknown
  ttl: Ttl
}

// Step info for stamping: t0 = epoch ms at request start.
export type StepInfo = { t0: number; model: string; read: number; creation: number; input: number }

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** How far past resetsAt a window still reads "resetting" instead of "rolled". */
const RESET_GRACE_MS = 60 * SEC
/** A store snapshot older than this does not count against "Limits n/a". */
const NA_AGE_MS = 7 * DAY
/** Second ticks below this much cache time left. */
const SECOND_TICKS_BELOW_MS = 10 * MIN
/** A live reading older than this draws as stale (dim, with its age). */
const FRESH_MS = 10 * MIN
/** Resume verdicts: an idle gap past 5m with margin that the engine still calls warm means 1h. */
const RESUME_WARM_1H_S = 330

const KINDS = { '5h': 'five_hour', '7d': 'seven_day' } as const

export function ttlMs(t: Ttl): number {
  return t === '1h' ? HOUR : 5 * MIN
}

export function resolveTtl(setting: TtlSetting, learned: Ttl | null): Ttl {
  if (setting === '5m' || setting === '1h') return setting
  return learned ?? '1h'
}

function hasReadings(s: LimitsSnap | null): s is LimitsSnap {
  return s !== null && Array.isArray(s.items) && s.items.length > 0
}

/** Readings that hold at least one 5h or 7d window. */
function hasWindows(s: LimitsSnap): boolean {
  return s.items.some(l => l.kind === KINDS['5h'] || l.kind === KINDS['7d'])
}

/** Epoch ms of resetsAt, or null when missing or unparseable. */
function resetEpoch(l: Limit): number | null {
  if (typeof l.resetsAt !== 'string') return null
  const t = Date.parse(l.resetsAt)
  return Number.isFinite(t) ? t : null
}

function windowView(label: '5h' | '7d', i: ViewInput, na: boolean): WindowView {
  if (na) return { label, state: 'na' }
  const limits = i.limits
  const item = hasReadings(limits) ? limits.items.find(l => l.kind === KINDS[label]) : undefined
  if (!limits || !item) return { label, state: 'none' }

  // NaN, -Infinity or a non-number is a missing reading; +Infinity is exceeded.
  const used = item.percentUsed
  if (typeof used !== 'number' || Number.isNaN(used) || used === -Infinity) return { label, state: 'none' }
  const percentLeft = Math.min(100, Math.max(0, Math.floor(100 - used)))
  const exceeded = used >= 100
  const ageMs = Math.max(0, i.now - limits.observedAt)
  const r = resetEpoch(item)
  const past = r === null ? 0 : i.now - r
  const rolled = r !== null && past > RESET_GRACE_MS
  const resetting = r !== null && past >= 0 && past <= RESET_GRACE_MS
  const state = rolled ? 'rolled' : i.live && ageMs <= FRESH_MS ? 'ok' : 'stale'
  const resetsInMs = r === null || rolled ? null : Math.max(0, r - i.now)
  return { label, state, percentLeft, exceeded, resetsInMs, resetting, ageMs }
}

function cacheView(i: ViewInput): CacheView {
  const c = i.cache
  if (!c) return { state: 'cold', reason: 'new' }
  if (c.coldReason) return { state: 'cold', reason: c.coldReason }
  // 'unknown' is the resume placeholder model: it does not count as a model change.
  if (i.model !== null && c.model !== 'unknown' && c.model !== i.model) return { state: 'cold', reason: 'model' }
  const ttl = ttlMs(i.ttl)
  if (i.now - c.at >= ttl) return { state: 'cold', reason: 'expired' }
  // Clock skew (stamp in the future): never show more than a full TTL.
  return { state: 'hot', leftMs: Math.min(ttl, c.at + ttl - i.now) }
}

export function computeView(i: ViewInput): View {
  // n/a after a response: no usable readings, or readings with no 5h/7d window (spend_limit only).
  const l = i.limits
  const noWindows = hasReadings(l) && !hasWindows(l)
  const noReadings = !i.live && (!hasReadings(l) || i.now - l.observedAt > NA_AGE_MS)
  const na = i.turnDone && (noWindows || noReadings)
  return {
    fiveHour: windowView('5h', i, na),
    sevenDay: windowView('7d', i, na),
    cache: cacheView(i),
    ttl: i.ttl,
  }
}

/** New stamp from a main step; prev unchanged when the step touched no cache. */
export function stampFromStep(prev: CacheStamp | null, s: StepInfo): CacheStamp | null {
  if (!(s.read + s.creation > 0)) return prev
  return { model: s.model, at: s.t0, inputTokens: s.read + s.creation + s.input }
}

export function stampFromResume(a: {
  now: number
  secondsSince: number | undefined
  expired: boolean | undefined
  model: string | null
  prev: CacheStamp | null
}): CacheStamp | null {
  const model = a.model ?? a.prev?.model ?? 'unknown'
  if (a.expired === true) return { model, at: a.now, inputTokens: 0, coldReason: 'resume-expired' }
  if (typeof a.secondsSince === 'number' && Number.isFinite(a.secondsSince)) {
    const secs = Math.max(0, a.secondsSince)
    return { model, at: a.now - secs * SEC, inputTokens: a.prev?.inputTokens ?? 0 }
  }
  // Nothing known about the resumed transcript: never keep another conversation's stamp.
  return null
}

/**
 * The TTL the engine's resume verdict proves, or null.
 * Warm after more than 330 s means 1h; expired after 300 s to under 1 h means 5m.
 */
export function ttlFromResume(secondsSince: number | undefined, expired: boolean | undefined): Ttl | null {
  if (typeof secondsSince !== 'number' || !Number.isFinite(secondsSince)) return null
  if (expired === false && secondsSince > RESUME_WARM_1H_S) return '1h'
  if (expired === true && secondsSince >= 300 && secondsSince < 3600) return '5m'
  return null
}

/** The fields kept from an engine rate-limit entry (nothing else is stored). */
export function pickLimit(l: { kind: string; percentUsed: number; resetsAt?: string }): Limit {
  const out: Limit = { kind: l.kind, percentUsed: l.percentUsed }
  if (typeof l.resetsAt === 'string') out.resetsAt = l.resetsAt
  return out
}

/** Limits are account-wide: newest observedAt wins; a tie goes to incoming. */
export function mergeSnap(stored: LimitsSnap | null, incoming: LimitsSnap | null): LimitsSnap | null {
  if (!incoming) return stored
  if (!stored) return incoming
  return incoming.observedAt >= stored.observedAt ? incoming : stored
}

/**
 * Next scheduler wake, epoch ms, clamped to [now + minMs, now + 60 s].
 * Second ticks only while the cache is hot with under 10 minutes left.
 * Only future resets count; a past resetsAt never pulls the wake closer.
 * minMs (default 1 s): the SVG themes pass 60 s, so their art redraws at most once a minute.
 */
export function nextWake(v: View, now: number, limits: LimitsSnap | null, minMs: number = SEC): number {
  let wake = now + MIN
  const c = v.cache
  if (c.state === 'hot') {
    if (c.leftMs < SECOND_TICKS_BELOW_MS) wake = now + SEC
    else wake = Math.min(wake, now + (c.leftMs - SECOND_TICKS_BELOW_MS))
  }
  if (limits && Array.isArray(limits.items)) {
    for (const l of limits.items) {
      const r = resetEpoch(l)
      if (r !== null && r > now) wake = Math.min(wake, r)
    }
  }
  const floor = Math.min(MIN, Math.max(SEC, Number.isFinite(minMs) ? minMs : SEC))
  return Math.min(now + MIN, Math.max(now + floor, wake))
}
