import { expect, test } from 'claude-code/testing'
import type { CacheView, View, ViewInput, WindowView } from './data'
import { computeView, nextWake } from './data'
import { bandSegments, bar, commandText, formatClock, formatDuration, formatLeft, type Seg } from './format'

const M = 60_000
const H = 60 * M
const D = 24 * H

const win = (label: '5h' | '7d', percentLeft: number, resetsInMs: number | null, extra: Partial<WindowView> = {}): WindowView =>
  ({ label, state: 'ok', percentLeft, exceeded: false, resetsInMs, resetting: false, ageMs: 0, ...extra }) as WindowView

const hot = (leftMs: number): CacheView => ({ state: 'hot', leftMs })

// Example values from PLAN section 7.
const base = (o: Partial<View> = {}): View => ({
  fiveHour: win('5h', 72, 2 * H + 14 * M),
  sevenDay: win('7d', 40, 3 * D + 4 * H),
  cache: hot(41 * M + 12_000),
  ttl: '1h',
  ...o,
})

const text = (segs: Seg[]): string => segs.map(s => s.text).join('')
const toneOf = (segs: Seg[], t: string): string | undefined => segs.find(s => s.text === t)?.tone
const lines = (ls: Seg[][]): string[] => ls.map(text)
// Bars written out: '#' for a filled cell, '-' for a track cell.
const show = (segs: Seg[]): string =>
  segs.map(s => (s.bar === true ? (s.tone === 'track' ? '-' : '#').repeat(s.text.length) : s.text)).join('')
const shows = (ls: Seg[][]): string[] => ls.map(show)
const bars = (segs: Seg[]): Seg[] => segs.filter(s => s.bar === true)
const fills = (segs: Seg[]): Seg[] => bars(segs).filter(s => s.tone !== 'track')

// Bar tiers (10 and 6 cells), then the text tiers.
const B10 = '5h #######--- 72% 2h 14m  |  7d ####------ 40% 3d 4h  |  Cache #######--- hot 41m'
const B6 = '5h ####-- 72% 2h 14m  |  7d ##---- 40% 3d 4h  |  Cache ####-- hot 41m'
const T2 = '5h 72% left 2h 14m | 7d 40% left 3d 4h | Cache hot 41m'
const T3 = '5h 72% 2h14m | 7d 40% 3d4h | hot 41m'
const T4 = '5h 72% 2h | 7d 40% 3d | hot 41m'
const T5 = '72% 40% hot'

test('formatDuration covers each unit and compact form', () => {
  expect(formatDuration(0)).toBe('<1m')
  expect(formatDuration(59_999)).toBe('<1m')
  expect(formatDuration(-5000)).toBe('<1m')
  expect(formatDuration(M)).toBe('1m')
  expect(formatDuration(14 * M + 59_000)).toBe('14m')
  expect(formatDuration(H)).toBe('1h 0m')
  expect(formatDuration(2 * H + 14 * M)).toBe('2h 14m')
  expect(formatDuration(2 * H + 14 * M, true)).toBe('2h14m')
  expect(formatDuration(D - 1)).toBe('23h 59m')
  expect(formatDuration(3 * D + 4 * H)).toBe('3d 4h')
  expect(formatDuration(3 * D + 4 * H, true)).toBe('3d4h')
  expect(formatDuration(14 * M, true)).toBe('14m')
})

test('formatClock rounds seconds up and caps at 60:00', () => {
  expect(formatClock(0)).toBe('00:00')
  expect(formatClock(-1000)).toBe('00:00')
  expect(formatClock(1)).toBe('00:01')
  expect(formatClock(59_001)).toBe('01:00')
  expect(formatClock(41 * M + 11_500)).toBe('41:12')
  expect(formatClock(H - 1)).toBe('60:00')
  expect(formatClock(2 * H)).toBe('60:00')
  expect(formatClock(5 * M)).toBe('05:00')
})

// ---- bar ----

