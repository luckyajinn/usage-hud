import { expect, mock, test as kitTest } from 'claude-code/testing'
import type { Engine, TestBody, TestOptions } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

// The tests below written for the text look run with theme 'text' unless they say
// otherwise; the art tests at the end use kitTest with the manifest default (clean).
function test(name: string, a: TestOptions | TestBody, b?: TestBody): void {
  if (typeof a === 'function') kitTest(name, { options: { theme: 'text' } }, a)
  else kitTest(name, { ...a, options: { theme: 'text', ...a.options } }, b!)
}

const NOW = Date.parse('2026-11-02T12:00:00Z')
const MIN = 60_000
const H = 60 * MIN
const LIMITS: SessionUsage['rateLimits'] = [
  { kind: 'five_hour', percentUsed: 28, resetsAt: new Date(NOW + 2 * H + 14 * MIN + 30_000).toISOString() },
  { kind: 'seven_day', percentUsed: 60, resetsAt: new Date(NOW + 76 * H + 30_000).toISOString() },
]
// Bars written out: '#' a filled cell, '-' a track cell. The 10-cell bar tier fits 80 and 99 columns.
const WIDE = '5h #######--- 72% 2h 14m  |  7d ####------ 40% 3d 4h  |  Cache ---------- cold'
const NONE = '5h --  |  7d --  |  Cache ---------- cold'

const band = (bodyColumns: number, hasSurvey = false) => ({
  plugin: 'usage-hud',
  component: 'AbovePrompt',
  props: {
    hasSurvey, isWorking: false, maxRows: 6, bodyColumns,
    scroll: { offset: 0, bodyRows: 6 }, view: {},
  },
}) as const

const pane = (placement: 'dock' | 'inline', bodyColumns = 30) => ({
  plugin: 'usage-hud',
  component: 'Pane',
  requestId: 'usage-hud',
  props: {
    title: 'Usage', isFocused: false, bodyColumns, placement,
    scroll: { offset: 0, bodyRows: 20 }, view: {},
  },
}) as const

type Usage = { read: number; creation: number; input: number; model?: string }

// The engine beneath the plugin, with a store that can be read back and a count of
// how often each hooked event reached the engine.
const engine = (
  on: On,
  rateLimits: SessionUsage['rateLimits'],
  store: Record<string, unknown> = {},
  surfaces: ('desktop' | 'terminal')[] = ['desktop'],
) => {
  const clock = mock.clock(on, { now: NOW })
  const mem: Record<string, unknown> = JSON.parse(JSON.stringify(store))
  const calls: Record<string, number> = {}
  const count = (k: string) => {
    calls[k] = (calls[k] ?? 0) + 1
  }
  const fail = { storeGet: false }
  on('store.get', (_, e) => {
    if (fail.storeGet) throw new TypeError('EACCES C:/Users/cj/.claude/plugins/store')
    return { value: mem[e.key] }
  })
  on('store.set', (_, e) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete mem[e.key]
    return { value: undefined }
  })
  // Spy: the mod draws only the band, so nothing may ever ask the engine to open a pane.
  const opens: string[] = []
  const logs: string[] = []
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200000 }, rateLimits } }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.start', (_, e) => {
    count('session.start')
    return { cwd: e.cwd }
  })
  on('ui.open', (_, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'usage-hud' } }))
  on('session.measure', (_, e) => {
    count('session.measure')
    return { changed: [...e.changed] }
  })
  on('session.end', (_, e) => {
    count('session.end')
    return { sessionId: e.sessionId }
  })
  on('turn.complete', (_, e) => {
    count('turn.complete')
    return { text: e.answer }
  })
  on('classic.SessionStart', () => {
    count('classic.SessionStart')
    return { additionalContext: ['beneath'] }
  })
  on('classic.PostCompact', () => {
    count('classic.PostCompact')
    return { stopReason: 'beneath' }
  })
  on('classic.PostModelSwitch', () => {
    count('classic.PostModelSwitch')
    return { additionalContext: ['beneath'] }
  })
  let ticks = 0
  on('state.set', { plugin: 'usage-hud', key: 'tick' }, (_, e, next) => {
    ticks += 1
    return next(e)
  })
  return { clock, opens, mem, logs, calls, fail, ticks: () => ticks }
}

// Steps answered from a queue of usages (then a no-cache usage).
const answerSteps = (on: On, q: Usage[] | Usage) => {
  let calls = 0
  const queue = Array.isArray(q) ? [...q] : null
  on('turn.step', async function* (_, e) {
    calls += 1
    const u = queue ? queue.shift() ?? { read: 0, creation: 0, input: 1 } : (q as Usage)
    return {
      turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn',
      usage: {
        input_tokens: u.input, output_tokens: 5, cache_read_input_tokens: u.read,
        cache_creation_input_tokens: u.creation, model: u.model ?? 'm',
      },
    }
  })
  return () => calls
}

const start = ($: Engine, surface: 'desktop' | 'terminal' = 'desktop') =>
  $.session.start({ cwd: '/', surface, isInteractive: true })

const measure = ($: Engine, rateLimits: SessionUsage['rateLimits'] = LIMITS, changed: ('rateLimits')[] = ['rateLimits']) =>
  $.session.measure({ context: { window: 200000 }, rateLimits, changed })

const modelSwitch = ($: Engine, to: string, ttl: '5m' | '1h') =>
  $.classic.PostModelSwitch({
    from_model: 'm', to_model: to, requested_model: to, source: 'command', context_tokens: 0,
    prompt_cache_warm: false, cache_ttl: ttl, estimated_cache_write_usd: 0, pricing: 'catalog',
  })

const complete = ($: Engine) =>
  $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'tc', reason: 'answer' })

const end = ($: Engine, reason: 'clear' | 'resume' | 'other') =>
  $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })

// Reads a step to its end; resolves what beneath returned.
const drain = async <R,>(s: AsyncGenerator<unknown, R>): Promise<R> => {
  for (;;) {
    const x = await s.next()
    if (x.done) return x.value
  }
}
let n = 0
const step = ($: Engine, agentId?: string) =>
  drain($.turn.step({ turnId: 't' + ++n, index: 0, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) }))

