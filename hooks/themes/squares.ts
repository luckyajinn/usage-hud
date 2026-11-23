// The squares look. The pips look with big rounded squares in place of tall bars: ten per block,
// lit for the amount shown, then the percent and the reset time. Big squares take width, so at
// the usual desktop width the reset time gives way to them (it comes back when there is room).
// Colours, layout and narrowing are the pips look's (./pips); only the ladder differs.
import type { View } from '../data'
import type { Art, Palette } from '../artkit'
import { SQUARE_LADDER, palette as pipsPalette, pipsBand } from './pips'

/** Single letter in svg ids: 'uh' + ID_TAG + (dark ? 'd' : 'l') + 'b'. */
export const ID_TAG = 'q'

export function palette(dark: boolean): Palette {
  return pipsPalette(dark)
}

/** The strip above the prompt. `W` is the finished pixel width; `idTag` is the svg id letter. */
export function band(v: View, W: number, dark: boolean, idTag: string = ID_TAG): Art {
  return pipsBand(v, W, dark, idTag, SQUARE_LADDER)
}
