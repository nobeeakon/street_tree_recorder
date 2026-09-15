/**
 * The export: everything the store holds, as one CSV row per photo.
 *
 * The file is the deliverable of a labelling session, so it carries the whole
 * database rather than only the photos currently on screen — including photos
 * that were opened and left unlabelled, which is itself survey data ("this spot
 * was looked at, and there was nothing to record"). A label filter narrows that
 * down when only part of the survey is wanted, but it is opt-in: with no filter
 * the file is still the whole database.
 *
 * The shape is one column per label rather than a list of names in a single
 * cell: a spreadsheet filters, counts and pivots a `si`/`no` column directly,
 * and every label in the catalogue gets a column even if no photo carries it, so
 * the columns are the same from one export to the next. Internal identifiers
 * (label ids, the photo's content hash) are deliberately left out — they mean
 * nothing outside this app, and the file name identifies the photo for whoever
 * reads the survey.
 *
 * RFC 4180 formatting: CRLF line endings, quotes doubled inside quoted fields.
 * A UTF-8 byte order mark leads the file because Excel otherwise reads accented
 * label names as mojibake, and these labels are in Spanish.
 */

import type { AnnotationDatabase, LabelDefinition, PhotoAnnotation } from './annotationStore'
import { formatTimestampForFileName } from './geo'

const CSV_LINE_SEPARATOR = '\r\n'
const CSV_FIELD_SEPARATOR = ','
const UTF8_BYTE_ORDER_MARK = '﻿'

/** Matching the six decimals the recorder writes into the file names. */
const COORDINATE_DECIMAL_PLACES = 6

/** The columns that precede the per-label ones, in this order. */
const FIXED_COLUMN_HEADERS = ['file_name', 'latitude', 'longitude', 'captured_at'] as const

const LABEL_PRESENT_VALUE = 'si'
const LABEL_ABSENT_VALUE = 'no'

/**
 * A field is quoted whenever it contains a separator, a quote or a newline — and
 * label names are free text, so they routinely do.
 */
function formatCsvField(value: string): string {
  const needsQuoting = /[",\r\n]/.test(value)
  return needsQuoting ? `"${value.replaceAll('"', '""')}"` : value
}

function formatCoordinate(degrees: number | null): string {
  return degrees === null ? '' : degrees.toFixed(COORDINATE_DECIMAL_PLACES)
}

/**
 * Column headers for the label catalogue, in catalogue order.
 *
 * The labeller refuses to create two labels with the same name, but the store is
 * read back from `localStorage`, which anything could have written; a repeated
 * name would produce two identical headers and a spreadsheet would silently read
 * only one of them. Repeats are suffixed instead, so every column stays
 * addressable.
 */
function buildLabelColumnHeaders(labels: readonly LabelDefinition[]): string[] {
  const timesHeaderUsed = new Map<string, number>()

  return labels.map(label => {
    const previousUses = timesHeaderUsed.get(label.name) ?? 0
    timesHeaderUsed.set(label.name, previousUses + 1)
    return previousUses === 0 ? label.name : `${label.name} (${previousUses + 1})`
  })
}

function buildCsvRow(annotation: PhotoAnnotation, labels: readonly LabelDefinition[]): string {
  const appliedLabelIds = new Set(annotation.labelIds)

  return [
    annotation.fileName,
    formatCoordinate(annotation.latitudeDegrees),
    formatCoordinate(annotation.longitudeDegrees),
    annotation.capturedAt ?? '',
    ...labels.map(label => (appliedLabelIds.has(label.id) ? LABEL_PRESENT_VALUE : LABEL_ABSENT_VALUE)),
  ]
    .map(formatCsvField)
    .join(CSV_FIELD_SEPARATOR)
}

// --- Filtering -------------------------------------------------------------

/**
 * How a photo has to relate to the chosen labels to be exported.
 *
 * `any` answers "show me everything I marked as a problem", `all` answers "show
 * me the ones that are both dead *and* leaning" — two different surveys, and
 * neither is guessable from the selection alone.
 */
export type LabelFilterMatchMode = 'any' | 'all'

export interface AnnotationLabelFilter {
  /** Catalogue ids. Empty means no filtering: every stored photo is exported. */
  selectedLabelIds: readonly string[]
  matchMode: LabelFilterMatchMode
}

export const EXPORT_EVERYTHING_FILTER: AnnotationLabelFilter = {
  selectedLabelIds: [],
  matchMode: 'any',
}

/**
 * The photos an export with this filter would contain.
 *
 * Exported separately from the CSV builder so the export dialog can show the
 * row count *before* the file is written — picking labels blind and discovering
 * an empty file in Downloads is a poor way to find out the filter was wrong.
 */
export function filterAnnotationsByLabels(
  annotations: readonly PhotoAnnotation[],
  filter: AnnotationLabelFilter,
): PhotoAnnotation[] {
  if (filter.selectedLabelIds.length === 0) {
    return [...annotations]
  }

  const selectedLabelIds = new Set(filter.selectedLabelIds)

  if (filter.matchMode === 'all') {
    return annotations.filter(annotation => {
      const appliedLabelIds = new Set(annotation.labelIds)
      return filter.selectedLabelIds.every(labelId => appliedLabelIds.has(labelId))
    })
  }

  return annotations.filter(annotation =>
    annotation.labelIds.some(labelId => selectedLabelIds.has(labelId)),
  )
}

/** Capture order, so the rows follow the walk; undated photos trail at the end. */
function compareAnnotationsByCaptureTime(first: PhotoAnnotation, second: PhotoAnnotation): number {
  if (first.capturedAt && second.capturedAt) {
    return first.capturedAt.localeCompare(second.capturedAt)
  }
  if (first.capturedAt) {
    return -1
  }
  if (second.capturedAt) {
    return 1
  }
  return first.fileName.localeCompare(second.fileName)
}

/**
 * A filtered file still gets a column for every label in the catalogue: the
 * columns describe the survey, not the selection, and keeping them identical
 * across exports is what lets two files be stacked in the same spreadsheet.
 */
export function buildAnnotationsCsv(
  database: AnnotationDatabase,
  filter: AnnotationLabelFilter = EXPORT_EVERYTHING_FILTER,
): string {
  const labels = database.labels
  const annotations = filterAnnotationsByLabels(
    Object.values(database.annotationsByPhotoKey),
    filter,
  ).sort(compareAnnotationsByCaptureTime)

  const headerLine = [...FIXED_COLUMN_HEADERS, ...buildLabelColumnHeaders(labels)]
    .map(formatCsvField)
    .join(CSV_FIELD_SEPARATOR)

  const lines = [headerLine, ...annotations.map(annotation => buildCsvRow(annotation, labels))]

  return UTF8_BYTE_ORDER_MARK + lines.join(CSV_LINE_SEPARATOR) + CSV_LINE_SEPARATOR
}

/**
 * Filtered files say so in their name: several exports of the same walk end up
 * side by side in the Downloads folder, and only the timestamp telling them
 * apart would leave no way to know which one is the partial survey.
 */
export function buildAnnotationsCsvFileName(exportedAt: Date, isFiltered = false): string {
  const fileNameStem = isFiltered ? 'etiquetas_filtradas' : 'etiquetas'
  return `${fileNameStem}_${formatTimestampForFileName(exportedAt)}.csv`
}
