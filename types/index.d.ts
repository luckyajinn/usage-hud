// Shared data types for usage-hud. Type exports only.

/** One rate-limit window as the engine reports it. Only these three fields are kept. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** Rate-limit readings with the epoch ms they were observed. */
export type LimitsSnap = { observedAt: number; items: Limit[] }

/** Why the cache reads cold when it has no live stamp. */
export type ColdReason = 'new' | 'compacted' | 'cleared' | 'resume-expired'

/**
 * The last main-thread step that touched the prompt cache.
 * `at` is epoch ms at request start; `inputTokens` is read + creation + uncached input of that step.
 * A stamp with `coldReason` set means "known cold since `at`".
 */
export type CacheStamp = { model: string; at: number; inputTokens: number; coldReason?: ColdReason }

export type Ttl = '5m' | '1h'
export type TtlSetting = 'auto' | '5m' | '1h'

declare module 'claude-code' {
  interface PluginState {
    'usage-hud': {
      limits: LimitsSnap | null
      live: boolean
      cache: CacheStamp | null
      model: string | null
      ttlLearned: Ttl | null
      tick: number
      /** The unasked pane open at session.start already ran in this session. */
      opened: boolean
    }
  }
}
