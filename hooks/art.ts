// SVG art entry point. Pure: a View in, an SVG string out. The render hook wraps the string in
// the surface's Svg element; the terminal draws text.
//
// Layout: ./artkit holds the theme-agnostic pieces (text measuring, readouts, constants);
// each look is one module (./themes/<name>) exporting ID_TAG, palette, band and pane; this
// file keeps the classic look, computes the pixel width and dispatches by theme name.
import type { View } from './data'
import { commandText } from './format'
import {
  BAND_CELL_PX, BAND_H, PANE_CELL_PX, bandTail, cacheReadout, frame, limitsNa, pill, r1, text, textW,
  windowReadout,
} from './artkit'
import type { Art, Palette, Readout, Span, Version } from './artkit'
import * as clean from './themes/clean'
import * as midnight from './themes/midnight'
import * as paper from './themes/paper'
import * as terminal from './themes/terminal'
import * as sunset from './themes/sunset'
import * as mono from './themes/mono'

export { BAND_CELL_PX, BAND_H, PANE_CELL_PX, esc, textW } from './artkit'
export type { Art, Palette, Version } from './artkit'

export type ArtTheme = 'clean' | 'classic' | 'midnight' | 'paper' | 'terminal' | 'sunset' | 'mono'

/** What a look module exports. `W` is the finished pixel width (art.ts clamps it). */
type ThemeModule = {
  ID_TAG: string
  palette: (dark: boolean) => Palette
  band: (v: View, W: number, dark: boolean) => Art
  pane: (v: View, W: number, dark: boolean, version: Version) => Art
}

// ---- classic ----
// The older neutral card with solid green, amber and red bars. Its cache glyph is a plain dot
// (bright while hot, grey when cold) and each limit has a small muted dot.

const CLASSIC_DARK: Palette = {
  panel: '#1b1d21', panel2: '#1b1d21', border: '#34383e', divider: '#2f3338',
  text: '#e6e8eb', muted: '#a2a8b0', faint: '#8a919a',
  track: '#2f333a', good: '#3fb950', mid: '#d29922', low: '#f85149', stale: '#5c636c',
  midText: '#e3b341', lowText: '#ff7b72',
  frost: '#3fb950', hotText: '#56d364',
}
const CLASSIC_LIGHT: Palette = {
  panel: '#ffffff', panel2: '#ffffff', border: '#d6dae0', divider: '#e4e7eb',
  text: '#1f2328', muted: '#57606a', faint: '#636c76',
  track: '#e6e9ed', good: '#1f883d', mid: '#bf8700', low: '#cf222e', stale: '#b4bac2',
  midText: '#8a5d00', lowText: '#cf222e',
  frost: '#1f883d', hotText: '#1a7f37',
}
/** The cache dot while cold. */
const CLASSIC_COLD = { dark: '#6e7681', light: '#8c959f' }

const classicPalette = (dark: boolean): Palette => (dark ? CLASSIC_DARK : CLASSIC_LIGHT)

const classicId = (dark: boolean, kind: 'b' | 'p'): string => 'uhc' + (dark ? 'd' : 'l') + kind

const dotAt = (cx: number, cy: number, r: number, color: string): string =>
  `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${color}"/>`

/** The small muted dot by a limit's label. */
const limitDot = (cx: number, cy: number, r: number, p: Palette): string => dotAt(cx, cy, r * 0.6, p.muted)

/** The cache dot: bright while hot, grey when cold. */
const cacheDot = (cx: number, cy: number, r: number, hot: boolean, dark: boolean, p: Palette): string =>
  dotAt(cx, cy, r * 0.5, hot ? p.hotText : dark ? CLASSIC_COLD.dark : CLASSIC_COLD.light)

const BAND_BAR_Y = 27
const BAND_BAR_H = 9

