// The sunset look. A warm, friendly dusk: the panel is a soft vertical gradient (plum to indigo
// in dark, peach-cream to soft rose in light) with a low sun glowing in the bottom-right corner,
// generously rounded corners, thick rounded pill bars filled with soft gradients that carry a
// faint glow underneath, a rounded friendly sans with heavy numbers, and little "sun-dot" status
// markers (a dot with a soft halo). States keep their meaning: gold-to-leaf healthy, amber
// warning, deep rose-red low, dusty mauve stale, and twilight lavender for the hot cache.
import type { View } from '../data'
import {
  BAND_H, bandTail, cacheReadout, cacheTone, esc, fitSize, fitText, limitsNa, r1, text, textW, windowReadout,
} from '../artkit'
import type { Art, Fill, Palette, Readout } from '../artkit'

/** Single letter in svg ids: 'uh' + ID_TAG + (dark ? 'd' : 'l') + 'b'. */
export const ID_TAG = 's'

// ---- colours ----

/** Panel: `panel2` is the top stop of the gradient, `panel` the bottom one. Text keeps 4.5:1 on both. */
const DARK: Palette = {
  panel: '#1d1b3d', panel2: '#3a1d3c', border: '#57345a', divider: '#4a3058',
  text: '#fff3ea', muted: '#e6c3c6', faint: '#d0a9b6',
  track: '#45304f', good: '#e9c64f', mid: '#ff9f45', low: '#f04f72', stale: '#8f7c92',
  midText: '#ffbb6e', lowText: '#ff93a6',
  frost: '#a993ff', hotText: '#cdbdff', hotRed: '#ff7e8d', coldBlue: '#8fb8ff',
}
const LIGHT: Palette = {
  panel: '#fcdfe2', panel2: '#fff3e5', border: '#efc4c2', divider: '#f0cfcc',
  text: '#3a1b31', muted: '#743c58', faint: '#7c4a66',
  track: '#f3cfd0', good: '#d79a17', mid: '#ee8a1f', low: '#d62f5e', stale: '#bba6b6',
  midText: '#8e4400', lowText: '#ab1240',
  frost: '#8a74ee', hotText: '#5638ad', hotRed: '#b3162f', coldBlue: '#1f4fb0',
}

/** Two stops per fill (left, right): each state varies inside its own colour family. */
const RAMPS: Record<'dark' | 'light', Record<Exclude<Fill, 'none'>, [string, string]>> = {
  dark: {
    good: ['#ffd56a', '#a9d46f'], // sun gold to a soft leaf green
    mid: ['#ffc15a', '#ff8a4a'], // amber to coral
    low: ['#ff6f7f', '#d42d63'], // rose to deep rose-red
    stale: ['#a08ca3', '#7d6c8a'], // dusty mauve-grey
    frost: ['#c3a8ff', '#86a6ff'], // twilight lavender to evening blue
  },
  light: {
    good: ['#f2b52b', '#76ad3f'],
    mid: ['#f8a529', '#ec6b2d'],
    low: ['#ec5578', '#b4164a'],
    stale: ['#cdb9c6', '#b39fb6'],
    frost: ['#a28cf7', '#6d8ef0'],
  },
}

export function palette(dark: boolean): Palette {
  return dark ? DARK : LIGHT
}

const FONT = "'Nunito', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
/** Weight of the numbers. Heavier than the art's measure assumes, so fitting pads it by HEAVY. */
const NUM_WEIGHT = 800
const HEAVY = 1.06
/** Width of a heavy number, as the fitting below sees it. */
const heroW = (s: string, z: number) => textW(s, z, true) * HEAVY

// ---- drawing pieces ----

