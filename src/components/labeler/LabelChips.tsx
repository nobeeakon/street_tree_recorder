import type { LabelDefinition } from '../../lib/annotationStore'
import { labelColorAt } from '../../lib/labelColors'
import { keyboardShortcutForLabelIndex } from '../../lib/labelShortcuts'

/**
 * The row of label buttons applied to one photo.
 *
 * It is its own component because the same row appears in two places — above
 * the photo on the page, and inside the full-screen view — and the two must not
 * drift apart: the colours, the tick box and the digit shortcuts are how the
 * labeller reads the state of a photo, whichever view they happen to be in.
 */
export interface LabelChipsProps {
  labels: readonly LabelDefinition[]
  appliedLabelIds: ReadonlySet<string>
  onToggleLabel: (labelId: string) => void
}

export function LabelChips({ labels, appliedLabelIds, onToggleLabel }: LabelChipsProps) {
  return (
    <div className="chips" role="group" aria-label="Etiquetas de esta foto">
      {labels.map((label, labelIndex) => {
        const isApplied = appliedLabelIds.has(label.id)
        const labelColor = labelColorAt(label.colorIndex)
        const shortcutDigit = keyboardShortcutForLabelIndex(labelIndex)
        const actionVerb = isApplied ? 'Quitar' : 'Poner'
        return (
          <button
            key={label.id}
            type="button"
            className={`chip ${isApplied ? 'chip--applied' : ''}`}
            aria-pressed={isApplied}
            onClick={() => onToggleLabel(label.id)}
            style={
              isApplied
                ? { backgroundColor: labelColor, borderColor: labelColor }
                : { borderColor: labelColor }
            }
            title={
              shortcutDigit === null
                ? `${actionVerb} "${label.name}"`
                : `${actionVerb} "${label.name}" (tecla ${shortcutDigit})`
            }
          >
            {/* A tick box, not just a colour: the button has to read as
                something that turns on and off, even before it is used. */}
            <span className="chip__state" aria-hidden="true">
              {isApplied ? '✓' : ''}
            </span>
            <span className="chip__name">{label.name}</span>
            {shortcutDigit !== null && <kbd className="chip__shortcut">{shortcutDigit}</kbd>}
          </button>
        )
      })}
    </div>
  )
}