function classicBandBlock(x: number, w: number, r: Readout, icon: string, p: Palette, compact: boolean, isCache: boolean): string {
  const size = compact ? 13 : 14
  const iconW = compact ? 0 : 16
  const label = compact ? r.short : r.label
  const labelW = textW(label, 12, true)
  const valW = textW(r.value, size, true)
  const showLabel = iconW + labelW + 8 + valW <= w
  const room = w - (showLabel ? iconW + labelW + 10 : 0)
  const spans: Span[] = [{ text: r.value, fill: r.valueFill, weight: 700 }]
  const tail = bandTail(r, isCache)
  if (tail && valW + 8 + textW(tail, 11.5) <= room) spans.push({ text: tail, fill: p.muted, size: 11.5, weight: 400, dx: 7 })
  else if (r.extra && valW + 8 + textW(r.extra, 11.5) <= room) spans.push({ text: r.extra, fill: p.muted, size: 11.5, weight: 400, dx: 7 })
  let s = ''
  if (showLabel) {
    if (!compact) s += icon
    s += text(x + iconW, 18.5, [{ text: label, fill: p.muted }], { size: 12, weight: 600 })
  }
  s += text(x + w, 19, spans, { size, anchor: 'end' })
  s += pill(x, BAND_BAR_Y, w, BAND_BAR_H, r.frac, r.fill, p)
  return r.dim ? `<g opacity=".8">${s}</g>` : s
}

function classicDivider(x: number, h: number, p: Palette): string {
  return `<rect x="${r1(x)}" y="9" width="1" height="${h - 18}" fill="${p.divider}"/>`
}

function classicBand(v: View, W: number, dark: boolean): Art {
  const p = classicPalette(dark)
  const id = classicId(dark, 'b')
  const H = BAND_H
  const pad = W < 420 ? 10 : 16
  const gap = W < 420 ? 14 : 28
  const compact = W < 560
  const inner = W - pad * 2
  const na = limitsNa(v)
  const cache = cacheReadout(v, p)
  const flake = (x: number) => cacheDot(x + 6, 14, 5.5, v.cache.state === 'hot', dark, p)
  let body = ''
  if (na) {
    // Both windows say the same: one wide block, then the cache.
    const w1 = (inner - gap) * (2 / 3)
    const w2 = inner - gap - w1
    if (!compact) body += limitDot(pad + 6, 15, 4.5, p)
    body += text(pad + (compact ? 0 : 16), 18.5, [{ text: 'Limits n/a', fill: p.muted }], { size: 12, weight: 600 })
    body += pill(pad, BAND_BAR_Y, w1, BAND_BAR_H, 0, 'none', p)
    body += classicDivider(pad + w1 + gap / 2, H, p)
    const cx = pad + w1 + gap
    body += classicBandBlock(cx, w2, cache, flake(cx), p, compact, true)
  } else {
    const bw = (inner - gap * 2) / 3
    const reads = [windowReadout(v.fiveHour, p), windowReadout(v.sevenDay, p), cache]
    reads.forEach((r, i) => {
      const x = pad + i * (bw + gap)
      const icon = i < 2 ? limitDot(x + 6, 15, 4.5, p) : flake(x)
      if (i > 0) body += classicDivider(x - gap / 2, H, p)
      body += classicBandBlock(x, bw, r, icon, p, compact, i === 2)
    })
  }
  return { source: frame(W, H, p, id, body), width: W, height: H }
}