test('bar: fill and track runs for 0, tiny, half, full, NaN and width 0', () => {
  const sp = (n: number) => ' '.repeat(n)
  expect(bar(0, 10, 'success')).toEqual([{ text: sp(10), tone: 'track', bar: true }])
  // Any fraction above 0 fills at least one cell.
  expect(bar(0.001, 10, 'success')).toEqual([{ text: sp(1), tone: 'success', bar: true }, { text: sp(9), tone: 'track', bar: true }])
  expect(bar(0.04, 10, 'error')).toEqual([{ text: sp(1), tone: 'error', bar: true }, { text: sp(9), tone: 'track', bar: true }])
  expect(bar(0.5, 10, 'warning')).toEqual([{ text: sp(5), tone: 'warning', bar: true }, { text: sp(5), tone: 'track', bar: true }])
  expect(bar(1, 10, 'success')).toEqual([{ text: sp(10), tone: 'success', bar: true }])
  expect(bar(NaN, 10, 'success')).toEqual([{ text: sp(10), tone: 'track', bar: true }])
  expect(bar(Infinity, 6, 'success')).toEqual([{ text: sp(6), tone: 'track', bar: true }])
  // Out of range fractions clamp; width 0 or less draws nothing.
  expect(bar(2, 4, 'success')).toEqual([{ text: sp(4), tone: 'success', bar: true }])
  expect(bar(-1, 4, 'success')).toEqual([{ text: sp(4), tone: 'track', bar: true }])
  expect(bar(0.5, 0, 'success')).toEqual([])
  expect(bar(1, -3, 'success')).toEqual([])
  expect(bar(0.001, 0, 'success')).toEqual([])
  // Cells are spaces; the width is always exact.
  for (const f of [0, 0.001, 0.25, 0.5, 0.75, 0.999, 1]) for (const w of [1, 6, 10, 13, 24]) {
    const b = bar(f, w, 'success')
    expect(text(b).length).toBe(w)
    expect(/^ *$/.test(text(b))).toBe(true)
  }
})

test('bar fill tones follow the percent thresholds', () => {
  const fillTone = (w: WindowView) => {
    const segs = bandSegments(base({ fiveHour: w }), 99)
    // The 5h bar is the first bar run of the row.
    return bars(segs)[0]?.tone
  }
  expect(fillTone(win('5h', 100, H))).toBe('success')
  expect(fillTone(win('5h', 51, H))).toBe('success')
  expect(fillTone(win('5h', 50, H))).toBe('warning')
  expect(fillTone(win('5h', 20, H))).toBe('warning')
  expect(fillTone(win('5h', 19, H))).toBe('error')
  expect(fillTone(win('5h', 1, H))).toBe('error')
  expect(fillTone(win('5h', 72, H, { exceeded: true }))).toBe('error')
  expect(fillTone(win('5h', 72, H, { state: 'stale', ageMs: 12 * M }))).toBe('dim')
  // 0% left and rolled: no fill at all, the whole bar is track.
  expect(fills(bandSegments(base({ fiveHour: win('5h', 0, H, { exceeded: true }) }), 99)).length).toBe(2)
  const ro = bandSegments(base({ fiveHour: win('5h', 72, null, { state: 'rolled', ageMs: 3 * H }) }), 99)
  expect(show(ro).startsWith('5h ---------- reset  |')).toBe(true)
})

// ---- band ----

test('band tier strings: bar tier at 99 and 83 columns, text tiers below', () => {
  const v = base()
  expect(B10.length).toBe(81)
  expect(B6.length).toBe(69)
  expect(T2.length).toBe(54)
  expect(T3.length).toBe(36)
  expect(show(bandSegments(v, 99))).toBe(B10)
  expect(show(bandSegments(v, 83))).toBe(B10)
  expect(show(bandSegments(v, 75))).toBe(B6)
  expect(show(bandSegments(v, 60))).toBe(T2)
  expect(show(bandSegments(v, 40))).toBe(T3)
  expect(show(bandSegments(v, 25))).toBe(T5)
  expect(bars(bandSegments(v, 60))).toEqual([])
  // The 10-cell tier: 5h 72% -> 7 cells, 7d 40% -> 4, cache 41m of 1h -> 7.
  expect(bars(bandSegments(v, 99)).map(s => [s.text.length, s.tone])).toEqual([
    [7, 'success'], [3, 'track'], [4, 'warning'], [6, 'track'], [7, 'success'], [3, 'track'],
  ])
})

