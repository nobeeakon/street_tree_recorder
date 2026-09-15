/**
 * Reading the GPS fix back out of a JPEG's Exif APP1 segment.
 *
 * This is the counterpart of [exif.ts](./exif.ts): the writer geotags the photos
 * the recorder saves, and this reader recovers those coordinates when the photos
 * are loaded back into the labelling page.
 *
 * It is deliberately more tolerant than the writer. Photos may come from any
 * camera, in either byte order, carrying tags this app never writes — and a file
 * with no position at all (a screenshot, a PNG, a stripped JPEG) is an ordinary
 * case, not a failure. Anything unreadable yields `null` fields rather than an
 * exception; only a malformed TIFF header, which means the file is not what it
 * claims to be, throws.
 */

import type { GeographicCoordinates } from './geo'

export class ExifReadError extends Error {
  override name = 'ExifReadError'
}

/** Everything the labelling page can learn about a photo from its own bytes. */
export interface JpegExifMetadata {
  coordinates: GeographicCoordinates | null
  /** Metres above sea level; negative below it. */
  altitudeMeters: number | null
  /** The `GPSHPositioningError` radius the recorder wrote, when present. */
  accuracyMeters: number | null
  capturedAt: Date | null
}

function buildEmptyMetadata(): JpegExifMetadata {
  return { coordinates: null, altitudeMeters: null, accuracyMeters: null, capturedAt: null }
}

// --- JPEG segment walking --------------------------------------------------

const JPEG_MARKER_PREFIX = 0xff
const JPEG_MARKER_START_OF_IMAGE = 0xd8
const JPEG_MARKER_APP1 = 0xe1
const JPEG_MARKER_START_OF_SCAN = 0xda
const JPEG_MARKER_END_OF_IMAGE = 0xd9

/** `Exif\0\0`, the identifier that separates Exif APP1 from an XMP one. */
const EXIF_IDENTIFIER_BYTES = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]

/** A segment's two-byte length counts itself but not the marker. */
const SEGMENT_LENGTH_FIELD_BYTES = 2

function hasExifIdentifierAt(bytes: Uint8Array, offset: number): boolean {
  return EXIF_IDENTIFIER_BYTES.every((byte, index) => bytes[offset + index] === byte)
}

/**
 * Returns the offset of the TIFF header inside the first Exif APP1 segment, or
 * `null` when the file carries no Exif at all.
 *
 * Segments are skipped by their declared length, which is the only way to walk a
 * JPEG without decoding it. The scan stops at the start of the image data: past
 * that point a 0xFF byte is compressed pixel data, not a marker.
 */
function findExifTiffHeaderOffset(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== JPEG_MARKER_PREFIX) {
      // Not sitting on a marker boundary any more: the segment table is broken,
      // and guessing where the next one starts would only invent metadata.
      return null
    }

    // Encoders may pad between segments with any number of 0xFF fill bytes.
    let markerOffset = offset + 1
    while (markerOffset < bytes.length && bytes[markerOffset] === JPEG_MARKER_PREFIX) {
      markerOffset += 1
    }
    const marker = bytes[markerOffset]

    if (marker === JPEG_MARKER_START_OF_SCAN || marker === JPEG_MARKER_END_OF_IMAGE) {
      return null
    }

    const segmentLengthOffset = markerOffset + 1
    if (segmentLengthOffset + SEGMENT_LENGTH_FIELD_BYTES > bytes.length) {
      return null
    }
    const segmentLength = view.getUint16(segmentLengthOffset)
    if (segmentLength < SEGMENT_LENGTH_FIELD_BYTES) {
      return null
    }

    const payloadOffset = segmentLengthOffset + SEGMENT_LENGTH_FIELD_BYTES
    if (marker === JPEG_MARKER_APP1 && hasExifIdentifierAt(bytes, payloadOffset)) {
      return payloadOffset + EXIF_IDENTIFIER_BYTES.length
    }

    offset = segmentLengthOffset + segmentLength
  }

  return null
}

