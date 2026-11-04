// The terminal look. A retro-futurist phosphor console: monospace everywhere, a near-black
// CRT panel with faint scanlines and a soft centre glow, prompt-style labels ("5h>", "cache>",
// "$ usage"), and bars drawn as a row of discrete blocks, like [#######---]. Phosphor green is
// healthy, amber warns, hot red is low, a dim olive grey is a stale reading, and the cache is
// terminal cyan. The light variant is a paper-white "e-ink" console with dark green ink.
//
// Text is measured with a monospace width (mw below), not the shared proportional textW, since
// every glyph of a monospace font is the same ~0.6em wide.
import type { View } from '../data'
import { BAND_H, bandTail, cacheReadout, cacheTone, esc, fillPaint, limitsNa, r1, text, windowReadout } from '../artkit'
import type { Art, Fill, Palette, Readout } from '../artkit'

/** Single letter in svg ids: 'uh' + ID_TAG + (dark ? 'd' : 'l') + 'b'. Pinned: do not change. */
export const ID_TAG = 't'

const FONT_MONO = "ui-monospace, 'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace"

// ---- palette ----

const DARK: Palette = {
  panel: '#070b08', panel2: '#0b120d', border: '#1d3a24', divider: '#1d3a24',
  text: '#c8ffd2', muted: '#6fcf86', faint: '#58a96c',
  track: '#14261a', good: '#39ff7a', mid: '#ffb000', low: '#ff3b3b', stale: '#6b7058',
  midText: '#ffc23d', lowText: '#ff6a5c',
  frost: '#2fd6e0', hotText: '#7cecf2', hotRed: '#ff5f56', coldBlue: '#5eb8ff',
}
const LIGHT: Palette = {
  panel: '#f3f1e7', panel2: '#f8f7f0', border: '#c9c7b4', divider: '#c9c7b4',
  text: '#0d3a1b', muted: '#2a5e38', faint: '#3c6a47',
  track: '#dedbc9', good: '#1d8a3e', mid: '#c27a00', low: '#cc2a22', stale: '#a3a38f',
  midText: '#8a5200', lowText: '#b0221b',
  frost: '#0e8a96', hotText: '#0a6670', hotRed: '#b0221b', coldBlue: '#0b5aa8',
}

export function palette(dark: boolean): Palette {
  return dark ? DARK : LIGHT
}

// ---- monospace measuring and fitting ----

/** Width of `s` in a monospace font at `size`: every glyph ~0.6em, measured a touch wide (0.62). */
const mw = (s: string, size: number): number => [...s].length * 0.62 * size

/** The largest whole size in [min, max] at which `s` fits `w`, or null. */
function monoSize(s: string, max: number, min: number, w: number): number | null {
  for (let z = max; z >= min; z--) if (mw(s, z) <= w) return z
  return null
}

/** `s` at the largest size down to `min` that fits `w`; if none does, cut with an ellipsis. */
function monoFit(s: string, size: number, min: number, w: number): { text: string; size: number } {
  const z = monoSize(s, size, min, w) ?? min
  if (mw(s, z) <= w) return { text: s, size: z }
  const cs = [...s]
  while (cs.length > 1 && mw(cs.join('') + '…', z) > w) cs.pop()
  return { text: cs.join('') + '…', size: z }
}

// ---- drawing pieces ----

/**
 * The CRT card: svg root (monospace), panel gradient `${id}P`, a soft centre glow `${id}V`,
 * a scanline pattern `${id}S` (static 1px lines at low opacity) and a square-cornered border.
 */
