// The paper look. Warm editorial print: a cream card (warm charcoal "dark paper" in dark mode),
// ink-coloured serif numerals, small-caps labels with generous letter-spacing, hairline column
// rules instead of boxes, and every bar drawn as a ruled scale: a thin ink rule with ticks at
// 0, 50 and 100 and a bold inked segment for the amount left. Colours are ink-like: forest
// green, ochre, brick red, warm grey for stale readings, and a blue-black ink for the cache.
import type { View } from '../data'
import {
  BAND_H, bandTail, cacheReadout, esc, fillPaint, fitSize, fitText, limitsNa, r1, text, textW,
  windowReadout, wrapText,
} from '../artkit'
import type { Art, Fill, Palette, Readout, Span, Version } from '../artkit'

/** Single letter in svg ids: 'uh' + ID_TAG + (dark ? 'd' : 'l') + ('b' | 'p'). Pinned: do not change. */
export const ID_TAG = 'a'

// ---- palette ----

const DARK: Palette = {
  panel: '#211e1a', panel2: '#29251f', border: '#3e372e', divider: '#3a342c',
  text: '#f0e8d8', muted: '#c2b6a2', faint: '#ab9f8b',
  track: '#7d7262', good: '#86b27c', mid: '#d6a44c', low: '#dc7a62', stale: '#857a6b',
  midText: '#e0b25e', lowText: '#ec8d74',
  frost: '#8fb0c8', hotText: '#a6c2d6',
}
const LIGHT: Palette = {
  panel: '#f4eddc', panel2: '#faf6ea', border: '#d6cbb3', divider: '#ddd2bb',
  text: '#2a241c', muted: '#5b5041', faint: '#685c4b',
  track: '#8f826d', good: '#2e6b3c', mid: '#a8741a', low: '#a63b29', stale: '#a89c88',
  midText: '#83570c', lowText: '#9b3121',
  frost: '#2f5878', hotText: '#2a5070',
}

export function palette(dark: boolean): Palette {
  return dark ? DARK : LIGHT
}

// ---- type and measuring ----

/** System serif stack: no web fonts. */
const SERIF = "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif"
/** textW estimates a sans-serif; Georgia runs wider, so every serif measure gets this margin. */
const SF = 1.14
const sw = (s: string, z: number, bold = false): number => textW(s, z, bold) * SF
/** Width of a small-caps label (drawn as spaced capitals), as the generic tests measure it plus margin. */
const capsW = (s: string, z: number, sp: number): number => textW(s, z, true) * SF + s.length * sp
/** Largest size in [min, max] at which `s` fits `w` in serif, or null. */
const fitSerif = (s: string, max: number, min: number, w: number, bold = false): number | null =>
  fitSize(s, max, min, w / SF, bold)
/** Italic is a group wrapper, so the <text> elements keep the shared attribute order. */
const italic = (s: string): string => (s ? `<g font-style="italic">${s}</g>` : '')
const rect = (x: number, y: number, w: number, h: number, fill: string, extra = ''): string =>
  `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(0, w))}" height="${r1(h)}" fill="${fill}"${extra}/>`

// ---- drawing pieces ----

/** The sheet: svg root in the serif stack, the paper gradient (id `${id}P`) and a hairline edge. */
function sheet(w: number, h: number, p: Palette, id: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
    `font-family="${esc(SERIF)}" style="font-variant-numeric:tabular-nums lining-nums">` +
    `<defs><linearGradient id="${id}P" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.panel2}"/><stop offset="1" stop-color="${p.panel}"/></linearGradient></defs>` +
    `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="3" fill="url(#${id}P)" stroke="${p.border}" stroke-width="1"/>` +
    body + '</svg>'
}

/**
 * A ruled scale: a hairline ink rule with ticks at 0, 50 and 100 (and shorter quarter ticks when
 * there is room), and a bold segment from 0 for the fraction left, ending in a full-height mark.
 * `y` is the top of the rule. Nothing is inked for an empty or 'none' fill.
 */