type Found = { type: string; props: Record<string, unknown>; text: string }
type Ui = {
  find: (q: { type: string }) => Promise<Found | undefined>
  findAll: (q: { type: string }) => Promise<Found[]>
}

// Whole text of the first Box (the band row); bar cells are spaces here.
const allText = async (ui: Ui) => (await ui.find({ type: 'Box' }))?.text ?? ''

// A Text as shown, a bar run written out: '-' for the track (subtle), '#' for a fill.
const cell = (t: Found): string =>
  t.props.backgroundColor === undefined ? t.text : (t.props.backgroundColor === 'subtle' ? '-' : '#').repeat(t.text.length)

// Each row Box as shown, bars written out.
const rowsOf = async (ui: Ui): Promise<string[]> => {
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexDirection === 'row')
  const texts = await ui.findAll({ type: 'Text' })
  let i = 0
  return rows.map(r => {
    let out = ''
    let n = 0
    while (n < r.text.length && i < texts.length) {
      const t = texts[i++]!
      n += t.text.length
      out += cell(t)
    }
    return out
  })
}
const shown = async (ui: Ui) => (await rowsOf(ui)).join('')
const barsOf = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).filter(t => t.props.backgroundColor !== undefined)

const bandText = async ($: Engine, cols = 99) => {
  const ui = await $.ui.mount({ ...band(cols), surface: 'desktop' })
  const t = await shown(ui)
  await ui.unmount()
  return t
}