function crt(w: number, h: number, p: Palette, dark: boolean, id: string, body: string): string {
  const line = dark ? p.good : p.text
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
    `font-family="${esc(FONT_MONO)}" style="font-variant-numeric:tabular-nums">` +
    '<defs>' +
    `<linearGradient id="${id}P" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.panel2}"/><stop offset="1" stop-color="${p.panel}"/></linearGradient>` +
    `<radialGradient id="${id}V" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="${p.good}" stop-opacity="${dark ? '.07' : '.04'}"/><stop offset="1" stop-color="${p.good}" stop-opacity="0"/></radialGradient>` +
    `<pattern id="${id}S" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="${line}" opacity="${dark ? '.06' : '.045'}"/></pattern>` +
    '</defs>' +
    `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="2" fill="url(#${id}P)" stroke="${p.border}" stroke-width="1"/>` +
    `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="url(#${id}V)"/>` +
    `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="url(#${id}S)"/>` +
    body + '</svg>'
}

/**
 * A segmented bar, [#######---]: up to `maxN` discrete blocks between thin square brackets,
 * the filled count proportional to `frac` (at least one block when anything is left).
 */
function blocks(x: number, y: number, w: number, h: number, frac: number, f: Fill, p: Palette, maxN: number, minPitch: number): string {
  const gap = 2
  const br = w >= 40 ? 5 : 0
  let s = ''
  if (br) {
    const t = 1.5
    const y0 = y - 2
    const bh = h + 4
    const c = p.faint
    s += `<g fill="${c}">` +
      `<rect x="${r1(x)}" y="${r1(y0)}" width="${t}" height="${bh}"/><rect x="${r1(x)}" y="${r1(y0)}" width="3" height="${t}"/><rect x="${r1(x)}" y="${r1(y0 + bh - t)}" width="3" height="${t}"/>` +
      `<rect x="${r1(x + w - t)}" y="${r1(y0)}" width="${t}" height="${bh}"/><rect x="${r1(x + w - 3)}" y="${r1(y0)}" width="3" height="${t}"/><rect x="${r1(x + w - 3)}" y="${r1(y0 + bh - t)}" width="3" height="${t}"/>` +
      '</g>'
  }
  const ix = x + br
  const iw = w - br * 2
  const n = Math.max(1, Math.min(maxN, Math.floor((iw + gap) / minPitch)))
  const sw = (iw - gap * (n - 1)) / n
  const fr = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0
  const k = fr > 0 && f !== 'none' ? Math.min(n, Math.max(1, Math.round(fr * n))) : 0
  const seg = (i: number) => `<rect x="${r1(ix + i * (sw + gap))}" y="${r1(y)}" width="${r1(sw)}" height="${h}"/>`
  let on = ''
  let off = ''
  for (let i = 0; i < n; i++) if (i < k) on += seg(i); else off += seg(i)
  if (off) s += `<g fill="${p.track}">${off}</g>`
  if (on) s += `<g fill="${fillPaint(f, p)}">${on}</g>`
  return s
}

/** A stale (dimmed) reading is drawn at reduced strength, like a fading phosphor. */
const dimmed = (r: Readout, s: string): string => (r.dim ? `<g opacity=".75">${s}</g>` : s)

// ---- band ----

const BASE = 19
const BAR_Y = 27
const BAR_H = 8

/**
 * One band block: prompt label ("5h>"), the value, the muted tail right-aligned, then the
 * block bar. The label beats the value's size; a stale reading keeps its "as of" note if it can.
 */