function scale(x: number, y: number, w: number, frac: number, f: Fill, p: Palette, tick: number, bold: number): string {
  let s = rect(x, y, w, 1, p.track)
  const quarters = w >= 90
  for (const t of quarters ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1]) {
    const major = t === 0 || t === 0.5 || t === 1
    const h = major ? tick : Math.round(tick * 0.55)
    s += rect(x + t * (w - 1), y + 1, 1, h, p.track)
  }
  const fr = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0
  if (fr > 0 && f !== 'none') {
    const c = fillPaint(f, p)
    const fw = Math.max(2, w * fr)
    s += rect(x, y + 0.5 - bold / 2, fw, bold, c)
    // The reading's own mark: a short stroke across the rule where the ink stops.
    s += rect(x + fw - 1.5, y + 0.5 - bold / 2 - 2, 1.5, bold + 4, c)
  }
  return s
}

// ---- band ----

const LZ = 9
const LS = 1.5
const BASE = 22
const RULE_Y = 31
/** A cache value "hot 52m" draws "hot" as a small word before the number. */
const wordZ = (z: number): number => Math.round(z * 0.6)

/**
 * One band column: small-caps label, serif numeral, italic tail at the right, ruled scale below.
 * The label outranks the hero's size and the little "hot" word; a stale reading keeps its
 * "as of" note when there is any way to fit it.
 */
function bandBlock(x: number, w: number, r: Readout, p: Palette, compact: boolean, isCache: boolean): string {
  const size = compact ? 17 : 20
  const label = (compact ? r.short : r.label).toUpperCase()
  const labelW = capsW(label, LZ, LS) + 7
  const hasWord = isCache && r.value.startsWith('hot ')
  const num = hasWord ? r.value.slice(4) : r.value
  const heroW = (z: number, word: boolean) => (word ? sw('hot', wordZ(z)) + 4 : 0) + sw(num, z, true)
  const stale = r.dim && r.extra ? sw(r.extra, 11) + 10 : 0

  type Hero = { z: number; word: boolean; label: boolean; cut?: string }
  const tryFit = (room: number, lab: boolean): Hero | undefined => {
    for (const word of hasWord ? [true, false] : [false]) {
      for (let z = size; z >= 12; z--) if (heroW(z, word) <= room) return { z, word, label: lab }
    }
    return undefined
  }
  let hero = (stale ? tryFit(w - labelW - stale, true) : undefined) ?? tryFit(w - labelW, true) ?? tryFit(w, false)
  if (!hero) {
    const t = fitText(num, size, 7, w / SF, true)
    hero = { z: t.size, word: false, label: false, cut: t.text }
  }

  let s = ''
  let at = x
  if (hero.label) {
    s += text(at, BASE, [{ text: label, fill: p.muted }], { size: LZ, weight: 600, spacing: LS })
    at += labelW
  }
  const spans: Span[] = []
  if (hero.word) spans.push({ text: 'hot', fill: r.valueFill, size: wordZ(hero.z), weight: 400 })
  spans.push({ text: hero.cut ?? num, fill: r.valueFill, dx: hero.word ? 4 : 0 })
  s += text(at, BASE, spans, { size: hero.z, weight: 600 })
  const end = at + (hero.cut ? sw(hero.cut, hero.z, true) : heroW(hero.z, hero.word))

  // Italic tail, longest first; a stale reading prefers its "as of" note over the reset time.
  const room = x + w - end - 10
  const full = [r.detail, r.extra].filter(t => t).join(', ')
  const short = [r.detail.replace(/resets in /, ''), r.detail.replace(/^.*resets in /, '')]
  const tails = isCache
    ? [bandTail(r, true)]
    : r.dim ? [full, bandTail(r, false), r.extra, ...short] : [full, bandTail(r, false), ...short, r.extra]
  const tail = tails.find(t => t && sw(t, 11) <= room)
  if (tail) s += italic(text(x + w, BASE, [{ text: tail, fill: p.muted }], { size: 11, anchor: 'end' }))
  s += scale(x, RULE_Y, w, r.frac, r.fill, p, 4, 3)
  return r.dim ? `<g opacity=".8">${s}</g>` : s
}