const runCommand = ($: Engine) =>
  $.command.run({
    command: 'usage-hud', args: '', origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
// The /usage-hud readout: the text that spells out each state (cold reasons, ages).
const readout = async ($: Engine) => (await runCommand($)).text

// ---- drawing ----

test('band draws on desktop and terminal, tier by width', async ($, on) => {
  engine(on, [])
  await start($)
  await measure($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const wide = await $.ui.mount({ ...band(80), surface })
    expect(await shown(wide)).toBe(WIDE)
    const pct = await wide.find({ type: 'Text', text: '40%' })
    expect(pct?.props.color).toBe('warning')
    expect(pct?.props.tabular).toBe(true)
    await wide.unmount()
    const narrow = await $.ui.mount({ ...band(20), surface })
    expect(await shown(narrow)).toBe('72% 40% cold')
    expect(await barsOf(narrow)).toEqual([])
    await narrow.unmount()
  }
})

test('band yields to a survey', async ($, on) => {
  engine(on, LIMITS)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await start($)
  const ui = await $.ui.mount({ ...band(80, true), surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('band under 6 columns gives the engine band; at 6 it cuts to fit (F9)', async ($, on) => {
  engine(on, [])
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await start($)
  await measure($)
  const tiny = await $.ui.mount({ ...band(5), surface: 'desktop' })
  expect((await tiny.find({ type: 'Text' }))?.text).toBe('engine')
  await tiny.unmount()
  expect(await bandText($, 6)).toBe('72% 40')
})

test('the Pane component is not handled: render falls through to the engine', async ($, on) => {
  const { opens } = engine(on, [])
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await start($)
  await measure($)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [placement, cols] of [['dock', 30], ['dock', 64], ['inline', 40], ['inline', 80]] as const) {
      const p = await $.ui.mount({ ...pane(placement, cols), surface })
      expect((await p.find({ type: 'Text' }))?.text).toBe('engine')
      expect(await p.find({ type: 'Svg' })).toBe(undefined)
      expect(await p.findAll({ type: 'Text' })).toHaveLength(1)
      await p.unmount()
    }
  }
  expect(opens).toEqual([])
})

test('session.measure updates a mounted band', async ($, on) => {
  engine(on, [])
  await start($)
  const ui = await $.ui.mount({ ...band(80), surface: 'desktop' })
  expect(await shown(ui)).toBe(NONE)
  await measure($, [{ ...LIMITS[0]!, percentUsed: 85 }, LIMITS[1]!])
  expect(await shown(ui)).toBe('5h ##-------- 15% 2h 14m  |  7d ####------ 40% 3d 4h  |  Cache ---------- cold')
  expect((await ui.find({ type: 'Text', text: '15%' }))?.props.color).toBe('error')
  expect((await barsOf(ui))[0]?.props.backgroundColor).toBe('error')
  await ui.unmount()
})

test('cache goes hot to cold after the TTL (auto, nothing learned: 1h)', async ($, on) => {
  const { clock, mem } = engine(on, LIMITS)
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  const ui = await $.ui.mount({ ...band(99), surface: 'desktop' })
  expect(await shown(ui)).toContain('|  Cache ########## hot 60m')
  await clock.advance(59 * MIN)
  expect(await shown(ui)).toContain('|  Cache #--------- hot 01:00')
  expect((await ui.find({ type: 'Text', text: /hot/ }))?.props.color).toBe('warning')
  expect((await barsOf(ui)).filter(t => t.props.backgroundColor === 'warning').length).toBe(1)
  await clock.advance(61_000)
  expect(await shown(ui)).toContain('|  Cache ---------- cold')
  expect(mem.ttl).toBe(undefined)
  await ui.unmount()
})

test('config 5m: cache goes hot to cold after 5 minutes', { options: { cacheTtl: '5m' } }, async ($, on) => {
  const { clock } = engine(on, LIMITS)
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  const ui = await $.ui.mount({ ...band(99), surface: 'desktop' })
  expect(await shown(ui)).toContain('|  Cache ########## hot 05:00')
  await clock.advance(4 * MIN)
  expect(await shown(ui)).toContain('|  Cache ##-------- hot 01:00')
  expect((await ui.find({ type: 'Text', text: /hot/ }))?.props.color).toBe('warning')
  await clock.advance(61_000)
  expect(await shown(ui)).toContain('|  Cache ---------- cold')
  await ui.unmount()
})

test('1h TTL from options: whole minutes over 10:00, mm:ss under (F6)', { options: { cacheTtl: '1h' } }, async ($, on) => {
  const { clock } = engine(on, LIMITS)
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  await clock.advance(10 * MIN)
  expect(await bandText($)).toContain('|  Cache ########-- hot 50m')
  await clock.advance(41 * MIN)
  expect(await bandText($)).toMatch(/\|  Cache #+-+ hot 09:00$/)
})

test('no data: no readings and no stored snapshot', async ($, on) => {
  engine(on, [])
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(80), surface })
    expect(await shown(ui)).toBe(NONE)
    await ui.unmount()
  }
  expect(await readout($)).toBe(
    ['5-hour: no reading yet', '7-day: no reading yet', 'Cache: cold (new)', 'Cache state is an estimate.'].join('\n'),
  )
})

test('stored snapshot shows dim with its age', async ($, on) => {
  engine(on, [], { limits: { observedAt: NOW - 30 * MIN, items: LIMITS } })
  await start($)
  const ui = await $.ui.mount({ ...band(99), surface: 'desktop' })
  const text = await allText(ui)
  expect(text).toContain('72%')
  expect((await ui.find({ type: 'Text', text: '72%' }))?.props.dimColor).toBe(true)
  await ui.unmount()
  expect(await readout($)).toContain('5-hour: 72% left, resets in 2h 14m (as of 30m ago)')
})

test('bar runs draw as Text with backgroundColor, track subtle', async ($, on) => {
  engine(on, [])
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await measure($)
  await step($)
  const ui = await $.ui.mount({ ...band(99), surface: 'desktop' })
  expect(await shown(ui)).toBe('5h #######--- 72% 2h 14m  |  7d ####------ 40% 3d 4h  |  Cache ########## hot 60m')
  const bars = await barsOf(ui)
  expect(bars.map(t => [t.props.backgroundColor, t.text.length])).toEqual([
    ['success', 7], ['subtle', 3], ['warning', 4], ['subtle', 6], ['success', 10],
  ])
  for (const t of bars) {
    expect(/^ +$/.test(t.text)).toBe(true)
    expect(t.props.color).toBe(undefined)
    expect(t.props.dimColor).toBe(undefined)
  }
  // Text segments carry no background.
  const plain = (await ui.findAll({ type: 'Text' })).filter(t => t.props.backgroundColor === undefined)
  expect(plain.some(t => t.text === '72%')).toBe(true)
  await ui.unmount()
})

test('bar colours: error under 20, inactive when stale', async ($, on) => {
  engine(on, [], { limits: { observedAt: NOW - 30 * MIN, items: LIMITS } })
  await start($)
  const stale = await $.ui.mount({ ...band(99), surface: 'desktop' })
  expect((await barsOf(stale)).map(t => t.props.backgroundColor)).toEqual(['inactive', 'subtle', 'inactive', 'subtle', 'subtle'])
  await stale.unmount()
  await measure($, [{ ...LIMITS[0]!, percentUsed: 81 }, { ...LIMITS[1]!, percentUsed: 49 }])
  const live = await $.ui.mount({ ...band(99), surface: 'desktop' })
  expect((await barsOf(live)).map(t => [t.props.backgroundColor, t.text.length])).toEqual([
    ['error', 2], ['subtle', 8], ['success', 5], ['subtle', 5], ['subtle', 10],
  ])
  await live.unmount()
})

// ---- next(e) exactly once per hook (F14) ----

test('session.start reaches the engine once and passes its result through', async ($, on) => {
  const { calls } = engine(on, LIMITS)
  const r = await $.session.start({ cwd: '/x', surface: 'desktop', isInteractive: true })
  expect(calls['session.start']).toBe(1)
  expect(r.cwd).toBe('/x')
})

test('classic.SessionStart reaches the engine once for every source', async ($, on) => {
  const { calls } = engine(on, LIMITS)
  await start($)
  const sources = ['startup', 'resume', 'clear', 'compact', 'fork'] as const
  for (const source of sources) {
    const r = await $.classic.SessionStart({ source, seconds_since_last_response: 400, prompt_cache_likely_expired: false })
    expect(r.additionalContext).toEqual(['beneath'])
  }
  expect(calls['classic.SessionStart']).toBe(sources.length)
})

test('classic.PostCompact reaches the engine once', async ($, on) => {
  const { calls } = engine(on, LIMITS)
  await start($)
  const r = await $.classic.PostCompact({ trigger: 'auto', compact_summary: 's' })
  expect(calls['classic.PostCompact']).toBe(1)
  expect(r.stopReason).toBe('beneath')
})

test('classic.PostModelSwitch reaches the engine once', async ($, on) => {
  const { calls } = engine(on, LIMITS)
  await start($)
  const r = await modelSwitch($, 'm2', '1h')
  expect(calls['classic.PostModelSwitch']).toBe(1)
  expect(r.additionalContext).toEqual(['beneath'])
})

test('session.end reaches the engine once for every reason', async ($, on) => {
  const { calls } = engine(on, LIMITS)
  await start($)
  for (const reason of ['clear', 'resume', 'other'] as const) {
    const r = await end($, reason)
    expect(r.sessionId).toBe('s1')
  }
  expect(calls['session.end']).toBe(3)
})

test('session.measure reaches the engine once, with or without readings', async ($, on) => {
  const { calls } = engine(on, [])
  await start($)
  expect((await measure($)).changed).toEqual(['rateLimits'])
  expect((await measure($, [], [])).changed).toEqual([])
  expect(calls['session.measure']).toBe(2)
})

test('turn.complete reaches the engine once', async ($, on) => {
  const { calls } = engine(on, LIMITS)
  await start($)
  const r = await complete($)
  expect(calls['turn.complete']).toBe(1)
  expect(r.text).toBe('done')
})

test('a main step reaches the engine once; no cache use gives no stamp', async ($, on) => {
  engine(on, LIMITS)
  const calls = answerSteps(on, { read: 0, creation: 0, input: 1 })
  await start($)
  const r = await step($)
  expect(r.answer).toBe('ok')
  expect(calls()).toBe(1)
  expect(await readout($)).toContain('Cache: cold (new)')
})

test('a subagent step passes through once and is not stamped', async ($, on) => {
  engine(on, LIMITS)
  const calls = answerSteps(on, { read: 500, creation: 0, input: 1 })
  await start($)
  const r = await step($, 'a1')
  expect(r.answer).toBe('ok')
  expect(calls()).toBe(1)
  expect(await bandText($)).toContain('|  Cache ---------- cold')
})

test('own work failing still reaches the engine once on every hook', async ($, on) => {
  const { calls } = engine(on, LIMITS)
  const stepCalls = answerSteps(on, { read: 10, creation: 10, input: 1 })
  on('state.get', () => {
    throw new Error('state down at /home/cj/secret')
  })
  await start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 10 })
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 's' })
  await modelSwitch($, 'm2', '5m')
  await measure($)
  await step($)
  await end($, 'clear')
  for (const k of ['session.start', 'classic.SessionStart', 'classic.PostCompact', 'classic.PostModelSwitch', 'session.measure', 'session.end']) {
    expect([k, calls[k]]).toEqual([k, 1])
  }
  expect(stepCalls()).toBe(1)
})

