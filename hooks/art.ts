// SVG art entry point. Pure: a View in, an SVG string out. The render hook wraps the string in
// the surface's Svg element; the terminal draws text.
//
// Layout: ./artkit holds the theme-agnostic pieces (text measuring, readouts, constants);
// ./themes/pips draws the one look, the pips; this file computes the pixel width.
import type { View } from './data'
import { commandText } from './format'
import { BAND_CELL_PX } from './artkit'
import type { Art, Palette } from './artkit'
import * as pips from './themes/pips'

export { BAND_CELL_PX, BAND_H, esc, textW } from './artkit'
export type { Art, Palette } from './artkit'

export function palette(dark: boolean): Palette {
  return pips.palette(dark)
}

/** One line for a reader that cannot see the art: the command readout on one line. */
export function altText(v: View): string {
  return commandText(v).split('\n').join(' ')
}

/** The strip above the prompt: one row of three blocks, BAND_H tall, columns * BAND_CELL_PX wide. */
export function bandSvg(v: View, columns: number, dark: boolean): Art {
  const W = Math.max(60, Math.floor(Math.floor(columns) * BAND_CELL_PX))
  return pips.band(v, W, dark)
}