test('each band tier holds at its breakpoint and drops one column below', () => {
  const v = base()
  const tiers = [B10, B6, T2, T3, T4]
  const next = [B6, T2, T3, T4, T5]
  tiers.forEach((t, i) => {
    expect(show(bandSegments(v, t.length))).toBe(t)
    expect(show(bandSegments(v, t.length - 1))).toBe(next[i])
  })
  expect(text(bandSegments(v, 11))).toBe(T5)
  // Under the narrowest tier: cut to fit (F9); under 6 columns nothing.
  expect(text(bandSegments(v, 10))).toBe(T5.slice(0, 10))
  expect(text(bandSegments(v, 6))).toBe(T5.slice(0, 6))
  expect(bandSegments(v, 5)).toEqual([])
  expect(bandSegments(v, 0)).toEqual([])
  expect(bandSegments(v, NaN)).toEqual([])
  // T1 is still a fallback where it is narrower than the 6-cell bar tier.
  const nr = base({ fiveHour: win('5h', 72, null), sevenDay: win('7d', 40, null) })
  const T1nr = '5h 72% left  |  7d 40% left  |  Cache hot 41m'
  expect(show(bandSegments(nr, 68))).toBe('5h #######--- 72%  |  7d ####------ 40%  |  Cache #######--- hot 41m')
  expect(show(bandSegments(nr, 67))).toBe('5h ####-- 72%  |  7d ##---- 40%  |  Cache ####-- hot 41m')
  expect(show(bandSegments(nr, 56))).toBe('5h ####-- 72%  |  7d ##---- 40%  |  Cache ####-- hot 41m')
  expect(show(bandSegments(nr, 55))).toBe(T1nr)
  expect(show(bandSegments(nr, T1nr.length))).toBe(T1nr)
})

test('band text never exceeds the columns, bar cells counted (F9)', () => {
  const views = [
    base(),
    base({ fiveHour: win('5h', 100, 999 * D), sevenDay: win('7d', 100, 999 * D), cache: { state: 'cold', reason: 'new' } }),
    base({ fiveHour: { label: '5h', state: 'na' }, sevenDay: { label: '7d', state: 'na' } }),
    base({ fiveHour: win('5h', 72, H, { state: 'stale', ageMs: 999 * D }) }),
    base({ fiveHour: win('5h', 1, 999 * D, { state: 'stale', ageMs: 999 * D }), sevenDay: win('7d', 0, 999 * D, { state: 'stale', exceeded: true, ageMs: 999 * D }) }),
    base({ fiveHour: win('5h', 72, null, { state: 'rolled', ageMs: 3 * H }), sevenDay: win('7d', 3, -20_000, { resetting: true }) }),
    base({ fiveHour: { label: '5h', state: 'none' }, cache: hot(H) }),
  ]
  for (const v of views) for (let c = 0; c <= 120; c++) {
    const segs = bandSegments(v, c)
    expect(text(segs).length).toBeLessThanOrEqual(c)
    expect(show(segs).length).toBe(text(segs).length)
  }
})

test('percent tones follow the thresholds', () => {
  const at = (p: number, exceeded = false) =>
    toneOf(bandSegments(base({ fiveHour: win('5h', p, H, { exceeded }) }), 99), `${p}%`)
  expect(at(51)).toBe('normal')
  expect(at(50)).toBe('warning')
  expect(at(20)).toBe('warning')
  expect(at(19)).toBe('error')
  expect(at(0, true)).toBe('error')
  expect(at(72, true)).toBe('error')
})

test('labels and separators are dim', () => {
  const segs = bandSegments(base(), 99)
  expect(toneOf(segs, '5h ')).toBe('dim')
  expect(toneOf(segs, '7d ')).toBe('dim')
  expect(toneOf(segs, 'Cache ')).toBe('dim')
  expect(toneOf(segs, '  |  ')).toBe('dim')
  // Text tiers keep ' left' dim.
  expect(toneOf(bandSegments(base(), 60), ' left')).toBe('dim')
  expect(toneOf(bandSegments(base(), 60), ' | ')).toBe('dim')
  // Only bar runs carry `bar`; no other segment does.
  for (const s of segs) if (s.bar !== true) expect(s.tone === 'track').toBe(false)
})

