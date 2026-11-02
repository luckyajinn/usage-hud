// usage-hud wiring and render hooks (PLAN section 5).
// Every hook calls next(e) exactly once; own work sits in try/catch that never wraps next.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CacheStamp, LimitsSnap, Ttl, TtlSetting } from '../types'
import { computeView, mergeSnap, nextWake, pickLimit, resolveTtl, stampFromResume, stampFromStep, ttlFromResume } from './data'
import type { View } from './data'
import { bandSegments, commandText, paneLines } from './format'
import type { Seg } from './format'

const PANE = 'usage-hud'
const TITLE = 'Usage'
const TESTED = '2.1.316'
// Engines the mod has been seen working on; the footer flags any other.
const KNOWN_GOOD = ['2.1.309', '2.1.316']

const limitsA = atom({ plugin: 'usage-hud', key: 'limits' } as const, null)
const liveA = atom({ plugin: 'usage-hud', key: 'live' } as const, false)
const cacheA = atom({ plugin: 'usage-hud', key: 'cache' } as const, null)
const modelA = atom({ plugin: 'usage-hud', key: 'model' } as const, null)
const ttlA = atom({ plugin: 'usage-hud', key: 'ttlLearned' } as const, null)
const tickA = atom({ plugin: 'usage-hud', key: 'tick' } as const, 0)
const openedA = atom({ plugin: 'usage-hud', key: 'opened' } as const, false)

type $T = EngineInterface

// Debug log: where it failed and the error's name only (a message can hold a path).
const errName = (err: unknown): string => (err instanceof Error ? err.name : 'non-error')
function log($: $T, where: string, err?: unknown): void {
  try {
    $.ui.log(`usage-hud: ${where}${err === undefined ? '' : ' failed: ' + errName(err)}`, { to: 'debug' })
  } catch {
    // logging is best effort
  }
}

const isSetting = (v: unknown): v is TtlSetting => v === 'auto' || v === '5m' || v === '1h'
const isTtl = (v: unknown): v is Ttl => v === '5m' || v === '1h'

/** A stored snapshot read back, kept to the three fields per window; null when malformed. */
function toSnap(v: unknown): LimitsSnap | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as { observedAt?: unknown; items?: unknown }
  if (typeof o.observedAt !== 'number' || !Array.isArray(o.items)) return null
  const items = o.items.filter(
    (l): l is { kind: string; percentUsed: number; resetsAt?: string } =>
      typeof l === 'object' && l !== null && typeof l.kind === 'string' && typeof l.percentUsed === 'number',
  )
  return { observedAt: o.observedAt, items: items.map(pickLimit) }
}

// Process-local facts (not in PluginState): a reload starts them over.
let setting: TtlSetting = 'auto'
let turnDone = false
let engineVersion: string | null = null
let timer: Timer | null = null

async function viewAt($: $T, now: number): Promise<{ view: View; limits: LimitsSnap | null }> {
  const limits = await read($, limitsA)
  const view = computeView({
    now,
    limits,
    live: await read($, liveA),
    turnDone,
    cache: await read($, cacheA),
    model: await read($, modelA),
    ttl: resolveTtl(setting, await read($, ttlA)),
  })
  return { view, limits }
}

async function bump($: $T): Promise<void> {
  await update($, tickA, n => (n ?? 0) + 1)
}

// One timer: cancelled before each reschedule, wakes at nextWake and bumps tick.
async function schedule($: $T): Promise<void> {
  const now = await $.clock.now()
  const { view, limits } = await viewAt($, now)
  const wait = Math.max(1000, nextWake(view, now, limits) - now)
  timer?.cancel()
  timer = $.clock.after(wait, () => {
    void wake($)
  })
}

async function wake($: $T): Promise<void> {
  try {
    await bump($)
    await schedule($)
  } catch (err) {
    log($, 'wake', err)
  }
}

// After a state change: redraw and reschedule.
async function changed($: $T): Promise<void> {
  await bump($)
  await schedule($)
}

async function coldStamp($: $T, now: number): Promise<CacheStamp> {
  const prev = await read($, cacheA)
  const model = (await read($, modelA)) ?? prev?.model ?? 'unknown'
  return { model, at: now, inputTokens: 0, coldReason: 'compacted' }
}

