// The midnight look. Placeholder: draws the clean look under its own svg id letter until it gets its own art.
import type { View } from '../data'
import type { Art, Palette, Version } from '../artkit'
import * as clean from './clean'

/** Single letter in svg ids: 'uh' + ID_TAG + (dark ? 'd' : 'l') + ('b' | 'p'). */
export const ID_TAG = 'm'

export function palette(dark: boolean): Palette {
  return clean.palette(dark)
}

export function band(v: View, W: number, dark: boolean): Art {
  return clean.band(v, W, dark, ID_TAG)
}

export function pane(v: View, W: number, dark: boolean, version: Version): Art {
  return clean.pane(v, W, dark, version, ID_TAG)
}