// ---- scheduler ----

test('a past resetsAt does not loop the scheduler', async ($, on) => {
  const past: SessionUsage['rateLimits'] = [
    { kind: 'five_hour', percentUsed: 99, resetsAt: new Date(NOW - 5 * MIN).toISOString() },
    { kind: 'seven_day', percentUsed: 10, resetsAt: new Date(NOW - 1000).toISOString() },
  ]
  const { clock, ticks } = engine(on, [])
  await start($)
  await measure($, past)
  const before = ticks()
  await clock.advance(10 * MIN)
  // Minute ticks: about 10 wakes in 10 minutes, never hundreds.
  expect(ticks() - before).toBeGreaterThan(0)
  expect(ticks() - before).toBeLessThanOrEqual(11)
})

test('many state changes still leave one timer (cancel before reschedule)', async ($, on) => {
  const { clock, ticks } = engine(on, [])
  answerSteps(on, { read: 0, creation: 0, input: 1 })
  await start($)
  await measure($)
  await measure($)
  await step($)
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 's' })
  const before = ticks()
  await clock.advance(10 * MIN)
  expect(ticks() - before).toBeGreaterThan(5)
  expect(ticks() - before).toBeLessThanOrEqual(11)
})

// ---- cache transitions ----

test('PostCompact reads cold (compacted) until the next main step', async ($, on) => {
  engine(on, LIMITS)
  answerSteps(on, [{ read: 9000, creation: 0, input: 10 }, { read: 0, creation: 4000, input: 10 }])
  await start($)
  await step($)
  expect(await bandText($)).toContain('|  Cache ########## hot 60m')
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 's' })
  expect(await readout($)).toContain('Cache: cold (compacted)')
  expect(await bandText($)).toContain('|  Cache ---------- cold')
  await step($)
  expect(await bandText($)).toContain('|  Cache ########## hot 60m')
})

test('SessionStart compact reads cold (compacted)', async ($, on) => {
  engine(on, LIMITS)
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  await $.classic.SessionStart({ source: 'compact' })
  expect(await readout($)).toContain('Cache: cold (compacted)')
})

test('PostModelSwitch: the old stamp reads cold (model changed)', async ($, on) => {
  engine(on, LIMITS)
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  await modelSwitch($, 'm2', '5m')
  expect(await readout($)).toContain('Cache: cold (model changed)')
})

test('/clear: SessionStart clear and session.end clear reset the cache, limits kept', async ($, on) => {
  engine(on, [])
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await measure($)
  await step($)
  expect(await bandText($)).toContain('|  Cache ########## hot 60m')
  await $.classic.SessionStart({ source: 'clear' })
  expect(await bandText($)).toBe(WIDE)
  await step($)
  expect(await bandText($)).toContain('|  Cache ########## hot 60m')
  await end($, 'clear')
  expect(await bandText($)).toBe(WIDE)
})

test('session.end resume resets the cache; other reasons do not (F4)', async ($, on) => {
  engine(on, LIMITS)
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  await end($, 'other')
  expect(await bandText($)).toContain('|  Cache ########## hot 60m')
  await end($, 'resume')
  expect(await bandText($)).toContain('|  Cache ---------- cold')
})

test('resume without seconds_since_last_response never keeps the old hot stamp (F4)', async ($, on) => {
  engine(on, LIMITS)
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  await $.classic.SessionStart({ source: 'resume' })
  expect(await readout($)).toContain('Cache: cold (new)')
})

test('resume with prompt_cache_likely_expired reads cold', async ($, on) => {
  engine(on, LIMITS)
  await start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 120, prompt_cache_likely_expired: true })
  expect(await readout($)).toContain('Cache: cold (expired on resume)')
})

test('resume within the TTL reads hot from seconds_since_last_response', async ($, on) => {
  engine(on, LIMITS)
  await start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 120, prompt_cache_likely_expired: false })
  // Auto, nothing learned: 1h, so 58m left.
  expect(await bandText($)).toContain('|  Cache ########## hot 58m')
})

test('resume within a 5m TTL reads hot from seconds_since_last_response', { options: { cacheTtl: '5m' } }, async ($, on) => {
  engine(on, LIMITS)
  await start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 120, prompt_cache_likely_expired: false })
  expect(await bandText($)).toContain('|  Cache ######---- hot 03:00')
})

// ---- TTL (F1) ----

test('auto with nothing learned uses 1h', async ($, on) => {
  const { clock, mem } = engine(on, LIMITS)
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  await clock.advance(30 * MIN)
  expect(await bandText($)).toContain('|  Cache #####----- hot 30m')
  expect(mem.ttl).toBe(undefined)
  expect(await readout($)).toContain('Cache: hot, 30m left of 1h TTL')
})

test('PostModelSwitch cache_ttl 1h is learned and stored, moving a stored 5m up', async ($, on) => {
  const { clock, mem } = engine(on, LIMITS, { ttl: '5m' })
  answerSteps(on, { read: 0, creation: 9000, input: 10, model: 'm2' })
  await start($)
  await modelSwitch($, 'm2', '1h')
  expect(mem.ttl).toBe('1h')
  await step($)
  await clock.advance(10 * MIN)
  expect(await bandText($)).toContain('|  Cache ########-- hot 50m')
})

test('PostModelSwitch cache_ttl 5m moves a stored 1h down', async ($, on) => {
  const { clock, mem } = engine(on, LIMITS, { ttl: '1h' })
  answerSteps(on, { read: 0, creation: 9000, input: 10, model: 'm2' })
  await start($)
  await modelSwitch($, 'm2', '5m')
  expect(mem.ttl).toBe('5m')
  await step($)
  await clock.advance(4 * MIN)
  expect(await bandText($)).toContain('|  Cache ##-------- hot 01:00')
  await clock.advance(2 * MIN)
  expect(await bandText($)).toContain('|  Cache ---------- cold')
})

