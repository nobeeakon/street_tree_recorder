/**
 * The export: everything the store holds, as one CSV row per photo.
 *
 * The file is the deliverable of a labelling session, so it carries the whole
 * database rather than only the photos currently on screen — including photos
 * that were opened and left unlabelled, which is itself survey data ("this spot
 * was looked at, and there was nothing to record").
 *
 * RFC 4180 formatting: CRLF line endings, quotes doubled inside quoted fields.
 * A UTF-8 byte order mark leads the file because Excel otherwise reads accented
 * label names as mojibake, and these labels are in Spanish.
 */

import type { AnnotationDatabase, PhotoAnnotation } from './annotationStore'
import { formatTimestampForFileName } from './geo'

const CSV_LINE_SEPARATOR = '\r\n'
const CSV_FIELD_SEPARATOR = ','
const UTF8_BYTE_ORDER_MARK = '﻿'

/** Matching the six decimals the recorder writes into the file names. */
const COORDINATE_DECIMAL_PLACES = 6

const CSV_COLUMN_HEADERS = [
  'file_name',
  'latitude',
  'longitude',
  'altitude_m',
  'captured_at',
  'label_count',
  'labels',
  'label_ids',
  'first_analyzed_at',
  'updated_at',
  'photo_key',
] as const

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

function buildCsvRow(
  annotation: PhotoAnnotation,
  labelNamesById: ReadonlyMap<string, string>,
): string {
  const labelNames = annotation.labelIds.map(labelId => labelNamesById.get(labelId) ?? labelId)

  return [
    annotation.fileName,
    formatCoordinate(annotation.latitudeDegrees),
    formatCoordinate(annotation.longitudeDegrees),
    annotation.altitudeMeters === null ? '' : annotation.altitudeMeters.toFixed(1),
    annotation.capturedAt ?? '',
    String(annotation.labelIds.length),
    // One cell per photo rather than one row per label: the survey is read as
    // "this point, these labels", and a spreadsheet splits the cell easily.
    labelNames.join('; '),
    annotation.labelIds.join('; '),
    annotation.firstAnalyzedAt,
    annotation.updatedAt,
    annotation.photoKey,
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
  const labelNamesById = new Map(database.labels.map(label => [label.id, label.name]))
  const annotations = Object.values(database.annotationsByPhotoKey).sort(compareAnnotationsByCaptureTime)

  const lines = [
    CSV_COLUMN_HEADERS.join(CSV_FIELD_SEPARATOR),
    ...annotations.map(annotation => buildCsvRow(annotation, labelNamesById)),
  ]

  return UTF8_BYTE_ORDER_MARK + lines.join(CSV_LINE_SEPARATOR) + CSV_LINE_SEPARATOR
}

export function buildAnnotationsCsvFileName(exportedAt: Date): string {
  return `etiquetas_${formatTimestampForFileName(exportedAt)}.csv`
}