/** The strip above the prompt. `W` is the finished pixel width; `idTag` is the svg id letter. */
export function band(v: View, W: number, dark: boolean, idTag: string = ID_TAG): Art {
  const p = palette(dark)
  const id = 'uh' + idTag + (dark ? 'd' : 'l') + 'b'
  const H = BAND_H
  const pad = W < 200 ? 6 : W < 420 ? 11 : 16
  const gap = W < 200 ? 8 : W < 420 ? 16 : 30
  const compact = W < 560
  const inner = W - pad * 2
  const cache = cacheReadout(v, p)
  // Column rules: a hairline in the middle of each gap, as between newspaper columns.
  const colRule = (gx: number) => (gap >= 12 ? rect(gx - 0.5, 9, 1, 28, p.divider) : '')
  let body = ''
  if (limitsNa(v)) {
    // Both windows say the same: one wide quiet column, then the cache.
    const w1 = (inner - gap) * (2 / 3)
    const w2 = inner - gap - w1
    const lab = 'LIMITS'
    const labW = capsW(lab, LZ, LS) + 7
    const showLab = labW + sw('n/a', 13) <= w1
    let s = ''
    if (showLab) {
      s += text(pad, BASE, [{ text: lab, fill: p.muted }], { size: LZ, weight: 600, spacing: LS })
      s += italic(text(pad + labW, BASE, [{ text: 'n/a', fill: p.muted }], { size: 13 }))
      if (sw('no subscription limits', 11) <= w1 - labW - sw('n/a', 13) - 14) {
        s += italic(text(pad + w1, BASE, [{ text: 'no subscription limits', fill: p.faint }], { size: 11, anchor: 'end' }))
      }
    } else {
      const t = fitText('Limits n/a', 12, 8, w1 / SF)
      s += italic(text(pad, BASE, [{ text: t.text, fill: p.muted }], { size: t.size }))
    }
    body += s + scale(pad, RULE_Y, w1, 0, 'none', p, 4, 3)
    body += colRule(pad + w1 + gap / 2)
    body += bandBlock(pad + w1 + gap, w2, cache, p, compact, true)
  } else {
    const bw = (inner - gap * 2) / 3
    const reads = [windowReadout(v.fiveHour, p), windowReadout(v.sevenDay, p), cache]
    reads.forEach((r, i) => {
      const bx = pad + i * (bw + gap)
      if (i > 0) body += colRule(bx - gap / 2)
      body += bandBlock(bx, bw, r, p, compact, i === 2)
    })
  }
  return { source: sheet(W, H, p, id, body), width: W, height: H }
}

// ---- pane ----