test('a stored 5m is loaded at start', async ($, on) => {
  const { clock } = engine(on, LIMITS, { ttl: '5m' })
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  expect(await bandText($)).toContain('|  Cache ########## hot 05:00')
  await clock.advance(6 * MIN)
  expect(await bandText($)).toContain('|  Cache ---------- cold')
})

test('a stored 1h is loaded at start', async ($, on) => {
  const { clock } = engine(on, LIMITS, { ttl: '1h' })
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  await clock.advance(10 * MIN)
  expect(await bandText($)).toContain('|  Cache ########-- hot 50m')
})

test('config 5m ignores a stored or reported 1h', { options: { cacheTtl: '5m' } }, async ($, on) => {
  const { clock, mem } = engine(on, LIMITS, { ttl: '1h' })
  answerSteps(on, { read: 9000, creation: 0, input: 10, model: 'm2' })
  await start($)
  await modelSwitch($, 'm2', '1h')
  await step($)
  expect(await bandText($)).toContain('|  Cache ########## hot 05:00')
  await clock.advance(6 * MIN)
  expect(await bandText($)).toContain('|  Cache ---------- cold')
  expect(mem.ttl).toBe('1h')
})

test('resume: engine says warm after 400 s, so 1h is learned over a stored 5m', async ($, on) => {
  const { clock, mem } = engine(on, LIMITS, { ttl: '5m' })
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 400, prompt_cache_likely_expired: false })
  expect(mem.ttl).toBe('1h')
  await step($)
  await clock.advance(10 * MIN)
  expect(await bandText($)).toContain('|  Cache ########-- hot 50m')
})

test('resume: engine says expired after 6 min, a stored 1h moves down', async ($, on) => {
  const { clock, mem } = engine(on, LIMITS, { ttl: '1h' })
  answerSteps(on, { read: 0, creation: 9000, input: 10 })
  await start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 360, prompt_cache_likely_expired: true })
  expect(mem.ttl).toBe('5m')
  await step($)
  await clock.advance(10 * MIN)
  expect(await bandText($)).toContain('|  Cache ---------- cold')
})

test('steps never teach the TTL: a fork keeping the prefix warm learns nothing', async ($, on) => {
  // Learned 5m: a warm prefix after 7 minutes would mean 1h if steps taught it.
  const { clock, mem } = engine(on, LIMITS, { ttl: '5m' })
  answerSteps(on, [
    { read: 0, creation: 20_000, input: 10 },
    { read: 20_000, creation: 500, input: 10 },
    { read: 20_500, creation: 300, input: 10 },
  ])
  await start($)
  await step($)
  await clock.advance(4 * MIN)
  await step($, 'memory-fork')
  await clock.advance(3 * MIN)
  await step($)
  expect(mem.ttl).toBe('5m')
  await clock.advance(10 * MIN)
  expect(await bandText($)).toContain('|  Cache ---------- cold')
})

// ---- limits (F2, F3, F5, F13) ----

test('measure writes the limits to the store, three fields per window only', async ($, on) => {
  const { clock, mem } = engine(on, [])
  await start($)
  await clock.advance(MIN)
  await measure($, [{ ...LIMITS[0]!, extra: 'C:/Users/cj' } as SessionUsage['rateLimits'][number], { kind: 'seven_day', percentUsed: 60 }])
  expect(mem.limits).toEqual({
    observedAt: NOW + MIN,
    items: [
      { kind: 'five_hour', percentUsed: 28, resetsAt: LIMITS[0]!.resetsAt },
      { kind: 'seven_day', percentUsed: 60 },
    ],
  })
})

test('every measure with readings refreshes observedAt, changed or not (F2)', async ($, on) => {
  const { clock, mem } = engine(on, [])
  await start($)
  await measure($)
  await clock.advance(15 * MIN)
  await measure($, LIMITS, [])
  expect((mem.limits as { observedAt: number }).observedAt).toBe(NOW + 15 * MIN)
  const ui = await $.ui.mount({ ...band(80), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: '72%' }))?.props.dimColor).toBe(undefined)
  await ui.unmount()
})

test('live limits read long ago draw stale with their age (F2)', async ($, on) => {
  const { clock } = engine(on, [])
  await start($)
  await measure($)
  await clock.advance(3 * H)
  // The 5h window has rolled by now; the 7d one is stale.
  const ui = await $.ui.mount({ ...band(99), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: '40%' }))?.props.dimColor).toBe(true)
  await ui.unmount()
  expect(await readout($)).toContain('as of 3h 0m ago')
})

