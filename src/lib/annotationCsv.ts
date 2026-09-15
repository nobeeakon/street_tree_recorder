/**
 * The export: everything the store holds, as one CSV row per photo.
 *
 * The file is the deliverable of a labelling session, so it carries the whole
 * database rather than only the photos currently on screen — including photos
 * that were opened and left unlabelled, which is itself survey data ("this spot
 * was looked at, and there was nothing to record").
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

export function buildAnnotationsCsv(database: AnnotationDatabase): string {
  const labels = database.labels
  const annotations = Object.values(database.annotationsByPhotoKey).sort(compareAnnotationsByCaptureTime)

  const headerLine = [...FIXED_COLUMN_HEADERS, ...buildLabelColumnHeaders(labels)]
    .map(formatCsvField)
    .join(CSV_FIELD_SEPARATOR)

  const lines = [headerLine, ...annotations.map(annotation => buildCsvRow(annotation, labels))]

  return UTF8_BYTE_ORDER_MARK + lines.join(CSV_LINE_SEPARATOR) + CSV_LINE_SEPARATOR
}

export function buildAnnotationsCsvFileName(exportedAt: Date): string {
  return `etiquetas_${formatTimestampForFileName(exportedAt)}.csv`
}
