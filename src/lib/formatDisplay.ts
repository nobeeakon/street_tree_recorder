/**
 * Turning stored values into the strings the labelling page shows on screen.
 * Nothing here is ever written back to the store or the CSV — those keep ISO
 * timestamps and plain decimal degrees.
 */

import type { GeographicCoordinates } from './geo'

/** Six decimals is ~0.11 m: the precision the recorder stores. */
const COORDINATE_DECIMAL_PLACES = 6

const SPANISH_LOCALE = 'es-ES'

const dateTimeFormatter = new Intl.DateTimeFormat(SPANISH_LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatLocalDateTime(date: Date | null): string {
  return date === null ? '—' : dateTimeFormatter.format(date)
}

export function formatIsoTimestamp(isoTimestamp: string | null): string {
  if (isoTimestamp === null) {
    return '—'
  }
  const date = new Date(isoTimestamp)
  return Number.isNaN(date.getTime()) ? isoTimestamp : dateTimeFormatter.format(date)
}

/** `40.416775, -3.703790` — the form that pastes straight into a map search box. */
export function formatCoordinates(coordinates: GeographicCoordinates | null): string {
  if (coordinates === null) {
    return '—'
  }
  const latitude = coordinates.latitudeDegrees.toFixed(COORDINATE_DECIMAL_PLACES)
  const longitude = coordinates.longitudeDegrees.toFixed(COORDINATE_DECIMAL_PLACES)
  return `${latitude}, ${longitude}`
}

const BYTES_PER_MEGABYTE = 1024 * 1024

export function formatFileSize(fileSizeBytes: number): string {
  return `${(fileSizeBytes / BYTES_PER_MEGABYTE).toFixed(1)} MB`
}