test('session.start: usage readings only when no snapshot, and drawn stale (F3)', async ($, on) => {
  const { mem } = engine(on, LIMITS)
  await start($)
  expect(mem.limits).toBe(undefined)
  const ui = await $.ui.mount({ ...band(80), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: '72%' }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('session.start never stamps usage over a stored snapshot (F3)', async ($, on) => {
  const stored = { observedAt: NOW - 30 * MIN, items: [{ kind: 'five_hour', percentUsed: 50 }] }
  const { clock, mem } = engine(on, LIMITS, { limits: stored })
  await start($)
  await clock.advance(2 * H)
  await start($)
  expect(mem.limits).toEqual(stored)
  expect(await readout($)).toContain('5-hour: 50% left')
})

test('n/a only after a step with a response, not from turn.complete (F5)', async ($, on) => {
  engine(on, [])
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  await start($)
  await complete($)
  expect(await bandText($)).toContain('5h --')
  const r = await step($)
  expect(r.usage).toBe(null)
  expect(await bandText($)).toContain('5h --')
})

test('n/a after a main step with usage and no readings (F5)', async ($, on) => {
  engine(on, [])
  answerSteps(on, { read: 0, creation: 0, input: 1 })
  await start($)
  await step($)
  expect(await bandText($)).toContain('Limits n/a')
})

test('debug log carries the hook and error name only (F13)', async ($, on) => {
  const { logs, fail } = engine(on, LIMITS)
  fail.storeGet = true
  await start($)
  const line = logs.find(l => l.includes('session.start load'))
  // The host wraps a failed call; the name is all that is logged.
  expect(/^usage-hud: session\.start load failed: \w+$/.test(line ?? '')).toBe(true)
  expect(logs.some(l => l.includes('Users'))).toBe(false)
})

// ---- no pane: the mod draws only the band ----

test('session.start never opens a pane, on any surface', async ($, on) => {
  const { opens } = engine(on, LIMITS, {}, ['desktop', 'terminal'])
  for (const surface of [null, 'desktop', 'terminal', 'mobile'] as const) {
    await $.session.start({ cwd: '/', surface, isInteractive: true })
  }
  await start($)
  await start($)
  expect(opens).toEqual([])
})

test('session.start never opens a pane, even with no surface listed yet', async ($, on) => {
  const { opens, logs } = engine(on, LIMITS, {}, [])
  await start($)
  await start($, 'terminal')
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  expect(opens).toEqual([])
  expect(logs).toEqual([])
})

test('/usage-hud answers text and does not open a pane', async ($, on) => {
  const { opens } = engine(on, [])
  await start($)
  await measure($)
  const r = await runCommand($)
  expect(r.text).toContain('5-hour: 72% left, resets in 2h 14m')
  expect(r.text).toContain('7-day: 40% left')
  expect(r.text).toContain('Cache: cold')
  expect(r.text).toContain('Cache state is an estimate.')
  expect(/pane|engine/i.test(r.text)).toBe(false)
  for (const isFullscreen of [true, false]) {
    await $.command.run({
      command: 'usage-hud', args: '', origin: { kind: 'composer' },
      presentation: { isFullscreen, columns: isFullscreen ? 120 : 40 },
    })
  }
  expect(opens).toEqual([])
})

// ---- safety ----

test('classic hook: beneath throws, beneath still runs once', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, {})
  let calls = 0
  on('classic.SessionStart', () => {
    calls += 1
    throw new Error('settings hook failed')
  })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 10 }).catch(() => undefined)
  expect(calls).toBe(1)
})

test('turn.step: beneath throws, the error reaches the caller and the request ran once', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, {})
  let calls = 0
  on('turn.step', async function* () {
    calls += 1
    throw new Error('api 529')
  })
  let failed = false
  await step($).catch(() => {
    failed = true
  })
  expect(failed).toBe(true)
  expect(calls).toBe(1)
})

// ---- art themes (0.3.0): kitTest, so the manifest default (clean) applies ----

const attach = ($: Engine, surface: 'desktop' | 'mobile' | 'terminal', clientId = surface + ':default') =>
  $.session.attach({ surface, clientId })

const countAttach = (on: On) => {
  let n = 0
  on('session.attach', (_, e) => {
    n += 1
    return { clientId: e.clientId }
  })
  return () => n
}

// Every art look; the loops below run for each, so a new look is covered by listing it here.
const ART_LOOKS = ['clean', 'classic', 'midnight', 'paper', 'terminal', 'sunset', 'mono'] as const

for (const theme of ART_LOOKS) {
  kitTest(`${theme}: the desktop band draws Svg with the readout as alt`, { options: { theme } }, async ($, on) => {
    engine(on, [])
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    await start($)
    await measure($)
    const b = await $.ui.mount({ ...band(99), surface: 'desktop' })
    const svg = await b.find({ type: 'Svg' })
    expect(svg?.props.width).toBe(742)
    expect(svg?.props.height).toBe(44)
    expect(String(svg?.props.source).startsWith('<svg ')).toBe(true)
    expect(svg?.props.alt).toBe(
      '5-hour: 72% left, resets in 2h 14m 7-day: 40% left, resets in 3d 4h Cache: cold (new) Cache state is an estimate.',
    )
    expect(await b.find({ type: 'Text' })).toBe(undefined)
    await b.unmount()
    // No pane: a Pane render is not the mod's, so it draws no Svg and the engine answers.
    const p = await $.ui.mount({ ...pane('dock', 64), surface: 'desktop' })
    expect(await p.find({ type: 'Svg' })).toBe(undefined)
    expect((await p.find({ type: 'Text' }))?.text).toBe('engine')
    await p.unmount()
  })

  kitTest(`${theme}: the terminal always draws Text`, { options: { theme } }, async ($, on) => {
    engine(on, [], {}, ['terminal'])
    await start($, 'terminal')
    await measure($)
    const b = await $.ui.mount({ ...band(80), surface: 'terminal' })
    expect(await shown(b)).toBe(WIDE)
    expect(await b.find({ type: 'Svg' })).toBe(undefined)
    await b.unmount()
  })
}

// The clean look's svg ids start with uhn (band, dark: uhndb); any other look's differ.
const CLEAN_ID = 'id="uhndbP"'

kitTest('the manifest default is clean', async ($, on) => {
  engine(on, [])
  await start($)
  const b = await $.ui.mount({ ...band(99), surface: 'desktop' })
  const src = String((await b.find({ type: 'Svg' }))?.props.source)
  expect(src).toContain(CLEAN_ID)
  await b.unmount()
})

kitTest('explicit theme clean draws Svg on the desktop and Text on the terminal', { options: { theme: 'clean' } }, async ($, on) => {
  engine(on, LIMITS, {}, ['desktop', 'terminal'])
  await start($)
  await measure($)
  const d = await $.ui.mount({ ...band(99), surface: 'desktop' })
  const svg = await d.find({ type: 'Svg' })
  expect(String(svg?.props.source).startsWith('<svg ')).toBe(true)
  expect(String(svg?.props.source)).toContain(CLEAN_ID)
  expect(await d.find({ type: 'Text' })).toBe(undefined)
  await d.unmount()
  const t = await $.ui.mount({ ...band(80), surface: 'terminal' })
  expect(await t.find({ type: 'Svg' })).toBe(undefined)
  expect(await shown(t)).toContain('5h')
  await t.unmount()
})

kitTest('a saved theme of christmas (removed in 0.4.0) falls back to the default clean look', { options: { theme: 'christmas' as any } }, async ($, on) => {
  engine(on, LIMITS, {}, ['desktop', 'terminal'])
  await start($)
  await measure($)
  const b = await $.ui.mount({ ...band(99), surface: 'desktop' })
  const src = String((await b.find({ type: 'Svg' }))?.props.source)
  expect(src).toContain(CLEAN_ID)
  for (const c of ['snowflake', 'holly', 'ornament', 'stripes']) expect(src.includes(c)).toBe(false)
  await b.unmount()
  // The terminal still draws text.
  const t = await $.ui.mount({ ...band(80), surface: 'terminal' })
  expect(await t.find({ type: 'Svg' })).toBe(undefined)
  await t.unmount()
})