function bandBlock(x: number, w: number, r: Readout, p: Palette, compact: boolean, isCache: boolean): string {
  const lz = compact ? 11 : 12
  const vz = compact ? 14 : 16
  const tz = compact ? 10 : 11
  const label = (isCache ? 'cache' : r.short) + '>'
  const values = isCache && r.value.startsWith('hot ') ? [r.value, r.value.slice(4)] : [r.value]
  const labelW = mw(label, lz) + 5
  const stale = r.dim && r.extra ? mw(r.extra, tz) + 8 : 0

  type Hero = { text: string; size: number; label: boolean }
  const place = (reserve: number): Hero | undefined => {
    for (const c of values) {
      const z = monoSize(c, vz, 11, w - labelW - reserve)
      if (z) return { text: c, size: z, label: true }
    }
    return undefined
  }
  let hero = (stale ? place(stale) : undefined) ?? place(0)
  if (!hero) {
    for (const c of values) {
      const z = monoSize(c, vz, 9, w)
      if (z) { hero = { text: c, size: z, label: false }; break }
    }
  }
  hero ??= { ...monoFit(values[values.length - 1]!, vz, 7, w), label: false }

  let s = ''
  let at = x
  if (hero.label) {
    s += text(at, BASE, [{ text: label, fill: p.muted }], { size: lz, weight: 600 })
    at += labelW
  }
  s += text(at, BASE, [{ text: hero.text, fill: r.valueFill }], { size: hero.size, weight: 700 })
  const room = x + w - (at + mw(hero.text, hero.size)) - 8
  const full = [r.detail, r.extra].filter(t => t).join(', ')
  const short = [r.detail.replace(/resets in /, ''), r.detail.replace(/^.*resets in /, '')]
  const tails = isCache
    ? [bandTail(r, true)]
    : r.dim ? [full, bandTail(r, false), r.extra, ...short] : [full, bandTail(r, false), ...short, r.extra]
  const tail = tails.find(t => t && mw(t, tz) <= room)
  if (tail) {
    const hotTail = tail.startsWith('limit reached') ? p.lowText : p.muted
    s += text(x + w, BASE, [{ text: tail, fill: hotTail }], { size: tz, anchor: 'end' })
  }
  s += blocks(x, BAR_Y, w, BAR_H, r.frac, r.fill, p, 24, 7)
  return dimmed(r, s)
}

/** The strip above the prompt. `W` is the finished pixel width; `idTag` is the svg id letter. */
export function band(v: View, W: number, dark: boolean, idTag: string = ID_TAG): Art {
  const p = palette(dark)
  const id = 'uh' + idTag + (dark ? 'd' : 'l') + 'b'
  const H = BAND_H
  const pad = W < 200 ? 5 : W < 420 ? 10 : 16
  const gap = W < 200 ? 6 : W < 420 ? 14 : 26
  const compact = W < 560
  const inner = W - pad * 2
  const cache = cacheTone(cacheReadout(v, p), v, p)
  let body = ''
  if (limitsNa(v)) {
    // Both windows say the same: one wide quiet block, then the cache.
    const w1 = (inner - gap) * (2 / 3)
    const w2 = inner - gap - w1
    const lz = compact ? 11 : 12
    // The '>' prompt is dropped first when the words would otherwise shrink below 10 px.
    const prompt = mw('> Limits n/a', 10) <= w1
    const pw = prompt ? mw('>', lz) + 5 : 0
    const t = monoFit('Limits n/a', compact ? 13 : 14, 8, w1 - pw)
    if (prompt) body += text(pad, BASE, [{ text: '>', fill: p.muted }], { size: lz, weight: 600 })
    body += text(pad + pw, BASE, [{ text: t.text, fill: p.muted }], { size: t.size, weight: 600 })
    const note = 'no subscription limits'
    const room = w1 - pw - mw(t.text, t.size) - 10
    if (mw(note, compact ? 10 : 11) <= room) body += text(pad + w1, BASE, [{ text: note, fill: p.faint }], { size: compact ? 10 : 11, anchor: 'end' })
    body += blocks(pad, BAR_Y, w1, BAR_H, 0, 'none', p, 32, 7)
    body += bandBlock(pad + w1 + gap, w2, cache, p, compact, true)
  } else {
    const bw = (inner - gap * 2) / 3
    const reads = [windowReadout(v.fiveHour, p), windowReadout(v.sevenDay, p), cache]
    reads.forEach((r, i) => { body += bandBlock(pad + i * (bw + gap), bw, r, p, compact, i === 2) })
  }
  return { source: crt(W, H, p, dark, id, body), width: W, height: H }
}