// --- TIFF directory reading ------------------------------------------------

/** Where the TIFF block starts and which way round its numbers are. */
interface TiffCursor {
  view: DataView
  tiffHeaderOffset: number
  isLittleEndian: boolean
}

interface DirectoryEntry {
  typeCode: number
  componentCount: number
  /** Absolute offset into the view where the components begin. */
  valueOffset: number
}

/** Bytes per component, indexed by TIFF type code; 0 marks a type we cannot size. */
const TIFF_TYPE_COMPONENT_BYTES: readonly number[] = [
  0, // no type 0
  1, // BYTE
  1, // ASCII
  2, // SHORT
  4, // LONG
  8, // RATIONAL
  1, // SBYTE
  1, // UNDEFINED
  2, // SSHORT
  4, // SLONG
  8, // SRATIONAL
  4, // FLOAT
  8, // DOUBLE
]

const TIFF_TYPE_ASCII = 2
const TIFF_TYPE_RATIONAL = 5
const TIFF_TYPE_SRATIONAL = 10

const TIFF_HEADER_BYTE_LENGTH = 8
const IFD_ENTRY_BYTE_LENGTH = 12
const INLINE_VALUE_BYTE_LENGTH = 4

const TIFF_BYTE_ORDER_LITTLE_ENDIAN = 0x4949
const TIFF_BYTE_ORDER_BIG_ENDIAN = 0x4d4d
const TIFF_MAGIC_NUMBER = 0x002a

function createTiffCursor(bytes: Uint8Array, tiffHeaderOffset: number): TiffCursor {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (tiffHeaderOffset + TIFF_HEADER_BYTE_LENGTH > bytes.length) {
    throw new ExifReadError('El segmento Exif está truncado: no cabe ni la cabecera TIFF.')
  }

  const byteOrderMark = view.getUint16(tiffHeaderOffset)
  if (byteOrderMark !== TIFF_BYTE_ORDER_LITTLE_ENDIAN && byteOrderMark !== TIFF_BYTE_ORDER_BIG_ENDIAN) {
    throw new ExifReadError('La cabecera TIFF del Exif no declara un orden de bytes válido.')
  }
  const isLittleEndian = byteOrderMark === TIFF_BYTE_ORDER_LITTLE_ENDIAN

  if (view.getUint16(tiffHeaderOffset + 2, isLittleEndian) !== TIFF_MAGIC_NUMBER) {
    throw new ExifReadError('La cabecera TIFF del Exif no lleva su número mágico.')
  }

  return { view, tiffHeaderOffset, isLittleEndian }
}

/**
 * Reads one image file directory into a tag → entry map, skipping any entry that
 * points outside the file or uses a type of unknown size. A camera that writes
 * one nonsensical entry should still yield the coordinates in the next one.
 */
function readDirectoryEntries(cursor: TiffCursor, directoryOffset: number): Map<number, DirectoryEntry> {
  const { view, tiffHeaderOffset, isLittleEndian } = cursor
  const directoryStart = tiffHeaderOffset + directoryOffset
  const entries = new Map<number, DirectoryEntry>()

  if (directoryStart < tiffHeaderOffset || directoryStart + 2 > view.byteLength) {
    return entries
  }

  const entryCount = view.getUint16(directoryStart, isLittleEndian)
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    const entryStart = directoryStart + 2 + entryIndex * IFD_ENTRY_BYTE_LENGTH
    if (entryStart + IFD_ENTRY_BYTE_LENGTH > view.byteLength) {
      break
    }

    const tag = view.getUint16(entryStart, isLittleEndian)
    const typeCode = view.getUint16(entryStart + 2, isLittleEndian)
    const componentCount = view.getUint32(entryStart + 4, isLittleEndian)
    const componentBytes = TIFF_TYPE_COMPONENT_BYTES[typeCode] ?? 0
    if (componentBytes === 0) {
      continue
    }

    const totalByteLength = componentBytes * componentCount
    const valueOffset =
      totalByteLength <= INLINE_VALUE_BYTE_LENGTH
        ? entryStart + 8
        : tiffHeaderOffset + view.getUint32(entryStart + 8, isLittleEndian)

    if (valueOffset < 0 || valueOffset + totalByteLength > view.byteLength) {
      continue
    }

    entries.set(tag, { typeCode, componentCount, valueOffset })
  }

  return entries
}