test('cache states and tones', () => {
  const band = (c: CacheView) => bandSegments(base({ cache: c }), 99)
  expect(toneOf(band(hot(41 * M)), 'hot 41m')).toBe('success')
  // mm:ss only under 10 minutes left (F6).
  expect(toneOf(band(hot(10 * M)), 'hot 10m')).toBe('success')
  expect(toneOf(band(hot(10 * M - 1)), 'hot 10:00')).toBe('success')
  expect(toneOf(band(hot(9 * M + 59_000)), 'hot 09:59')).toBe('success')
  expect(toneOf(band(hot(61_000)), 'hot 01:01')).toBe('success')
  expect(toneOf(band(hot(60_000)), 'hot 01:00')).toBe('warning')
  expect(toneOf(band(hot(5000)), 'hot 00:05')).toBe('warning')
  // The cache bar fill takes the same tone.
  expect(fills(band(hot(41 * M))).pop()?.tone).toBe('success')
  expect(fills(band(hot(60_000))).pop()?.tone).toBe('warning')
  for (const reason of ['new', 'expired', 'compacted', 'cleared', 'resume-expired', 'model'] as const) {
    const segs = band({ state: 'cold', reason })
    expect(show(segs).endsWith('|  Cache ---------- cold')).toBe(true)
    expect(toneOf(segs, 'cold')).toBe('dim')
  }
  expect(text(bandSegments(base({ cache: hot(30_000) }), 31))).toBe('5h 72% 2h | 7d 40% 3d | hot <1m')
  expect(text(bandSegments(base({ cache: { state: 'cold', reason: 'new' } }), 20))).toBe('72% 40% cold')
})

test('cache bar drains with time and is empty once cold', () => {
  const NOW0 = Date.parse('2026-11-02T12:00:00.000Z')
  const cacheCells = (v: View) => {
    const segs = bandSegments(v, 99)
    const i = segs.findIndex(s => s.text === 'Cache ')
    return show(segs.slice(i + 1, i + 3).filter(s => s.bar === true))
  }
  // 1h TTL, 10 cells: one cell drains every 6 minutes.
  for (let k = 0; k < 10; k++) {
    const v = computeView({ now: NOW0 + k * 6 * M, limits: null, live: true, turnDone: false,
      cache: { model: 'm', at: NOW0, inputTokens: 1 }, model: 'm', ttl: '1h' })
    expect(cacheCells(v)).toBe('#'.repeat(10 - k) + '-'.repeat(k))
  }
  // Last second: still one cell; at the TTL: cold and empty.
  const last = computeView({ now: NOW0 + H - 1000, limits: null, live: true, turnDone: false,
    cache: { model: 'm', at: NOW0, inputTokens: 1 }, model: 'm', ttl: '1h' })
  expect(cacheCells(last)).toBe('#---------')
  const gone = computeView({ now: NOW0 + H, limits: null, live: true, turnDone: false,
    cache: { model: 'm', at: NOW0, inputTokens: 1 }, model: 'm', ttl: '1h' })
  expect(gone.cache.state).toBe('cold')
  expect(cacheCells(gone)).toBe('----------')
  // 5m TTL: the fraction is of 5 minutes.
  expect(show(bandSegments(base({ cache: hot(150_000), ttl: '5m' }), 99)).endsWith('Cache #####----- hot 02:30')).toBe(true)
  expect(show(bandSegments(base({ cache: hot(150_000), ttl: '1h' }), 99)).endsWith('Cache #--------- hot 02:30')).toBe(true)
  // Cold, any reason: no fill cell anywhere in the cache bar.
  for (const reason of ['new', 'expired', 'compacted', 'cleared', 'resume-expired', 'model'] as const) {
    const c: CacheView = { state: 'cold', reason }
    expect(cacheCells(base({ cache: c }))).toBe('----------')
  }
})

test('window state none shows dashes', () => {
  const v = base({ fiveHour: { label: '5h', state: 'none' }, sevenDay: { label: '7d', state: 'none' } })
  const segs = bandSegments(v, 99)
  expect(show(segs)).toBe('5h --  |  7d --  |  Cache #######--- hot 41m')
  expect(toneOf(segs, '--')).toBe('dim')
  expect(text(bandSegments(v, 12))).toBe('-- -- hot')
})