/** Shared defs: panel gradient (`P`), sun glow (`S`), fill ramps (`F<fill>`) and the soft glow filter (`G`). */
function defs(id: string, dark: boolean, p: Palette): string {
  const ramps = RAMPS[dark ? 'dark' : 'light']
  let s = `<linearGradient id="${id}P" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.panel2}"/><stop offset="1" stop-color="${p.panel}"/></linearGradient>`
  s += `<radialGradient id="${id}S" cx="1" cy="1" r="1"><stop offset="0" stop-color="${dark ? '#ff8a5c' : '#ffb27a'}" stop-opacity="${dark ? 0.16 : 0.22}"/><stop offset="1" stop-color="${dark ? '#ff8a5c' : '#ffb27a'}" stop-opacity="0"/></radialGradient>`
  for (const [f, [a, b]] of Object.entries(ramps)) {
    s += `<linearGradient id="${id}F${f}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`
  }
  s += `<filter id="${id}G" x="-20%" y="-150%" width="140%" height="400%"><feGaussianBlur stdDeviation="2.2"/></filter>`
  return `<defs>${s}</defs>`
}

/** The card: rounded panel with the dusk gradient, a low sun glowing in the corner, a soft rim. */
function card(w: number, h: number, id: string, dark: boolean, p: Palette, body: string): string {
  const rx = Math.min(14, h / 2 - 1)
  const sunR = Math.min(Math.max(h * 1.6, 60), w * 0.6)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
    `font-family="${esc(FONT)}" style="font-variant-numeric:tabular-nums">` + defs(id, dark, p) +
    `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${rx}" fill="url(#${id}P)" stroke="${p.border}" stroke-width="1"/>` +
    `<rect x="${r1(w - sunR - 1)}" y="${r1(Math.max(1, h - sunR - 1))}" width="${r1(sunR)}" height="${r1(Math.min(sunR, h - 2))}" rx="${rx}" fill="url(#${id}S)"/>` +
    body + '</svg>'
}

/** A thick pill: track, a blurred glow under the fill, then the gradient fill (at least a dot wide). */
function bar(x: number, y: number, w: number, h: number, frac: number, f: Fill, id: string, p: Palette): string {
  const r = h / 2
  let s = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${h}" rx="${r}" fill="${p.track}"/>`
  const fr = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0
  if (fr > 0 && f !== 'none') {
    const fw = Math.max(h, w * fr)
    s += `<rect x="${r1(x + 1)}" y="${r1(y + 1.5)}" width="${r1(Math.max(1, fw - 2))}" height="${h}" rx="${r}" fill="url(#${id}F${f})" opacity=".45" filter="url(#${id}G)"/>`
    s += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(fw)}" height="${h}" rx="${r}" fill="url(#${id}F${f})"/>`
  }
  return s
}

/** The solid colour of a state, for the sun dots. */
function paint(f: Fill, p: Palette): string {
  if (f === 'good') return p.good
  if (f === 'mid') return p.mid
  if (f === 'low') return p.low
  if (f === 'frost') return p.frost
  return p.stale
}

/** A small sun: a dot in the state colour with a soft halo around it. */
function sun(cx: number, cy: number, r: Readout, p: Palette): string {
  const c = paint(r.fill, p)
  return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="5.5" fill="${c}" opacity=".22"/>` +
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="3.2" fill="${c}"/>`
}

// ---- band ----

const DOT_W = 14
const DOT_Y = 16.5
const BASE = 21
const BAR_Y = 28
const BAR_H = 8
/** Blocks narrower than this drop the sun dot (the bar colour still says the same). */
const DOT_MIN_W = 104

/**
 * One band block: sun dot, small label, heavy value, then the muted tail at the right.
 * Same priorities as the clean look: the label beats the dot and the hero's size; a stale
 * reading keeps its "as of" note whenever it fits.
 */