function readAsciiField(cursor: TiffCursor, entry: DirectoryEntry | undefined): string | null {
  if (!entry || entry.typeCode !== TIFF_TYPE_ASCII) {
    return null
  }

  let text = ''
  for (let characterIndex = 0; characterIndex < entry.componentCount; characterIndex += 1) {
    const characterCode = cursor.view.getUint8(entry.valueOffset + characterIndex)
    // The field is NUL-terminated and may be padded past the terminator.
    if (characterCode === 0) {
      break
    }
    text += String.fromCharCode(characterCode)
  }

  return text.trim() === '' ? null : text.trim()
}

/** Reads a RATIONAL/SRATIONAL field as plain numbers; a zero denominator yields NaN. */
function readRationalField(cursor: TiffCursor, entry: DirectoryEntry | undefined): number[] | null {
  if (!entry || (entry.typeCode !== TIFF_TYPE_RATIONAL && entry.typeCode !== TIFF_TYPE_SRATIONAL)) {
    return null
  }

  const { view, isLittleEndian } = cursor
  const isSigned = entry.typeCode === TIFF_TYPE_SRATIONAL
  const values: number[] = []

  for (let componentIndex = 0; componentIndex < entry.componentCount; componentIndex += 1) {
    const componentOffset = entry.valueOffset + componentIndex * 8
    const numerator = isSigned
      ? view.getInt32(componentOffset, isLittleEndian)
      : view.getUint32(componentOffset, isLittleEndian)
    const denominator = isSigned
      ? view.getInt32(componentOffset + 4, isLittleEndian)
      : view.getUint32(componentOffset + 4, isLittleEndian)
    values.push(denominator === 0 ? Number.NaN : numerator / denominator)
  }

  return values
}

/** Reads the first component of a BYTE/SHORT/LONG field, which is all any tag here needs. */
function readFirstIntegerComponent(cursor: TiffCursor, entry: DirectoryEntry | undefined): number | null {
  if (!entry || entry.componentCount === 0) {
    return null
  }

  const { view, isLittleEndian } = cursor
  switch (entry.typeCode) {
    case 1: // BYTE
    case 7: // UNDEFINED
      return view.getUint8(entry.valueOffset)
    case 3: // SHORT
      return view.getUint16(entry.valueOffset, isLittleEndian)
    case 4: // LONG
      return view.getUint32(entry.valueOffset, isLittleEndian)
    default:
      return null
  }
}

// --- Tag numbers -----------------------------------------------------------

const IFD0_TAG_EXIF_IFD_POINTER = 0x8769
const IFD0_TAG_GPS_IFD_POINTER = 0x8825

const EXIF_TAG_DATE_TIME_ORIGINAL = 0x9003
const EXIF_TAG_OFFSET_TIME_ORIGINAL = 0x9011

const GPS_TAG_LATITUDE_REF = 0x0001
const GPS_TAG_LATITUDE = 0x0002
const GPS_TAG_LONGITUDE_REF = 0x0003
const GPS_TAG_LONGITUDE = 0x0004
const GPS_TAG_ALTITUDE_REF = 0x0005
const GPS_TAG_ALTITUDE = 0x0006
const GPS_TAG_TIME_STAMP = 0x0007
const GPS_TAG_DATE_STAMP = 0x001d
const GPS_TAG_HORIZONTAL_POSITIONING_ERROR = 0x001f

const ALTITUDE_REF_BELOW_SEA_LEVEL = 1