function classicPane(v: View, W: number, dark: boolean, version: Version): Art {
  const p = classicPalette(dark)
  const id = classicId(dark, 'p')
  const narrow = W < 360
  const pad = narrow ? 14 : 24
  const big = narrow ? 24 : 34
  const barH = narrow ? 10 : 14
  const inner = W - pad * 2
  let body = ''

  const headH = narrow ? 34 : 46
  body += text(pad, headH * 0.62, [{ text: 'Usage left', fill: p.text }], { size: narrow ? 13 : 15, weight: 650 })
  let y = headH
  body += `<rect x="${pad}" y="${y}" width="${inner}" height="1" fill="${p.divider}"/>`
  y += narrow ? 14 : 20

  const block = (r: Readout, icon: string): void => {
    let s = icon
    s += text(pad + 18, y + 11, [{ text: r.label.toUpperCase(), fill: p.muted }], { size: 11.5, weight: 650, spacing: 1.2 })
    const by = y + 22 + big * 0.82
    const spans: Span[] = [{ text: r.value, fill: r.valueFill }]
    if (r.unit) spans.push({ text: r.unit, fill: p.muted, size: Math.round(big * 0.42), weight: 500, dx: 6 })
    s += text(pad, by, spans, { size: big, weight: 700 })
    const barY = by + (narrow ? 10 : 14)
    s += pill(pad, barY, inner, barH, r.frac, r.fill, p)
    const line = [r.detail, r.extra].filter(t => t).join(', ')
    const ly = barY + barH + (narrow ? 16 : 20)
    if (line) s += text(pad, ly, [{ text: line, fill: p.muted }], { size: narrow ? 11.5 : 12.5 })
    body += r.dim ? `<g opacity=".8">${s}</g>` : s
    y = ly + (narrow ? 20 : 28)
  }

  const na = limitsNa(v)
  if (na) {
    block({ ...windowReadout(v.fiveHour, p), label: 'Limits' }, limitDot(pad + 6, y + 7, 5, p))
  } else {
    block(windowReadout(v.fiveHour, p), limitDot(pad + 6, y + 7, 5, p))
    block(windowReadout(v.sevenDay, p), limitDot(pad + 6, y + 7, 5, p))
  }
  const c = cacheReadout(v, p)
  block({ ...c, label: 'Prompt cache' }, cacheDot(pad + 6, y + 7, 6.5, v.cache.state === 'hot', dark, p))

  // Footer: the engine the mod was tested on, and a flag for any other.
  body += `<rect x="${pad}" y="${y - 8}" width="${inner}" height="1" fill="${p.divider}"/>`
  const foot = 'tested on ' + version.tested
  y += 12
  const spans: Span[] = [{ text: foot, fill: p.faint }]
  const untested = version.actual !== null && version.actual !== version.tested
  const note = `untested engine ${version.actual ?? ''}`
  const oneLine = textW(foot + '  ' + note, 11.5) <= inner
  if (untested && oneLine) spans.push({ text: note, fill: p.midText, dx: 8 })
  body += text(pad, y, spans, { size: 11.5 })
  if (untested && !oneLine) {
    y += 16
    body += text(pad, y, [{ text: note, fill: p.midText }], { size: 11.5 })
  }
  const H = Math.ceil(y + (narrow ? 12 : 16))
  return { source: frame(W, H, p, id, body), width: W, height: H }
}

const classic: ThemeModule = { ID_TAG: 'c', palette: classicPalette, band: classicBand, pane: classicPane }

// ---- dispatch ----

const THEMES: Record<ArtTheme, ThemeModule> = { clean, classic, midnight, paper, terminal, sunset, mono }

/** Every art theme name, in the order the settings list them. */
export const ART_THEMES = Object.keys(THEMES) as ArtTheme[]

export function palette(theme: ArtTheme, dark: boolean): Palette {
  return THEMES[theme].palette(dark)
}

/** One line for a reader that cannot see the art: the command readout on one line. */
export function altText(v: View): string {
  return commandText(v).split('\n').join(' ')
}

/** The strip above the prompt: one row of three blocks, BAND_H tall, columns * BAND_CELL_PX wide. */
export function bandSvg(v: View, columns: number, theme: ArtTheme, dark: boolean): Art {
  const W = Math.max(60, Math.floor(Math.floor(columns) * BAND_CELL_PX))
  return THEMES[theme].band(v, W, dark)
}

/** The docked pane: a vertical card with 5-hour, 7-day and Cache blocks and a footer. */
export function paneSvg(v: View, columns: number, theme: ArtTheme, dark: boolean, version: Version): Art {
  const W = Math.max(120, Math.floor(Math.floor(columns) * PANE_CELL_PX))
  return THEMES[theme].pane(v, W, dark, version)
}