// Auto mode only: the TTL the engine reported. Account-wide, so it goes to the store too.
async function learnTtl($: $T, t: Ttl | null): Promise<void> {
  if (setting !== 'auto' || t === null) return
  await update($, ttlA, () => t)
  await $.store.set('ttl', t)
}

export const register: Register = (on, options) => {
  setting = isSetting(options.cacheTtl) ? options.cacheTtl : 'auto'
  turnDone = false
  timer?.cancel()
  timer = null

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      engineVersion = (await $.session.version()).version
    } catch (err) {
      log($, 'session.start version', err)
    }
    try {
      const now = await $.clock.now()
      // Store: limits snapshot (newest wins) and the learned ttl.
      let limits = mergeSnap(toSnap(await $.store.get('limits')), await read($, limitsA))
      if (limits === null) {
        // No snapshot at all: the last response's readings, drawn stale (their age is unknown).
        const usage = await $.session.usage()
        if (usage.rateLimits.length > 0) limits = { observedAt: now, items: usage.rateLimits.map(pickLimit) }
      }
      await update($, limitsA, () => limits)
      const ttl = await $.store.get('ttl')
      if (isTtl(ttl)) await update($, ttlA, () => ttl)
    } catch (err) {
      log($, 'session.start load', err)
    }
    try {
      await $.command.register({ name: 'usage-hud', description: 'Show usage left, reset times and prompt cache state' })
    } catch (err) {
      log($, 'session.start command register', err)
    }
    try {
      // Unasked open once per session, only where a pane docks: the desktop, or a host with no surface yet.
      if (!(await read($, openedA))) {
        const surfaces = [...(await $.session.surfaces())]
        if (e.surface !== 'terminal' && (surfaces.length === 0 || surfaces.includes('desktop'))) {
          await update($, openedA, () => true)
          const o = await $.ui.open({ id: PANE, title: TITLE })
          if (!o.isPlaced) log($, 'session.start pane not placed')
        }
      }
    } catch (err) {
      log($, 'session.start pane open', err)
    }
    try {
      await changed($)
    } catch (err) {
      log($, 'session.start schedule', err)
    }
    return r
  })

  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    try {
      const now = await $.clock.now()
      if (e.source === 'resume' || e.source === 'fork') {
        const prev = await read($, cacheA)
        const stamp = stampFromResume({
          now,
          secondsSince: e.seconds_since_last_response,
          expired: e.prompt_cache_likely_expired,
          model: e.model ?? null,
          prev,
        })
        await update($, cacheA, () => stamp)
        // The engine's own verdict on the idle gap says which TTL it uses.
        await learnTtl($, ttlFromResume(e.seconds_since_last_response, e.prompt_cache_likely_expired))
      } else if (e.source === 'clear') {
        await update($, cacheA, () => null)
      } else if (e.source === 'compact') {
        const stamp = await coldStamp($, now)
        await update($, cacheA, () => stamp)
      }
      await changed($)
    } catch (err) {
      log($, 'classic.SessionStart', err)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('classic.PostCompact', async ($, e, next) => {
    const r = await next(e)
    try {
      const stamp = await coldStamp($, await $.clock.now())
      await update($, cacheA, () => stamp)
      await changed($)
    } catch (err) {
      log($, 'classic.PostCompact', err)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('classic.PostModelSwitch', async ($, e, next) => {
    const r = await next(e)
    try {
      // The new model is current now. cache_ttl is the engine's TTL, up or down (account-wide).
      await update($, modelA, () => e.to_model)
      await learnTtl($, isTtl(e.cache_ttl) ? e.cache_ttl : null)
      await changed($)
    } catch (err) {
      log($, 'classic.PostModelSwitch', err)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    const r = await next(e)
    try {
      // A new conversation follows: never keep this one's stamp.
      if (e.reason === 'clear' || e.reason === 'resume') {
        await update($, cacheA, () => null)
        await changed($)
      }
    } catch (err) {
      log($, 'session.end', err)
    }
    return r
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    try {
      // Every measure with readings refreshes observedAt, changed or not, so a live
      // reading only goes stale when no response has come for a while.
      if (e.rateLimits.length > 0) {
        const snap: LimitsSnap = { observedAt: await $.clock.now(), items: e.rateLimits.map(pickLimit) }
        await update($, limitsA, prev => mergeSnap(prev ?? null, snap))
        await update($, liveA, () => true)
        await $.store.set('limits', snap)
        await changed($)
      }
    } catch (err) {
      log($, 'session.measure', err)
    }
    return r
  })

  on('turn.step', async function* ($, e, next) {
    // Subagent steps pass straight through.
    if (e.agentId !== undefined) return yield* next(e)
    let t0: number | null = null
    try {
      t0 = await $.clock.now()
    } catch (err) {
      log($, 'turn.step clock', err)
    }
    const r = yield* next(e)
    try {
      const u = r.usage
      if (u) {
        // A response arrived: from now on, no readings means "Limits n/a".
        turnDone = true
        if (t0 !== null) {
          const info = {
            t0,
            model: u.model,
            read: u.cache_read_input_tokens,
            creation: u.cache_creation_input_tokens,
            input: u.input_tokens,
          }
          await update($, modelA, () => u.model)
          await update($, cacheA, prev => stampFromStep(prev ?? null, info))
        }
        await changed($)
      }
    } catch (err) {
      log($, 'turn.step', err)
    }
    return r
  })

  // Answers its own command only; never reads next.
  on('command.run', { command: 'usage-hud' }, async $ => {
    let text = 'usage-hud: no readout available.\nCache state is an estimate.'
    try {
      const { view } = await viewAt($, await $.clock.now())
      text = commandText(view)
    } catch (err) {
      log($, 'command.run readout', err)
    }
    try {
      const o = await $.ui.open({ id: PANE, title: TITLE })
      if (!o.isPlaced) log($, 'command.run pane not placed')
    } catch (err) {
      log($, 'command.run open', err)
    }
    return { text }
  })

  // ---- render: no writes, next(e) on any error ----

  type Els = { Box: any; Text: any }
  // Bar cells: the tone is the background. Track is the empty part.
  const BAR_BG = {
    normal: 'success', success: 'success', warning: 'warning', error: 'error', dim: 'inactive', track: 'subtle',
  } as const
  const row = ({ Box, Text }: Els, segs: Seg[]) => (
    <Box flexDirection="row">
      {segs.map(s =>
        s.bar === true ? (
          <Text backgroundColor={BAR_BG[s.tone]}>{s.text}</Text>
        ) : s.tone === 'dim' ? (
          <Text dimColor tabular={s.num === true}>{s.text}</Text>
        ) : s.tone === 'normal' ? (
          <Text tabular={s.num === true}>{s.text}</Text>
        ) : s.tone === 'track' ? (
          <Text dimColor>{s.text}</Text>
        ) : (
          <Text color={s.tone} tabular={s.num === true}>{s.text}</Text>
        ),
      )}
    </Box>
  )

  const isSep = (s: Seg) => s.tone === 'dim' && s.text.trim() === '|'

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    let tree: ReturnType<typeof row> | null = null
    try {
      await read($, tickA)
      const { view } = await viewAt($, await $.clock.now())
      const els = $.ui.resolve(e) as unknown as Els
      const segs = bandSegments(view, e.props.bodyColumns)
      // Too narrow to draw anything: the engine's own band.
      tree = segs.length > 0 ? row(els, segs) : null
    } catch (err) {
      log($, 'band render', err)
    }
    return tree ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    let tree: ReturnType<typeof row> | null = null
    try {
      await read($, tickA)
      const { view } = await viewAt($, await $.clock.now())
      const els = $.ui.resolve(e) as unknown as Els
      const cols = e.props.bodyColumns
      let lines: Seg[][]
      if (e.props.placement === 'inline') {
        // One row when the wide tiers fit, else limits row then cache row.
        const segs = bandSegments(view, cols)
        let cut = -1
        segs.forEach((s, i) => {
          if (isSep(s)) cut = i
        })
        lines = cols >= 56 || cut < 0 ? [segs] : [segs.slice(0, cut), segs.slice(cut + 1)]
      } else {
        lines = paneLines(view, cols, { tested: TESTED, actual: engineVersion !== null && KNOWN_GOOD.includes(engineVersion) ? TESTED : engineVersion })
      }
      const { Box } = els
      // Nothing that fits: the engine's own pane.
      tree = lines.some(l => l.length > 0) ? <Box flexDirection="column">{lines.map(l => row(els, l))}</Box> : null
    } catch (err) {
      log($, 'pane render', err)
    }
    return tree ?? next(e)
  })
}