for (const theme of ['midnight', 'paper', 'terminal', 'sunset', 'mono'] as const) {
  kitTest(`explicit theme ${theme} draws its own svg on the desktop`, { options: { theme } }, async ($, on) => {
    engine(on, [])
    await start($)
    await measure($)
    const b = await $.ui.mount({ ...band(99), surface: 'desktop' })
    const src = String((await b.find({ type: 'Svg' }))?.props.source)
    expect(src.startsWith('<svg ')).toBe(true)
    expect(src.includes(CLEAN_ID)).toBe(false)
    await b.unmount()
  })
}

kitTest('text theme draws Text on the desktop', { options: { theme: 'text' } }, async ($, on) => {
  engine(on, [])
  await start($)
  await measure($)
  const b = await $.ui.mount({ ...band(80), surface: 'desktop' })
  expect(await shown(b)).toBe(WIDE)
  expect(await b.find({ type: 'Svg' })).toBe(undefined)
  await b.unmount()
})

kitTest('art: too narrow for art draws text, and under 6 columns the engine band', async ($, on) => {
  engine(on, [])
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await start($)
  await measure($)
  const narrow = await $.ui.mount({ ...band(10), surface: 'desktop' })
  expect(await narrow.find({ type: 'Svg' })).toBe(undefined)
  expect(await shown(narrow)).toBe('72% 40% co')
  await narrow.unmount()
  const tiny = await $.ui.mount({ ...band(5), surface: 'desktop' })
  expect((await tiny.find({ type: 'Text' }))?.text).toBe('engine')
  await tiny.unmount()
})

kitTest('SVG themes never wake faster than 60 s, even with the cache under 10 minutes', async ($, on) => {
  const { clock, ticks } = engine(on, LIMITS)
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  await clock.advance(51 * MIN)
  const before = ticks()
  await clock.advance(5 * MIN)
  expect(ticks() - before).toBeLessThanOrEqual(5)
  expect(ticks() - before).toBeGreaterThan(0)
})

kitTest('the text theme still ticks seconds under 10 minutes', { options: { theme: 'text' } }, async ($, on) => {
  const { clock, ticks } = engine(on, LIMITS)
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  await clock.advance(51 * MIN)
  const before = ticks()
  await clock.advance(MIN)
  expect(ticks() - before).toBeGreaterThan(30)
})

kitTest('with a terminal attached, an SVG theme keeps the text second ticks', async ($, on) => {
  const { clock, ticks } = engine(on, LIMITS, {}, ['terminal'])
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($, 'terminal')
  await step($)
  await clock.advance(51 * MIN)
  const before = ticks()
  await clock.advance(MIN)
  expect(ticks() - before).toBeGreaterThan(30)
})

kitTest('session.attach redraws and never opens a pane (desktop, terminal, phone)', async ($, on) => {
  const surfaces: ('desktop' | 'terminal')[] = []
  const { opens, ticks, logs } = engine(on, LIMITS, {}, surfaces)
  const attached = countAttach(on)
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  surfaces.push('desktop', 'terminal')
  let n = 0
  const redraws = async (go: () => Promise<unknown>) => {
    const before = ticks()
    await go()
    n += 1
    expect(ticks()).toBeGreaterThan(before)
    expect(attached()).toBe(n)
  }
  // Desktop, fullscreen or not, with or without a viewport.
  await redraws(() => attach($, 'desktop'))
  await redraws(() => attach($, 'desktop', 'desktop:2'))
  await redraws(() => $.session.attach({ surface: 'desktop', clientId: 'd1', viewport: { columns: 64, rows: 40, isFullscreen: true } }))
  await redraws(() => $.session.attach({ surface: 'desktop', clientId: 'd2', viewport: { columns: 64, rows: 40, isFullscreen: false } }))
  // Terminal, fullscreen or not.
  await redraws(() => attach($, 'terminal'))
  await redraws(() => $.session.attach({ surface: 'terminal', clientId: 'terminal:fs', viewport: { columns: 80, rows: 24, isFullscreen: true } }))
  // Phone, fullscreen or not.
  await redraws(() => attach($, 'mobile'))
  await redraws(() => $.session.attach({ surface: 'mobile', clientId: 'mobile:1', viewport: { columns: 40, rows: 60, isFullscreen: false } }))
  await redraws(() => $.session.attach({ surface: 'mobile', clientId: 'mobile:2', viewport: { columns: 40, rows: 60, isFullscreen: true } }))
  expect(opens).toEqual([])
  expect(logs).toEqual([])
})

kitTest('session.attach with no surface listed does not open and logs nothing', async ($, on) => {
  const { opens, logs } = engine(on, LIMITS, {}, [])
  const attached = countAttach(on)
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await attach($, 'terminal')
  await attach($, 'desktop')
  expect(opens).toEqual([])
  expect(logs).toEqual([])
  expect(attached()).toBe(2)
})

kitTest('session.attach: own work failing still reaches the engine once', async ($, on) => {
  let down = false
  const logs: string[] = []
  const opens: string[] = []
  on('clock.now', () => {
    if (down) throw new TypeError('clock')
    return { value: NOW }
  })
  on('clock.after', () => new Promise<any>(() => {}))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200000 }, rateLimits: LIMITS } }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', (_, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.log', (_, e) => { logs.push(e.text); return { value: undefined } })
  on('command.register', () => ({ value: { command: 'usage-hud' } }))
  const attached = countAttach(on)
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  down = true
  const r = await attach($, 'desktop')
  expect(r.clientId).toBe('desktop:default')
  expect(attached()).toBe(1)
  expect(opens).toEqual([])
  expect(logs.length).toBe(1)
  expect(/^usage-hud: session.attach schedule failed: \w+$/.test(logs[0] ?? '')).toBe(true)
})

