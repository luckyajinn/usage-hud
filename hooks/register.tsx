// usage-hud wiring and render hooks (PLAN section 5).
// Every hook calls next(e) exactly once; own work sits in try/catch that never wraps next.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CacheStamp, LimitsSnap, Ttl, TtlSetting } from '../types'
import { computeView, mergeSnap, nextWake, pickLimit, resolveTtl, stampFromResume, stampFromStep, ttlFromResume } from './data'
import type { View } from './data'
import { bandSegments, commandText } from './format'
import { ART_THEMES, altText, bandSvg } from './art'
import type { Art, ArtTheme } from './art'
import type { Seg } from './format'

const limitsA = atom({ plugin: 'usage-hud', key: 'limits' } as const, null)
const liveA = atom({ plugin: 'usage-hud', key: 'live' } as const, false)
const cacheA = atom({ plugin: 'usage-hud', key: 'cache' } as const, null)
const modelA = atom({ plugin: 'usage-hud', key: 'model' } as const, null)
const ttlA = atom({ plugin: 'usage-hud', key: 'ttlLearned' } as const, null)
const tickA = atom({ plugin: 'usage-hud', key: 'tick' } as const, 0)

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
type Theme = ArtTheme | 'text'
const isTheme = (v: unknown): v is Theme => ART_THEMES.includes(v as ArtTheme) || v === 'text'
/**
 * Dark or light art. Neither the render input nor its viewport carries a colour
 * scheme, and the CLI theme setting is the terminal's, not the app's: assume dark.
 */
const DARK = true

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
let theme: Theme = 'clean'
let turnDone = false
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
  // An SVG theme redraws at most once a minute, unless a terminal (text, second ticks) is attached.
  let floor = 1000
  if (theme !== 'text') {
    try {
      if (!(await $.session.surfaces()).includes('terminal')) floor = 60_000
    } catch {
      // unknown surfaces: keep text ticks
    }
  }
  const wait = Math.max(floor, nextWake(view, now, limits, floor) - now)
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
  theme = isTheme(options.theme) ? options.theme : 'clean'
  turnDone = false
  timer?.cancel()
  timer = null

  on('session.start', async ($, e, next) => {
    const r = await next(e)
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

  // A client joined (the desktop connected, a phone opened the session): redraw so the band draws there.
  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    try {
      await changed($)
    } catch (err) {
      log($, 'session.attach schedule', err)
    }
    return r
  })

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
    return { text }
  })

  // ---- render: no writes, next(e) on any error ----

  type Els = { Box: any; Text: any; Svg?: any }
  // The Svg element where the surface has one and the theme wants art; else null (text).
  const svgOf = (surface: string, els: Els): any =>
    theme !== 'text' && surface !== 'terminal' && 'Svg' in els && els.Svg ? els.Svg : null
  const art = (Svg: any, a: Art, view: View) =>
    <Svg source={a.source} alt={altText(view)} width={a.width} height={a.height} />
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

  // Narrower than this the art cannot say anything legible: the text forms draw.
  const BAND_SVG_MIN = 12

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    let tree: ReturnType<typeof row> | ReturnType<typeof art> | null = null
    try {
      await read($, tickA)
      const { view } = await viewAt($, await $.clock.now())
      const els = $.ui.resolve(e) as unknown as Els
      const Svg = svgOf(e.surface, els)
      if (Svg !== null && e.props.bodyColumns >= BAND_SVG_MIN) {
        tree = art(Svg, bandSvg(view, e.props.bodyColumns, theme as ArtTheme, DARK), view)
      } else {
        const segs = bandSegments(view, e.props.bodyColumns)
        // Too narrow to draw anything: the engine's own band.
        tree = segs.length > 0 ? row(els, segs) : null
      }
    } catch (err) {
      log($, 'band render', err)
    }
    return tree ?? next(e)
  })
}