const MAXIMUM_LATITUDE_DEGREES = 90
const MAXIMUM_LONGITUDE_DEGREES = 180

// --- Value interpretation --------------------------------------------------

const MINUTES_PER_DEGREE = 60
const SECONDS_PER_DEGREE = 3600

/**
 * Turns the degrees/minutes/seconds triplet Exif stores back into a signed
 * decimal degree, using the hemisphere letter from the companion `*Ref` tag.
 */
function toDecimalDegrees(
  degreesMinutesSeconds: readonly number[] | null,
  hemisphere: string | null,
  maximumMagnitude: number,
): number | null {
  if (!degreesMinutesSeconds || degreesMinutesSeconds.length < 3) {
    return null
  }

  const [degrees, minutes, seconds] = degreesMinutesSeconds
  const magnitude = degrees + minutes / MINUTES_PER_DEGREE + seconds / SECONDS_PER_DEGREE
  if (!Number.isFinite(magnitude) || magnitude > maximumMagnitude) {
    return null
  }

  const normalisedHemisphere = hemisphere?.toUpperCase() ?? ''
  const isNegativeHemisphere = normalisedHemisphere === 'S' || normalisedHemisphere === 'W'
  return isNegativeHemisphere ? -magnitude : magnitude
}

/** `2026:08:24 10:19:00` → the parts of a date, or `null` if it is not that shape. */
function parseExifDateTimeParts(exifDateTime: string): number[] | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(exifDateTime)
  if (!match) {
    return null
  }
  return match.slice(1).map(Number)
}

/**
 * The capture instant, preferring the GPS clock: it is UTC by definition, so it
 * needs no guess about which time zone the camera was set to. The Exif
 * `DateTimeOriginal` is the fallback, read with its UTC offset when the camera
 * recorded one and as local time when it did not.
 */
function readCapturedAt(
  cursor: TiffCursor,
  gpsEntries: Map<number, DirectoryEntry>,
  exifEntries: Map<number, DirectoryEntry>,
): Date | null {
  const gpsDateStamp = readAsciiField(cursor, gpsEntries.get(GPS_TAG_DATE_STAMP))
  const gpsTimeStamp = readRationalField(cursor, gpsEntries.get(GPS_TAG_TIME_STAMP))

  if (gpsDateStamp && gpsTimeStamp && gpsTimeStamp.length >= 3) {
    const dateMatch = /^(\d{4}):(\d{2}):(\d{2})$/.exec(gpsDateStamp)
    const [hours, minutes, seconds] = gpsTimeStamp
    if (dateMatch && [hours, minutes, seconds].every(Number.isFinite)) {
      const [year, month, day] = dateMatch.slice(1).map(Number)
      const utcMilliseconds = Date.UTC(year, month - 1, day, hours, minutes, 0, Math.round(seconds * 1000))
      const gpsDate = new Date(utcMilliseconds)
      if (!Number.isNaN(gpsDate.getTime())) {
        return gpsDate
      }
    }
  }

  const dateTimeOriginal = readAsciiField(cursor, exifEntries.get(EXIF_TAG_DATE_TIME_ORIGINAL))
  if (!dateTimeOriginal) {
    return null
  }

  const parts = parseExifDateTimeParts(dateTimeOriginal)
  if (!parts) {
    return null
  }
  const [year, month, day, hours, minutes, seconds] = parts

  const utcOffset = readAsciiField(cursor, exifEntries.get(EXIF_TAG_OFFSET_TIME_ORIGINAL))
  if (utcOffset && /^[+-]\d{2}:\d{2}$/.test(utcOffset)) {
    const isoTimestamp =
      `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` +
      `T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` +
      utcOffset
    const offsetDate = new Date(isoTimestamp)
    if (!Number.isNaN(offsetDate.getTime())) {
      return offsetDate
    }
  }

  // No offset recorded: the only sane reading left is "the clock of whoever is
  // looking at the photo", which is what the Date constructor does here.
  const localDate = new Date(year, month - 1, day, hours, minutes, seconds)
  return Number.isNaN(localDate.getTime()) ? null : localDate
}

