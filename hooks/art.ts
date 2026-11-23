// SVG art entry point. Pure: a View in, an SVG string out. The render hook wraps the string in
// the surface's Svg element; the terminal draws text.
//
// Layout: ./artkit holds the theme-agnostic pieces (text measuring, readouts, constants);
// each look is one module (./themes/<name>) exporting ID_TAG, palette and band; this
// file computes the pixel width and dispatches by theme name.
import type { View } from './data'
import { commandText } from './format'
import { BAND_CELL_PX } from './artkit'
import type { Art, Palette } from './artkit'
import * as clean from './themes/clean'
import * as paper from './themes/paper'
import * as terminal from './themes/terminal'
import * as sunset from './themes/sunset'
import * as flat from './themes/flat'
import * as pips from './themes/pips'
import * as squares from './themes/squares'

export { BAND_CELL_PX, BAND_H, esc, textW } from './artkit'
export type { Art, Palette } from './artkit'

export type ArtTheme = 'clean' | 'paper' | 'terminal' | 'sunset' | 'flat' | 'pips' | 'squares'

/** What a look module exports. `W` is the finished pixel width (art.ts clamps it). */
type ThemeModule = {
  ID_TAG: string
  palette: (dark: boolean) => Palette
  band: (v: View, W: number, dark: boolean, idTag?: string) => Art
}

// ---- dispatch ----

const THEMES: Record<ArtTheme, ThemeModule> = { clean, paper, terminal, sunset, flat, pips, squares }

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