function bandBlock(x: number, w: number, r: Readout, p: Palette, id: string, compact: boolean, isCache: boolean): string {
  const size = compact ? 17 : 20
  const values = isCache && r.value.startsWith('hot ') ? [r.value, r.value.slice(4)] : [r.value]
  const label = compact ? r.short : r.label
  const labelW = textW(label, 11, true) + 6
  const wantDot = w >= DOT_MIN_W
  const stale = r.dim && r.extra ? textW(r.extra, 11) + 10 : 0

  type Hero = { text: string; size: number; dot: boolean; label: boolean }
  const fit = (c: string, room: number, min: number) => fitSize(c, size, min, room / HEAVY, true)
  const place = (reserve: number): Hero | undefined => {
    const room = w - labelW - reserve - (wantDot ? DOT_W : 0)
    for (const c of values) {
      const z = fit(c, room, 12)
      if (z) return { text: c, size: z, dot: wantDot, label: true }
    }
    return undefined
  }
  let hero = (stale ? place(stale) : undefined) ?? place(0)
  if (!hero) {
    for (const c of values) {
      const z = fit(c, w - DOT_W, 12)
      if (z) { hero = { text: c, size: z, dot: true, label: false }; break }
    }
  }
  hero ??= { ...fitText(values[values.length - 1]!, size, 7, w / HEAVY, true), dot: false, label: false }

  const valW = heroW(hero.text, hero.size)
  let at = x
  let s = ''
  if (hero.dot) { s += sun(x + 5, DOT_Y, r, p); at += DOT_W }
  if (hero.label) {
    s += text(at, BASE, [{ text: label, fill: p.muted }], { size: 11, weight: 700 })
    at += labelW
  }
  s += text(at, BASE, [{ text: hero.text, fill: r.valueFill }], { size: hero.size, weight: NUM_WEIGHT })
  const room = x + w - (at + valW) - 10
  const full = [r.detail, r.extra].filter(t => t).join(', ')
  const short = [r.detail.replace(/resets in /, ''), r.detail.replace(/^.*resets in /, '')]
  const tails = isCache
    ? [bandTail(r, true)]
    : r.dim ? [full, bandTail(r, false), r.extra, ...short] : [full, bandTail(r, false), ...short, r.extra]
  const tail = tails.find(t => t && textW(t, 11) <= room)
  if (tail) s += text(x + w, BASE, [{ text: tail, fill: p.muted }], { size: 11, anchor: 'end' })
  s += bar(x, BAR_Y, w, BAR_H, r.frac, r.fill, id, p)
  return r.dim ? `<g opacity=".78">${s}</g>` : s
}

/** The strip above the prompt. `W` is the finished pixel width; `idTag` is the svg id letter. */
export function band(v: View, W: number, dark: boolean, idTag: string = ID_TAG): Art {
  const p = palette(dark)
  const id = 'uh' + idTag + (dark ? 'd' : 'l') + 'b'
  const H = BAND_H
  const pad = W < 200 ? 8 : W < 420 ? 12 : 18
  const gap = W < 200 ? 7 : W < 420 ? 14 : 28
  const compact = W < 560
  const inner = W - pad * 2
  const cache = cacheTone(cacheReadout(v, p), v, p)
  let body = ''
  if (limitsNa(v)) {
    // Both windows say the same: one wide quiet block, then the cache.
    const w1 = (inner - gap) * (2 / 3)
    const w2 = inner - gap - w1
    const wantDot = w1 >= DOT_MIN_W
    const t = fitText('Limits n/a', 13, 8, w1 - (wantDot ? DOT_W : 0), true)
    if (wantDot) body += sun(pad + 5, DOT_Y, { ...cache, fill: 'stale' }, p)
    body += text(pad + (wantDot ? DOT_W : 0), BASE - 1, [{ text: t.text, fill: p.muted }], { size: t.size, weight: 700 })
    body += bar(pad, BAR_Y, w1, BAR_H, 0, 'none', id, p)
    body += bandBlock(pad + w1 + gap, w2, cache, p, id, compact, true)
  } else {
    const bw = (inner - gap * 2) / 3
    const reads = [windowReadout(v.fiveHour, p), windowReadout(v.sevenDay, p), cache]
    reads.forEach((r, i) => { body += bandBlock(pad + i * (bw + gap), bw, r, p, id, compact, i === 2) })
  }
  return { source: card(W, H, id, dark, p, body), width: W, height: H }
}
