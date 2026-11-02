// Tests for hooks/data.ts: contract rules and PLAN section 6 data rules.
import { expect, test } from 'claude-code/testing'
import type { CacheStamp, Limit, LimitsSnap } from '../types'
import {
  computeView, mergeSnap, nextWake, pickLimit, resolveTtl, stampFromResume, stampFromStep, ttlFromResume, ttlMs,
  type StepInfo, type ViewInput, type WindowView,
} from './data'

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = Date.parse('2026-11-02T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

function snap(observedAt: number, five?: number, seven?: number, fiveReset?: number, sevenReset?: number): LimitsSnap {
  const items: Limit[] = []
  if (five !== undefined) items.push({ kind: 'five_hour', percentUsed: five, ...(fiveReset !== undefined ? { resetsAt: iso(fiveReset) } : {}) })
  if (seven !== undefined) items.push({ kind: 'seven_day', percentUsed: seven, ...(sevenReset !== undefined ? { resetsAt: iso(sevenReset) } : {}) })
  return { observedAt, items }
}

function input(over: Partial<ViewInput> = {}): ViewInput {
  return { now: NOW, limits: null, live: false, turnDone: false, cache: null, model: null, ttl: '5m', ...over }
}

function full(w: WindowView) {
  if (w.state === 'none' || w.state === 'na') throw new Error('expected a reading, got ' + w.state)
  return w
}

const stamp = (over: Partial<CacheStamp> = {}): CacheStamp => ({ model: 'opus', at: NOW - MIN, inputTokens: 1000, ...over })
const step = (over: Partial<StepInfo> = {}): StepInfo => ({ t0: NOW, model: 'opus', read: 900, creation: 50, input: 50, ...over })

// ttlMs / resolveTtl

test('ttlMs: 5m and 1h', () => {
  expect(ttlMs('5m')).toBe(300000)
  expect(ttlMs('1h')).toBe(3600000)
})

test('resolveTtl: auto starts at 1h, uses learned 5m or 1h; config overrides (case 14)', () => {
  // Nothing learned: 1h (CJ's account uses a 1h cache).
  expect(resolveTtl('auto', null)).toBe('1h')
  expect(resolveTtl('5m', null)).toBe('5m')
  expect(resolveTtl('auto', '1h')).toBe('1h')
  expect(resolveTtl('5m', '1h')).toBe('5m')
  expect(resolveTtl('1h', null)).toBe('1h')
  // Learned can be 5m too; config still wins.
  expect(resolveTtl('auto', '5m')).toBe('5m')
  expect(resolveTtl('1h', '5m')).toBe('1h')
})

// Windows

test('none: no limits and nothing done yet shows none for both (case 1)', () => {
  const v = computeView(input())
  expect(v.fiveHour).toEqual({ label: '5h', state: 'none' })
  expect(v.sevenDay).toEqual({ label: '7d', state: 'none' })
})

test('none: limits present but a window kind missing', () => {
  const v = computeView(input({ live: true, limits: snap(NOW, 10) }))
  expect(v.fiveHour.state).toBe('ok')
  expect(v.sevenDay).toEqual({ label: '7d', state: 'none' })
})

test('none: live but limits null', () => {
  expect(computeView(input({ live: true, turnDone: true })).fiveHour.state).toBe('none')
})

test('ok: live reading with percent, reset countdown and age', () => {
  const v = computeView(input({ live: true, limits: snap(NOW - 5 * SEC, 28, 60, NOW + 2 * HOUR, NOW + 3 * DAY) }))
  const f = full(v.fiveHour)
  expect(f).toEqual({ label: '5h', state: 'ok', percentLeft: 72, exceeded: false, resetsInMs: 2 * HOUR, resetting: false, ageMs: 5 * SEC })
  const s = full(v.sevenDay)
  expect(s.percentLeft).toBe(40)
  expect(s.resetsInMs).toBe(3 * DAY)
})

test('percentLeft floors and clamps to 0..100', () => {
  const pl = (p: number) => full(computeView(input({ live: true, limits: snap(NOW, p) })).fiveHour).percentLeft
  expect(pl(27.5)).toBe(72)
  expect(pl(0.1)).toBe(99)
  expect(pl(0)).toBe(100)
  expect(pl(-5)).toBe(100)
  expect(pl(99.9)).toBe(0)
  expect(pl(150)).toBe(0)
})

test('window past 100: 0 left, exceeded, countdown still shown (case 10)', () => {
  const f = full(computeView(input({ live: true, limits: snap(NOW, 130, undefined, NOW + 30 * MIN) })).fiveHour)
  expect(f.percentLeft).toBe(0)
  expect(f.exceeded).toBe(true)
  expect(f.resetsInMs).toBe(30 * MIN)
  expect(full(computeView(input({ live: true, limits: snap(NOW, 100) })).fiveHour).exceeded).toBe(true)
  expect(full(computeView(input({ live: true, limits: snap(NOW, 99.99) })).fiveHour).exceeded).toBe(false)
})

test('resetsInMs null when resetsAt missing or unparseable', () => {
  expect(full(computeView(input({ live: true, limits: snap(NOW, 10) })).fiveHour).resetsInMs).toBeNull()
  const bad: LimitsSnap = { observedAt: NOW, items: [{ kind: 'five_hour', percentUsed: 10, resetsAt: 'garbage' }] }
  const f = full(computeView(input({ live: true, limits: bad })).fiveHour)
  expect(f.state).toBe('ok')
  expect(f.resetsInMs).toBeNull()
  expect(f.resetting).toBe(false)
})

test('stale: store snapshot not refreshed in this process is stale, never blanked (cases 1, 2)', () => {
  const f = full(computeView(input({ live: false, limits: snap(NOW - 2 * HOUR, 40, undefined, NOW + HOUR) })).fiveHour)
  expect(f.state).toBe('stale')
  expect(f.percentLeft).toBe(60)
  expect(f.ageMs).toBe(2 * HOUR)
  expect(f.resetsInMs).toBe(HOUR)
})

test('stale: old snapshot still shows before any turn completed', () => {
  const f = full(computeView(input({ turnDone: false, limits: snap(NOW - 10 * DAY, 40) })).fiveHour)
  expect(f.state).toBe('stale')
})

test('rolled: resetsAt more than 60 s past, live or stale; no countdown (case 11)', () => {
  const live = full(computeView(input({ live: true, limits: snap(NOW - HOUR, 90, undefined, NOW - 61 * SEC) })).fiveHour)
  expect(live.state).toBe('rolled')
  expect(live.resetsInMs).toBeNull()
  expect(live.resetting).toBe(false)
  const stale = full(computeView(input({ live: false, limits: snap(NOW - HOUR, 90, undefined, NOW - HOUR) })).fiveHour)
  expect(stale.state).toBe('rolled')
})

test('resetting: resetsAt within 60 s past, clamped at 0 (case 12)', () => {
  const at = (r: number) => full(computeView(input({ live: true, limits: snap(NOW, 50, undefined, r) })).fiveHour)
  const a = at(NOW - 30 * SEC)
  expect(a.state).toBe('ok')
  expect(a.resetting).toBe(true)
  expect(a.resetsInMs).toBe(0)
  expect(at(NOW - 60 * SEC).resetting).toBe(true)
  expect(at(NOW - 60 * SEC).state).toBe('ok')
  expect(at(NOW).resetting).toBe(true)
  expect(at(NOW + SEC).resetting).toBe(false)
})

test('clock skew: observedAt in the future gives age 0 (case 12)', () => {
  expect(full(computeView(input({ live: true, limits: snap(NOW + MIN, 10) })).fiveHour).ageMs).toBe(0)
})

test('na: turn done, no live readings, no limits (case 3); cache row stays', () => {
  const v = computeView(input({ turnDone: true, live: false, limits: null, cache: stamp(), model: 'opus' }))
  expect(v.fiveHour).toEqual({ label: '5h', state: 'na' })
  expect(v.sevenDay).toEqual({ label: '7d', state: 'na' })
  expect(v.cache.state).toBe('hot')
})

test('na: store snapshot older than 7 days counts as none', () => {
  expect(computeView(input({ turnDone: true, limits: snap(NOW - 7 * DAY - 1, 10) })).fiveHour.state).toBe('na')
  expect(computeView(input({ turnDone: true, limits: snap(NOW - 7 * DAY, 10) })).fiveHour.state).toBe('stale')
})

test('na: snapshot with empty items counts as no limits', () => {
  expect(computeView(input({ turnDone: true, limits: { observedAt: NOW, items: [] } })).fiveHour.state).toBe('na')
  expect(computeView(input({ turnDone: false, limits: { observedAt: NOW, items: [] } })).fiveHour.state).toBe('none')
})

test('na: not before a turn completes, and never while live with windows', () => {
  expect(computeView(input({ turnDone: false })).fiveHour.state).toBe('none')
  expect(computeView(input({ turnDone: true, live: true, limits: snap(NOW - 8 * DAY, 10) })).fiveHour.state).toBe('stale')
  expect(computeView(input({ turnDone: true, live: true, limits: snap(NOW, 10) })).fiveHour.state).toBe('ok')
})

test('na: only spend_limit or unknown kinds after a turn (F12)', () => {
  const only: LimitsSnap = { observedAt: NOW, items: [{ kind: 'spend_limit', percentUsed: 10 }, { kind: 'other', percentUsed: 1 }] }
  expect(computeView(input({ turnDone: true, live: true, limits: only })).fiveHour).toEqual({ label: '5h', state: 'na' })
  expect(computeView(input({ turnDone: true, live: false, limits: only })).sevenDay).toEqual({ label: '7d', state: 'na' })
  expect(computeView(input({ turnDone: false, live: true, limits: only })).fiveHour.state).toBe('none')
  // One real window is enough to not be n/a.
  const mixed: LimitsSnap = { observedAt: NOW, items: [...only.items, { kind: 'seven_day', percentUsed: 10 }] }
  const v = computeView(input({ turnDone: true, live: true, limits: mixed }))
  expect(v.fiveHour.state).toBe('none')
  expect(v.sevenDay.state).toBe('ok')
})

test('stale: a live reading older than 10 minutes (F2)', () => {
  expect(computeView(input({ live: true, limits: snap(NOW - 10 * MIN, 10) })).fiveHour.state).toBe('ok')
  expect(computeView(input({ live: true, limits: snap(NOW - 10 * MIN - 1, 10) })).fiveHour.state).toBe('stale')
  expect(full(computeView(input({ live: true, limits: snap(NOW - 3 * HOUR, 10) })).fiveHour).ageMs).toBe(3 * HOUR)
})

test('bad numbers: NaN and -Infinity are missing, +Infinity and 100+ exceeded (F8)', () => {
  const at = (p: number) => computeView(input({ live: true, limits: snap(NOW, p) })).fiveHour
  expect(at(NaN)).toEqual({ label: '5h', state: 'none' })
  expect(at(-Infinity)).toEqual({ label: '5h', state: 'none' })
  const inf = full(at(Infinity))
  expect(inf.percentLeft).toBe(0)
  expect(inf.exceeded).toBe(true)
  expect(full(at(100)).exceeded).toBe(true)
  expect(full(at(-3)).percentLeft).toBe(100)
  const odd = { observedAt: NOW, items: [{ kind: 'five_hour', percentUsed: '12' as unknown as number }] }
  expect(computeView(input({ live: true, limits: odd })).fiveHour.state).toBe('none')
})

// Cache view

test('cache: null is cold new (case 5)', () => {
  expect(computeView(input()).cache).toEqual({ state: 'cold', reason: 'new' })
})

test('cache: coldReason wins (cases 6, 7, 4)', () => {
  for (const r of ['new', 'compacted', 'cleared', 'resume-expired'] as const) {
    expect(computeView(input({ cache: stamp({ at: NOW, coldReason: r }), model: 'opus' })).cache).toEqual({ state: 'cold', reason: r })
  }
})

test('cache: stamp for another model reads cold model (case 8)', () => {
  expect(computeView(input({ cache: stamp({ model: 'sonnet' }), model: 'opus' })).cache).toEqual({ state: 'cold', reason: 'model' })
})

test('cache: unknown current model skips the model check', () => {
  expect(computeView(input({ cache: stamp({ model: 'sonnet' }), model: null })).cache.state).toBe('hot')
})

test('cache: resume placeholder model unknown is not a model change', () => {
  expect(computeView(input({ cache: stamp({ model: 'unknown' }), model: 'opus' })).cache.state).toBe('hot')
})

test('cache: hot with leftMs from stamp; expired at exactly ttl', () => {
  expect(computeView(input({ cache: stamp({ at: NOW - MIN }), model: 'opus' })).cache).toEqual({ state: 'hot', leftMs: 4 * MIN })
  expect(computeView(input({ cache: stamp({ at: NOW - 5 * MIN }) })).cache).toEqual({ state: 'cold', reason: 'expired' })
  expect(computeView(input({ cache: stamp({ at: NOW - 5 * MIN + 1 }) })).cache).toEqual({ state: 'hot', leftMs: 1 })
})

test('cache: 1h ttl keeps it hot past 5 minutes', () => {
  expect(computeView(input({ cache: stamp({ at: NOW - 20 * MIN }), ttl: '1h' })).cache).toEqual({ state: 'hot', leftMs: 40 * MIN })
  expect(computeView(input({ cache: stamp({ at: NOW - 20 * MIN }), ttl: '1h' })).ttl).toBe('1h')
})

test('cache: app closed while idle, epoch stamps read right on next draw (case 13)', () => {
  expect(computeView(input({ now: NOW + 3 * HOUR, cache: stamp({ at: NOW }), ttl: '1h' })).cache).toEqual({ state: 'cold', reason: 'expired' })
})

test('cache: stamp in the future never shows more than a full ttl (case 12)', () => {
  expect(computeView(input({ cache: stamp({ at: NOW + 2 * MIN }) })).cache).toEqual({ state: 'hot', leftMs: 5 * MIN })
})

// stampFromStep

test('stampFromStep: stamps model, request start, total input', () => {
  expect(stampFromStep(null, step({ t0: NOW - 3 * SEC }))).toEqual({ model: 'opus', at: NOW - 3 * SEC, inputTokens: 1000 })
})

test('stampFromStep: creation alone stamps; replaces a cold stamp (case 7)', () => {
  expect(stampFromStep(stamp({ coldReason: 'compacted' }), step({ read: 0, creation: 500, input: 10 }))).toEqual({ model: 'opus', at: NOW, inputTokens: 510 })
})

test('stampFromStep: zero read and creation returns prev unchanged (case 15)', () => {
  const prev = stamp()
  expect(stampFromStep(prev, step({ read: 0, creation: 0, input: 100 }))).toBe(prev)
  expect(stampFromStep(null, step({ read: 0, creation: 0 }))).toBeNull()
})

test('stampFromStep: new model stamp replaces old one (case 8)', () => {
  expect(stampFromStep(stamp({ model: 'opus' }), step({ model: 'sonnet' }))?.model).toBe('sonnet')
})

// ttlFromResume (F1): the engine's resume verdict

test('ttlFromResume: warm after more than 330 s learns 1h', () => {
  expect(ttlFromResume(331, false)).toBe('1h')
  expect(ttlFromResume(330, false)).toBeNull()
  expect(ttlFromResume(3000, false)).toBe('1h')
})

test('ttlFromResume: expired between 300 s and 1 h learns 5m', () => {
  expect(ttlFromResume(300, true)).toBe('5m')
  expect(ttlFromResume(299, true)).toBeNull()
  expect(ttlFromResume(3599, true)).toBe('5m')
  expect(ttlFromResume(3600, true)).toBeNull()
})

test('ttlFromResume: nothing without both fields', () => {
  expect(ttlFromResume(undefined, true)).toBeNull()
  expect(ttlFromResume(undefined, false)).toBeNull()
  expect(ttlFromResume(400, undefined)).toBeNull()
  expect(ttlFromResume(NaN, false)).toBeNull()
})

// pickLimit (F13)

test('pickLimit keeps kind, percentUsed and resetsAt only', () => {
  const raw = { kind: 'five_hour', percentUsed: 3, resetsAt: 'x', path: 'C:/Users/cj', extra: 1 } as { kind: string; percentUsed: number; resetsAt?: string }
  expect(pickLimit(raw)).toEqual({ kind: 'five_hour', percentUsed: 3, resetsAt: 'x' })
  expect(Object.keys(pickLimit({ kind: 'seven_day', percentUsed: 1 }))).toEqual(['kind', 'percentUsed'])
})

// stampFromResume (case 4)

test('stampFromResume: expired forces cold resume-expired', () => {
  expect(stampFromResume({ now: NOW, secondsSince: 10, expired: true, model: 'opus', prev: null }))
    .toEqual({ model: 'opus', at: NOW, inputTokens: 0, coldReason: 'resume-expired' })
  expect(stampFromResume({ now: NOW, secondsSince: undefined, expired: true, model: null, prev: stamp({ model: 'sonnet' }) })?.model).toBe('sonnet')
  expect(stampFromResume({ now: NOW, secondsSince: undefined, expired: true, model: null, prev: null })?.model).toBe('unknown')
})

test('stampFromResume: stamp at now minus seconds since, keeping input tokens', () => {
  expect(stampFromResume({ now: NOW, secondsSince: 120, expired: false, model: 'opus', prev: stamp({ inputTokens: 777 }) }))
    .toEqual({ model: 'opus', at: NOW - 120 * SEC, inputTokens: 777 })
  expect(stampFromResume({ now: NOW, secondsSince: 30, expired: undefined, model: null, prev: null }))
    .toEqual({ model: 'unknown', at: NOW - 30 * SEC, inputTokens: 0 })
})

test('stampFromResume: resumed stamp reads hot then expires on schedule', () => {
  const s = stampFromResume({ now: NOW, secondsSince: 120, expired: false, model: 'opus', prev: null })
  expect(computeView(input({ cache: s, model: 'opus' })).cache).toEqual({ state: 'hot', leftMs: 3 * MIN })
  expect(computeView(input({ now: NOW + 3 * MIN, cache: s, model: 'opus' })).cache.state).toBe('cold')
})

test('stampFromResume: no info gives null, never the previous stamp (F4)', () => {
  const prev = stamp()
  expect(stampFromResume({ now: NOW, secondsSince: undefined, expired: false, model: 'opus', prev })).toBeNull()
  expect(stampFromResume({ now: NOW, secondsSince: undefined, expired: undefined, model: 'opus', prev })).toBeNull()
  expect(stampFromResume({ now: NOW, secondsSince: undefined, expired: undefined, model: 'opus', prev: null })).toBeNull()
})

test('stampFromResume: negative seconds clamp to now', () => {
  expect(stampFromResume({ now: NOW, secondsSince: -5, expired: false, model: 'opus', prev: null })?.at).toBe(NOW)
})

// mergeSnap (case 16)

test('mergeSnap: newest observedAt wins', () => {
  const a = snap(NOW - MIN, 10)
  const b = snap(NOW, 20)
  expect(mergeSnap(a, b)).toBe(b)
  expect(mergeSnap(b, a)).toBe(b)
})

test('mergeSnap: nulls and ties', () => {
  const a = snap(NOW, 10)
  const t = snap(NOW, 30)
  expect(mergeSnap(null, null)).toBeNull()
  expect(mergeSnap(a, null)).toBe(a)
  expect(mergeSnap(null, a)).toBe(a)
  expect(mergeSnap(a, t)).toBe(t)
})

// nextWake

const viewOf = (over: Partial<ViewInput>) => computeView(input(over))

test('nextWake: minute ticks by default', () => {
  expect(nextWake(viewOf({}), NOW, null)).toBe(NOW + MIN)
})

test('nextWake: second ticks while hot under 10 minutes left', () => {
  const v = viewOf({ cache: stamp({ at: NOW - 2 * MIN }) })
  expect(nextWake(v, NOW, null)).toBe(NOW + SEC)
})

test('nextWake: hot over 10 minutes wakes for the 10 minute mark, else minute', () => {
  const at = (left: number) => nextWake(viewOf({ ttl: '1h', cache: stamp({ at: NOW - HOUR + left }) }), NOW, null)
  expect(at(10 * MIN + 20 * SEC)).toBe(NOW + 20 * SEC)
  expect(at(10 * MIN)).toBe(NOW + SEC)
  expect(at(40 * MIN)).toBe(NOW + MIN)
  expect(at(10 * MIN + 100)).toBe(NOW + SEC)
})

test('nextWake: cold cache does not tick seconds', () => {
  expect(nextWake(viewOf({ cache: stamp({ at: NOW - HOUR }) }), NOW, null)).toBe(NOW + MIN)
})

test('nextWake: a future reset pulls the wake in, clamped to 1 s', () => {
  const l1 = snap(NOW, 10, 20, NOW + 30 * SEC, NOW + DAY)
  expect(nextWake(viewOf({ live: true, limits: l1 }), NOW, l1)).toBe(NOW + 30 * SEC)
  const l2 = snap(NOW, 10, undefined, NOW + 100)
  expect(nextWake(viewOf({ live: true, limits: l2 }), NOW, l2)).toBe(NOW + SEC)
})

test('nextWake: past resets never pull it closer (case 11)', () => {
  for (const r of [NOW - 10, NOW - 30 * SEC, NOW - HOUR, NOW]) {
    const l = snap(NOW - HOUR, 10, undefined, r)
    expect(nextWake(viewOf({ live: true, limits: l }), NOW, l)).toBe(NOW + MIN)
  }
})

test('nextWake: always within [now + 1 s, now + 60 s]', () => {
  const l = snap(NOW, 10, 10, NOW + 5 * DAY, NOW + 6 * DAY)
  const views = [viewOf({}), viewOf({ cache: stamp({ at: NOW }) }), viewOf({ ttl: '1h', cache: stamp({ at: NOW }) }), viewOf({ live: true, limits: l })]
  for (const v of views) {
    const w = nextWake(v, NOW, l)
    expect(w).toBeGreaterThanOrEqual(NOW + SEC)
    expect(w).toBeLessThanOrEqual(NOW + MIN)
  }
})