test('window state na collapses into one segment', () => {
  const v = base({ fiveHour: { label: '5h', state: 'na' }, sevenDay: { label: '7d', state: 'na' } })
  const segs = bandSegments(v, 99)
  expect(show(segs)).toBe('Limits n/a  |  Cache #######--- hot 41m')
  expect(toneOf(segs, 'Limits n/a')).toBe('dim')
  expect(text(bandSegments(v, 12))).toBe('n/a hot')
  // Only one window na: no collapse.
  const one = base({ sevenDay: { label: '7d', state: 'na' } })
  expect(show(bandSegments(one, 99))).toBe('5h #######--- 72% 2h 14m  |  7d n/a  |  Cache #######--- hot 41m')
})

test('stale values are dim and say only the reset time', () => {
  const stale = (label: '5h' | '7d', p: number, r: number) => win(label, p, r, { state: 'stale', ageMs: 12 * M })
  const v = base({ fiveHour: stale('5h', 72, 2 * H + 14 * M), sevenDay: stale('7d', 10, 3 * D + 4 * H) })
  const wide = '5h #######--- 72% 2h 14m  |  7d #--------- 10% 3d 4h  |  Cache #######--- hot 41m'
  expect(show(bandSegments(v, 200))).toBe(wide)
  expect(toneOf(bandSegments(v, 200), '10%')).toBe('dim')
  expect(toneOf(bandSegments(v, 200), '72%')).toBe('dim')
  // Stale bars fill dim.
  expect(fills(bandSegments(v, 200)).map(s => s.tone)).toEqual(['dim', 'dim', 'success'])
  // The stale note is gone: the strip is exactly as wide as a fresh one.
  expect(show(bandSegments(v, 99))).toBe(B10.replace('####------ 40%', '#--------- 10%'))
  expect(show(bandSegments(v, 99))).toBe(wide)
  // Text tiers below the bar tiers are the same.
  expect(show(bandSegments(v, 60))).toBe(T2.replace('40%', '10%'))
})

test('rolled and resetting windows', () => {
  const rolled = win('5h', 72, null, { state: 'rolled', ageMs: 3 * H })
  const v = base({ fiveHour: rolled })
  const segs = bandSegments(v, 99)
  expect(show(segs)).toBe('5h ---------- reset  |  7d ####------ 40% 3d 4h  |  Cache #######--- hot 41m')
  expect(toneOf(segs, ' reset')).toBe('dim')
  // Every tier says reset, never the old percent (F7).
  for (const cols of [99, 83, 70, 60, 40, 31, 20, 14]) {
    const t = text(bandSegments(v, cols))
    expect(t.includes('72%')).toBe(false)
    expect(t.includes('reset')).toBe(true)
  }
  expect(text(bandSegments(v, 40))).toBe('5h reset | 7d 40% 3d4h | hot 41m')
  expect(text(bandSegments(v, 14))).toBe('reset 40% hot')
  const r = base({ fiveHour: win('5h', 3, -20_000, { resetting: true }) })
  expect(show(bandSegments(r, 99))).toBe('5h #--------- 3% resetting  |  7d ####------ 40% 3d 4h  |  Cache #######--- hot 41m')
  // Missing resetsAt: reset part omitted.
  const n = base({ fiveHour: win('5h', 72, null) })
  expect(show(bandSegments(n, 99))).toBe('5h #######--- 72%  |  7d ####------ 40% 3d 4h  |  Cache #######--- hot 41m')
})

test('commandText gives three lines and the estimate note', () => {
  expect(commandText(base())).toBe([
    '5-hour: 72% left, resets in 2h 14m',
    '7-day: 40% left, resets in 3d 4h',
    'Cache: hot, 41m left of 1h TTL',
    'Cache state is an estimate.',
  ].join('\n'))
  const v = base({
    fiveHour: win('5h', 0, 62 * M, { exceeded: true, state: 'stale', ageMs: 2 * M }),
    sevenDay: { label: '7d', state: 'none' },
    cache: { state: 'cold', reason: 'compacted' },
    ttl: '5m',
  })
  expect(commandText(v).split('\n')).toEqual([
    '5-hour: 0% left (limit reached), resets in 1h 2m (as of 2m ago)',
    '7-day: no reading yet',
    'Cache: cold (compacted)',
    'Cache state is an estimate.',
  ])
  const na = base({ fiveHour: { label: '5h', state: 'na' }, sevenDay: { label: '7d', state: 'na' } })
  expect(commandText(na).split('\n').slice(0, 2)).toEqual([
    '5-hour: n/a (no subscription limits)',
    '7-day: n/a (no subscription limits)',
  ])
})