kitTest('no surfaces and no client start: no open, no error line; /usage-hud still answers text', async ($, on) => {
  const { opens, logs } = engine(on, [], {}, [])
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await measure($)
  expect(opens).toEqual([])
  expect(logs).toEqual([])
  const r = await $.command.run({
    command: 'usage-hud', args: '', origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(r.text).toContain('5-hour: 72% left, resets in 2h 14m')
  expect(r.text).toContain('Cache state is an estimate.')
  expect(opens).toEqual([])
})

// ---- REVIEW 0.3 adversarial ----

for (const bad of ['neon', 'TEXT', 'Christmas', 'christmas', 'Clean', '', 42, ['text']] as unknown[]) {
  kitTest(`R4 invalid theme ${JSON.stringify(bad)} falls back to clean`, { options: { theme: bad as any } }, async ($, on) => {
    engine(on, LIMITS)
    await start($)
    await measure($)
    const b = await $.ui.mount({ ...band(99), surface: 'desktop' })
    const svg = await b.find({ type: 'Svg' })
    expect(svg).not.toBe(undefined)
    expect(await b.find({ type: 'Text' })).toBe(undefined)
    const src = String(svg?.props.source)
    expect(src.startsWith('<svg ')).toBe(true)
    expect(src).toContain(CLEAN_ID)
    await b.unmount()
  })
}

kitTest('R5 text theme on the desktop draws the band exactly as on the terminal', { options: { theme: 'text' } }, async ($, on) => {
  engine(on, LIMITS)
  await start($)
  await measure($)
  for (const c of [6, 12, 25, 40, 80, 99, 200]) {
    const d = await $.ui.mount({ ...band(c), surface: 'desktop' })
    const t = await $.ui.mount({ ...band(c), surface: 'terminal' })
    expect(await shown(d)).toBe(await shown(t))
    expect(await d.find({ type: 'Svg' })).toBe(undefined)
    await d.unmount(); await t.unmount()
  }
})

kitTest('R11 text theme cadence unchanged: seconds under 10 min of cache', { options: { theme: 'text' } }, async ($, on) => {
  const { clock, ticks } = engine(on, LIMITS)
  answerSteps(on, { read: 9000, creation: 0, input: 10 })
  await start($)
  await step($)
  await clock.advance(51 * MIN)
  const before = ticks()
  await clock.advance(MIN)
  expect(ticks() - before).toBeGreaterThanOrEqual(55)
})

kitTest('R1 render with a throwing clock falls back to next(e) on the Svg path', async ($, on) => {
  let boom = false
  let logs: string[] = []
  on('clock.now', () => {
    if (boom) throw new TypeError('clock')
    return { value: NOW }
  })
  on('clock.after', () => new Promise<any>(() => {}))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200000 }, rateLimits: LIMITS } }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: [...e.changed] }))
  on('ui.log', (_, e) => { logs.push(e.text); return { value: undefined } })
  on('command.register', () => ({ value: { command: 'usage-hud' } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await start($)
  await measure($)
  const ok = await $.ui.mount({ ...band(99), surface: 'desktop' })
  expect(await ok.find({ type: 'Svg' })).not.toBe(undefined)
  await ok.unmount()
  boom = true
  logs = []
  const b = await $.ui.mount({ ...band(99), surface: 'desktop' })
  expect(await b.find({ type: 'Svg' })).toBe(undefined)
  expect((await b.find({ type: 'Text' }))?.text).toBe('engine')
  await b.unmount()
})

for (const theme of [...ART_LOOKS, 'text'] as const) {
  kitTest(`R3 ${theme}: render never writes state`, { options: { theme } }, async ($, on) => {
    let counting = false
    let writes = 0
    on('state.set', (_, e, next) => {
      if (counting) writes += 1
      return next(e)
    })
    engine(on, LIMITS)
    answerSteps(on, { read: 9000, creation: 0, input: 10 })
    await start($)
    await measure($)
    await step($)
    counting = true
    const b = await $.ui.mount({ ...band(99), surface: 'desktop' })
    const t = await $.ui.mount({ ...band(40), surface: 'terminal' })
    expect(writes).toBe(0)
    await b.unmount(); await t.unmount()
  })
}

for (const theme of ART_LOOKS) {
  kitTest(`R10 ${theme}: over 6 simulated hours timer wakes are never under 60 s apart`, { options: { theme } }, async ($, on) => {
    const lim: SessionUsage['rateLimits'] = [
      { kind: 'five_hour', percentUsed: 28, resetsAt: new Date(NOW + 61_000).toISOString() },
      { kind: 'seven_day', percentUsed: 60, resetsAt: new Date(NOW + 90_500).toISOString() },
    ]
    const stamps: number[] = []
    let rec = false
    let clk: { now: () => number } | null = null
    const { clock, ticks } = engine(on, lim)
    answerSteps(on, { read: 9000, creation: 0, input: 10 })
    await start($, 'desktop')
    await measure($, lim)
    await step($)
    rec = true
    let last = ticks()
    // 6 h idle in 5 s steps, no events: record when a wake bumped the tick.
    let t = 0
    for (let i = 0; i < (6 * 60 * 60) / 5; i++) {
      await clock.advance(5000)
      t += 5000
      if (ticks() !== last) { stamps.push(t); last = ticks() }
    }
    let minGap = Infinity
    for (let i = 1; i < stamps.length; i++) minGap = Math.min(minGap, stamps[i]! - stamps[i - 1]!)
    expect(stamps.length).toBeGreaterThan(300)
    expect(minGap).toBeGreaterThanOrEqual(60_000)
    void rec; void clk
  })
}

for (const theme of ART_LOOKS) {
kitTest(`R12 ${theme}: privacy: art themes log nothing and store only limits`, { options: { theme } }, async ($, on) => {
  const { mem, logs, clock } = engine(on, LIMITS)
  countAttach(on)
  answerSteps(on, { read: 9000, creation: 0, input: 10, model: 'claude-<x>&"secret' })
  await start($)
  await measure($)
  await step($)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:cj-laptop' })
  const b = await $.ui.mount({ ...band(99), surface: 'desktop' })
  const src = String((await b.find({ type: 'Svg' }))?.props.source) + String((await b.find({ type: 'Svg' }))?.props.alt)
  expect(src.includes('secret')).toBe(false)
  expect(src.includes('cj-laptop')).toBe(false)
  await clock.advance(10 * MIN)
  expect(logs).toEqual([])
  expect(Object.keys(mem).sort()).toEqual(['limits'])
  await b.unmount()
})
}