/** The docked pane: masthead, three columns stacked as entries, footer. `W` is the finished pixel width. */
export function pane(v: View, W: number, dark: boolean, version: Version, idTag: string = ID_TAG): Art {
  const p = palette(dark)
  const id = 'uh' + idTag + (dark ? 'd' : 'l') + 'p'
  const narrow = W < 360
  const pad = narrow ? 14 : 22
  const big = narrow ? 28 : 38
  const inner = W - pad * 2
  const dsize = narrow ? 11.5 : 12.5
  const lh = narrow ? 14 : 16
  const hairline = (y: number) => rect(pad, y, inner, 1, p.divider)
  /** A printer's double rule: heavier ink line over a hairline. */
  const doubleRule = (y: number) => rect(pad, y, inner, 1.5, p.track) + rect(pad, y + 3.5, inner, 0.75, p.track)
  let body = ''

  // Masthead: serif title, double rule under it.
  const headH = narrow ? 34 : 44
  const head = fitText('Usage left', narrow ? 15 : 18, 10, inner / SF)
  body += text(pad, headH * 0.66, [{ text: head.text, fill: p.text }], { size: head.size, weight: 400 })
  body += doubleRule(headH - 2)
  let y = headH + (narrow ? 16 : 22)

  const block = (r: Readout, labels: string[], ticks: boolean): void => {
    const lz = narrow ? 9 : 9.5
    const sp = 1.8
    const caps = labels.map(l => l.toUpperCase())
    const label = caps.find(l => capsW(l, lz, sp) <= inner) ?? caps[caps.length - 1]!
    let s = ''
    if (capsW(label, lz, sp) <= inner) {
      s += text(pad, y + 9, [{ text: label, fill: p.muted }], { size: lz, weight: 600, spacing: sp })
    } else {
      const lab = fitText(label, lz, 7, (inner - label.length * sp) / SF, true)
      s += text(pad, y + 9, [{ text: lab.text, fill: p.muted }], { size: lab.size, weight: 600, spacing: sp })
    }

    // Hero: roman serif numeral; "hot" is a small word before it, an italic "left" trails it.
    const word = r.value.startsWith('hot ') ? 'hot' : ''
    const num = word ? r.value.slice(4) : r.value
    const smallZ = (z: number) => Math.round(z * 0.42)
    const widthAt = (z: number, unit: boolean) =>
      (word ? sw(word, smallZ(z)) + 6 : 0) + sw(num, z, true) + (unit && r.unit ? sw(r.unit, smallZ(z)) + 6 : 0)
    let z = big
    let unit = true
    while (z > 14 && widthAt(z, unit) > inner) z--
    if (widthAt(z, unit) > inner) { unit = false; z = big; while (z > 12 && widthAt(z, unit) > inner) z-- }
    const small = smallZ(z)
    const numRoom = inner - (word ? sw(word, small) + 6 : 0)
    const by = y + 18 + z * 0.74
    const lead: Span[] = []
    if (word) lead.push({ text: word, fill: p.muted, size: small, weight: 400 })
    lead.push({ text: widthAt(z, unit) > inner ? fitText(num, z, 8, numRoom / SF, true).text : num, fill: r.valueFill, dx: word ? 6 : 0 })
    // The unit rides in the same <text> (so it sits right after the real glyphs) and is set italic.
    if (unit && r.unit) lead.push({ text: r.unit, fill: p.muted, size: small, weight: 400, dx: 6 })
    let hero = text(pad, by, lead, { size: z, weight: 600 })
    if (unit && r.unit) hero = hero.replace(/<tspan(?=[^>]*>[^<]*<\/tspan><\/text>$)/, '<tspan font-style="italic"')
    s += hero

    // The ruled scale, with its 0 / 50 / 100 figures for the limit windows when they fit.
    const ruleY = by + (narrow ? 11 : 14)
    const tick = narrow ? 5 : 6
    s += scale(pad, ruleY, inner, r.frac, r.fill, p, tick, narrow ? 4 : 5)
    let ly = ruleY + tick + (narrow ? 14 : 17)
    if (ticks && inner >= 80) {
      const fz = 8.5
      const fy = ruleY + tick + 10
      s += text(pad, fy, [{ text: '0', fill: p.faint }], { size: fz })
      s += text(pad + inner / 2 - sw('50', fz) / 2, fy, [{ text: '50', fill: p.faint }], { size: fz })
      s += text(pad + inner, fy, [{ text: '100', fill: p.faint }], { size: fz, anchor: 'end' })
      ly = fy + (narrow ? 15 : 18)
    }
    const lines = wrapText([r.detail, r.extra].filter(t => t).join(', '), dsize, inner / SF, 3)
    s += italic(lines.map((l, i) => text(pad, ly + i * lh, [{ text: l, fill: p.muted }], { size: dsize })).join(''))
    ly += Math.max(0, lines.length - 1) * lh
    body += r.dim ? `<g opacity=".8">${s}</g>` : s
    y = ly + (narrow ? 20 : 26)
  }

  if (limitsNa(v)) {
    block({ ...windowReadout(v.fiveHour, p), label: 'Limits' }, ['Limits'], false)
  } else {
    const w5 = windowReadout(v.fiveHour, p)
    const w7 = windowReadout(v.sevenDay, p)
    block(w5, [w5.label, w5.short], true)
    body += hairline(y - (narrow ? 10 : 13))
    block(w7, [w7.label, w7.short], true)
  }
  body += hairline(y - (narrow ? 10 : 13))
  block(cacheReadout(v, p), ['Prompt cache', 'Cache'], false)

  // Colophon: the engine the mod was tested on, and a flag for any other.
  body += doubleRule(y - (narrow ? 11 : 14))
  y += 6
  const fz = 11.5
  const footText = 'tested on ' + version.tested
  const foot = fitText(footText, fz, 9, inner / SF)
  const untested = version.actual !== null && version.actual !== version.tested
  const note = `untested engine ${version.actual ?? ''}`
  const oneLine = foot.text === footText && sw(footText + '  ' + note, fz) <= inner - 8
  const spans: Span[] = [{ text: foot.text, fill: p.faint }]
  if (untested && oneLine) spans.push({ text: note, fill: p.midText, dx: 8 })
  let foots = text(pad, y, spans, { size: foot.size })
  if (untested && !oneLine) {
    for (const l of wrapText(note, fz, inner / SF, 2)) {
      y += 16
      foots += text(pad, y, [{ text: l, fill: p.midText }], { size: fz })
    }
  }
  body += italic(foots)
  const H = Math.ceil(y + (narrow ? 12 : 16))
  return { source: sheet(W, H, p, id, body), width: W, height: H }
}