// --- Entry point -----------------------------------------------------------

/**
 * Extracts the position and capture time from a photo's Exif metadata.
 *
 * A file with no Exif, no GPS IFD or no coordinates comes back with `null`
 * fields — that is how an ungeotagged photo looks, and the caller decides
 * whether to treat it as a problem. `ExifReadError` is reserved for a file whose
 * Exif segment exists but is structurally broken.
 */
export function readExifMetadataFromImage(imageBytes: Uint8Array): JpegExifMetadata {
  if (
    imageBytes.length < 4 ||
    imageBytes[0] !== JPEG_MARKER_PREFIX ||
    imageBytes[1] !== JPEG_MARKER_START_OF_IMAGE
  ) {
    // PNG, WebP, HEIC…: no JPEG APP1 to walk, so there is nothing to read.
    return buildEmptyMetadata()
  }

  const tiffHeaderOffset = findExifTiffHeaderOffset(imageBytes)
  if (tiffHeaderOffset === null) {
    return buildEmptyMetadata()
  }

  const cursor = createTiffCursor(imageBytes, tiffHeaderOffset)
  const ifd0Offset = cursor.view.getUint32(tiffHeaderOffset + 4, cursor.isLittleEndian)
  const ifd0Entries = readDirectoryEntries(cursor, ifd0Offset)

  const gpsIfdOffset = readFirstIntegerComponent(cursor, ifd0Entries.get(IFD0_TAG_GPS_IFD_POINTER))
  const exifIfdOffset = readFirstIntegerComponent(cursor, ifd0Entries.get(IFD0_TAG_EXIF_IFD_POINTER))
  const gpsEntries = gpsIfdOffset === null ? new Map<number, DirectoryEntry>() : readDirectoryEntries(cursor, gpsIfdOffset)
  const exifEntries =
    exifIfdOffset === null ? new Map<number, DirectoryEntry>() : readDirectoryEntries(cursor, exifIfdOffset)

  const latitudeDegrees = toDecimalDegrees(
    readRationalField(cursor, gpsEntries.get(GPS_TAG_LATITUDE)),
    readAsciiField(cursor, gpsEntries.get(GPS_TAG_LATITUDE_REF)),
    MAXIMUM_LATITUDE_DEGREES,
  )
  const longitudeDegrees = toDecimalDegrees(
    readRationalField(cursor, gpsEntries.get(GPS_TAG_LONGITUDE)),
    readAsciiField(cursor, gpsEntries.get(GPS_TAG_LONGITUDE_REF)),
    MAXIMUM_LONGITUDE_DEGREES,
  )

  const rawAltitude = readRationalField(cursor, gpsEntries.get(GPS_TAG_ALTITUDE))?.[0] ?? null
  const isBelowSeaLevel =
    readFirstIntegerComponent(cursor, gpsEntries.get(GPS_TAG_ALTITUDE_REF)) === ALTITUDE_REF_BELOW_SEA_LEVEL
  const altitudeMeters =
    rawAltitude === null || !Number.isFinite(rawAltitude)
      ? null
      : isBelowSeaLevel
        ? -Math.abs(rawAltitude)
        : rawAltitude

  const rawAccuracy = readRationalField(cursor, gpsEntries.get(GPS_TAG_HORIZONTAL_POSITIONING_ERROR))?.[0] ?? null

  return {
    coordinates:
      latitudeDegrees === null || longitudeDegrees === null ? null : { latitudeDegrees, longitudeDegrees },
    altitudeMeters,
    accuracyMeters: rawAccuracy !== null && Number.isFinite(rawAccuracy) ? rawAccuracy : null,
    capturedAt: readCapturedAt(cursor, gpsEntries, exifEntries),
  }
}