test('formatLeft: minutes from 10:00 up, mm:ss below (F6)', () => {
  expect(formatLeft(41 * M + 12_000)).toBe('41m')
  expect(formatLeft(10 * M)).toBe('10m')
  expect(formatLeft(10 * M - 1)).toBe('10:00')
  expect(formatLeft(65_000)).toBe('01:05')
  expect(formatLeft(H)).toBe('60m')
})

test('numbers carry the tabular mark (F15)', () => {
  const segs = bandSegments(base(), 99)
  expect(segs.find(s => s.text === '72%')?.num).toBe(true)
  expect(segs.find(s => s.text === 'hot 41m')?.num).toBe(true)
  expect(segs.find(s => s.text === '5h ')?.num).toBe(undefined)
})

test('all output is plain ASCII', () => {
  const all = [text(bandSegments(base(), 99)), commandText(base())].join('')
  expect(/^[\x20-\x7e\n]*$/.test(all)).toBe(true)
})

// ---- ported adversarial cases (BUILD-REVIEW3), through computeView ----

const NOW = Date.parse('2026-11-02T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()
const vin = (o: Partial<ViewInput> = {}): ViewInput =>
  ({ now: NOW, limits: null, live: true, turnDone: true, cache: null, model: null, ttl: '5m', ...o })

test('ADV rolled window: no tier shows the old percent as current', () => {
  const v = computeView(vin({ limits: { observedAt: NOW, items: [
    { kind: 'five_hour', percentUsed: 99, resetsAt: iso(NOW - 2 * H) },
    { kind: 'seven_day', percentUsed: 60, resetsAt: iso(NOW + 3 * D) },
  ] } }))
  for (const cols of [99, 40, 30, 14]) {
    const t = text(bandSegments(v, cols))
    expect(t.includes('1%')).toBe(false)
    expect(t.includes('reset')).toBe(true)
  }
})

test('ADV negative, over 100, duplicate and unknown kinds', () => {
  const v = computeView(vin({ limits: { observedAt: NOW, items: [
    { kind: 'spend_limit', percentUsed: 250, resetsAt: iso(NOW + 30_000) },
    { kind: 'five_hour', percentUsed: -5 },
    { kind: 'five_hour', percentUsed: 90 },
    { kind: 'seven_day', percentUsed: 140, resetsAt: 'garbage' },
  ] } }))
  const f = v.fiveHour as Extract<WindowView, { percentLeft: number }>
  const s7 = v.sevenDay as Extract<WindowView, { percentLeft: number }>
  expect(f.percentLeft).toBe(100) // first duplicate wins
  expect(s7.percentLeft).toBe(0)
  expect(s7.exceeded).toBe(true)
  expect(s7.resetsInMs).toBe(null)
})

test('ADV far-future resets stay inside the chosen width', () => {
  const v = computeView(vin({ limits: { observedAt: NOW, items: [
    { kind: 'five_hour', percentUsed: 1, resetsAt: iso(NOW + 999 * D) },
    { kind: 'seven_day', percentUsed: 1, resetsAt: '9999-12-31T23:59:59Z' },
  ] } }))
  for (const cols of [6, 14, 20, 28, 38, 56, 76, 99, 500]) {
    expect(text(bandSegments(v, cols)).length).toBeLessThanOrEqual(cols)
  }
})

test('ADV nextWake: one 5m step costs under 400 wakes in an hour', () => {
  const lim = { observedAt: NOW, items: [{ kind: 'five_hour', percentUsed: 28, resetsAt: iso(NOW + 2 * H) }] }
  let now = NOW
  let wakes = 0
  while (now < NOW + H) {
    const v = computeView(vin({ now, limits: lim, cache: { model: 'm', at: NOW, inputTokens: 1 } }))
    now = nextWake(v, now, lim)
    wakes++
  }
  expect(wakes).toBeLessThan(400)
})
