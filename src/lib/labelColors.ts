/**
 * The colours labels are drawn in.
 *
 * Only the *index* is stored with a label, never the colour itself, so the
 * palette can be retuned without rewriting anyone's saved data. The hues are
 * spread around the wheel and kept light enough to read dark text on, which is
 * how the chips are rendered.
 */

export const LABEL_COLOR_PALETTE = [
  '#3ddc84', // the app's accent green
  '#5bb8ff',
  '#ffd166',
  '#ff8fa3',
  '#c39bff',
  '#4fd1c5',
  '#ffa76b',
  '#a3e635',
  '#f472b6',
  '#7dd3fc',
] as const

export function labelColorAt(colorIndex: number): string {
  // Stored indices come from localStorage, so anything could be in there.
  const safeIndex = Number.isInteger(colorIndex) && colorIndex >= 0 ? colorIndex : 0
  return LABEL_COLOR_PALETTE[safeIndex % LABEL_COLOR_PALETTE.length]
}

/** Gives each new label the next colour in the palette, cycling once it runs out. */
export function nextLabelColorIndex(existingLabelCount: number): number {
  return existingLabelCount % LABEL_COLOR_PALETTE.length
}
