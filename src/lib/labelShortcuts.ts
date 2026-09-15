/**
 * How many labels can be reached from the keyboard while stepping through a
 * gallery. The limit is the keyboard's, not a preference: there are nine digit
 * keys that are not `0`, so the tenth label onwards is mouse-only.
 *
 * Three places have to agree on this number — the page's summary line, the
 * chips over the photo, and the label catalogue — so it lives here rather than
 * as a literal in each of them.
 */
export const MAXIMUM_KEYBOARD_SHORTCUT_LABELS = 9

/**
 * The digit that toggles the label at `labelIndex`, or `null` when the label is
 * past the ninth and has no key of its own.
 */
export function keyboardShortcutForLabelIndex(labelIndex: number): number | null {
  return labelIndex < MAXIMUM_KEYBOARD_SHORTCUT_LABELS ? labelIndex + 1 : null
}
