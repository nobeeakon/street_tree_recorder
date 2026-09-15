/**
 * Writing the GPS fix into the photo itself, as an Exif APP1 segment.
 *
 * `canvas.toBlob()` hands back a bare JPEG: the browser attaches no metadata
 * whatsoever, so the position has to be spliced in afterwards. What follows is a
 * minimal Exif writer — a TIFF header, an IFD0 with the capture date, an Exif
 * sub-IFD with the original timestamp, and a GPS IFD with latitude, longitude,
 * altitude, UTC time and the accuracy of the fix. That is the set of tags photo
 * viewers, exiftool, Lightroom and Google Photos actually read to place a photo
 * on a map.
 *
 * Everything is big-endian ("MM" byte order), which keeps the offsets readable
 * in a hex dump and is what most cameras emit.
 */

import type { GeographicCoordinates } from './geo'

export class ExifWriteError extends Error {
  override name = 'ExifWriteError'
}

/** Everything the app knows about a capture that is worth storing in the file. */
export interface PhotoExifMetadata {
  coordinates: GeographicCoordinates
  capturedAt: Date
  /** Radius of the 68 % confidence circle of the fix, as reported by the browser. */
  accuracyMeters?: number | null
  /** Metres above sea level; the browser leaves it null when the device has no fix on it. */
  altitudeMeters?: number | null
}

// --- TIFF primitives -------------------------------------------------------

interface Rational {
  numerator: number
  denominator: number
}

type ExifFieldValue =
  | { type: 'BYTE'; bytes: readonly number[] }
  | { type: 'ASCII'; text: string }
  | { type: 'SHORT'; numbers: readonly number[] }
  | { type: 'LONG'; numbers: readonly number[] }
  | { type: 'RATIONAL'; rationals: readonly Rational[] }
  | { type: 'UNDEFINED'; bytes: readonly number[] }

interface ExifField {
  tag: number
  value: ExifFieldValue
}

const TIFF_TYPE_CODES: Record<ExifFieldValue['type'], number> = {
  BYTE: 1,
  ASCII: 2,
  SHORT: 3,
  LONG: 4,
  RATIONAL: 5,
  UNDEFINED: 7,
}

const TIFF_TYPE_COMPONENT_BYTES: Record<ExifFieldValue['type'], number> = {
  BYTE: 1,
  ASCII: 1,
  SHORT: 2,
  LONG: 4,
  RATIONAL: 8,
  UNDEFINED: 1,
}

/** Byte order mark, magic number and the offset of IFD0 — always 8 here. */
const TIFF_HEADER_BYTE_LENGTH = 8

/** An IFD entry carries its value inline when it fits in the 4-byte value slot. */
const INLINE_VALUE_BYTE_LENGTH = 4

const IFD_ENTRY_BYTE_LENGTH = 12

function componentCountOf(value: ExifFieldValue): number {
  switch (value.type) {
    // The count of an ASCII field includes its NUL terminator.
    case 'ASCII':
      return value.text.length + 1
    case 'BYTE':
    case 'UNDEFINED':
      return value.bytes.length
    case 'SHORT':
    case 'LONG':
      return value.numbers.length
    case 'RATIONAL':
      return value.rationals.length
  }
}

function byteLengthOf(value: ExifFieldValue): number {
  return componentCountOf(value) * TIFF_TYPE_COMPONENT_BYTES[value.type]
}

function encodeFieldValue(value: ExifFieldValue): Uint8Array {
  const encodedBytes = new Uint8Array(byteLengthOf(value))
  const encodedView = new DataView(encodedBytes.buffer)

  switch (value.type) {
    case 'ASCII':
      for (let characterIndex = 0; characterIndex < value.text.length; characterIndex += 1) {
        const characterCode = value.text.charCodeAt(characterIndex)
        // Exif ASCII fields are 7-bit; anything else would be read as mojibake.
        encodedBytes[characterIndex] = characterCode < 0x80 ? characterCode : 0x3f
      }
      // The last byte stays zero: that is the NUL terminator counted above.
      break
    case 'BYTE':
    case 'UNDEFINED':
      encodedBytes.set(value.bytes)
      break
    case 'SHORT':
      value.numbers.forEach((number, index) => encodedView.setUint16(index * 2, number))
      break
    case 'LONG':
      value.numbers.forEach((number, index) => encodedView.setUint32(index * 4, number))
      break
    case 'RATIONAL':
      value.rationals.forEach((rational, index) => {
        encodedView.setUint32(index * 8, rational.numerator)
        encodedView.setUint32(index * 8 + 4, rational.denominator)
      })
      break
  }

  return encodedBytes
}

/** Out-of-line values are word-aligned, so odd-length ones are followed by a pad byte. */
function paddedByteLengthOf(value: ExifFieldValue): number {
  const byteLength = byteLengthOf(value)
  return byteLength + (byteLength % 2)
}

/** Total bytes an IFD occupies: the entry table plus every value too big to inline. */
function byteLengthOfImageFileDirectory(fields: readonly ExifField[]): number {
  const entryTableByteLength = 2 + fields.length * IFD_ENTRY_BYTE_LENGTH + 4
  const outOfLineByteLength = fields.reduce(
    (total, field) =>
      byteLengthOf(field.value) <= INLINE_VALUE_BYTE_LENGTH
        ? total
        : total + paddedByteLengthOf(field.value),
    0,
  )
  return entryTableByteLength + outOfLineByteLength
}

/**
 * Writes one IFD — entry count, entries, and the "no next IFD" terminator — into
 * `tiffBlockBytes`, spilling oversized values into the data area that starts at
 * `dataAreaOffset`. Every offset is measured from the start of the TIFF header,
 * which is where `tiffBlockBytes` begins. Returns the first free data offset.
 *
 * Fields must arrive sorted by tag: the TIFF specification requires it, and some
 * readers give up on the directory when they meet a tag out of order.
 */
function writeImageFileDirectory(
  tiffBlockBytes: Uint8Array,
  tiffBlockView: DataView,
  fields: readonly ExifField[],
  directoryOffset: number,
  dataAreaOffset: number,
): number {
  tiffBlockView.setUint16(directoryOffset, fields.length)

  let entryOffset = directoryOffset + 2
  let nextFreeDataOffset = dataAreaOffset

  for (const field of fields) {
    tiffBlockView.setUint16(entryOffset, field.tag)
    tiffBlockView.setUint16(entryOffset + 2, TIFF_TYPE_CODES[field.value.type])
    tiffBlockView.setUint32(entryOffset + 4, componentCountOf(field.value))

    const encodedValue = encodeFieldValue(field.value)
    if (encodedValue.length <= INLINE_VALUE_BYTE_LENGTH) {
      // Short values sit left-aligned in the value slot; the rest stays zero.
      tiffBlockBytes.set(encodedValue, entryOffset + 8)
    } else {
      tiffBlockView.setUint32(entryOffset + 8, nextFreeDataOffset)
      tiffBlockBytes.set(encodedValue, nextFreeDataOffset)
      nextFreeDataOffset += paddedByteLengthOf(field.value)
    }

    entryOffset += IFD_ENTRY_BYTE_LENGTH
  }

  // Offset of the next IFD. Zero means "none": there is no thumbnail to point at.
  tiffBlockView.setUint32(entryOffset, 0)

  return nextFreeDataOffset
}

// --- Value formatting ------------------------------------------------------

/** 1/10000 of an arcsecond is about 3 mm — far finer than the GPS behind it. */
const ARCSECOND_DENOMINATOR = 10_000

const SECONDS_PER_ARCMINUTE = 60

/**
 * Splits a decimal degree into the degrees / minutes / seconds triplet Exif
 * stores. The sign is dropped: the hemisphere lives in its own `*Ref` tag.
 */
function toDegreesMinutesSeconds(decimalDegrees: number): Rational[] {
  const absoluteDegrees = Math.abs(decimalDegrees)
  const wholeDegrees = Math.floor(absoluteDegrees)
  const decimalMinutes = (absoluteDegrees - wholeDegrees) * SECONDS_PER_ARCMINUTE
  let wholeMinutes = Math.floor(decimalMinutes)
  let secondNumerator = Math.round(
    (decimalMinutes - wholeMinutes) * SECONDS_PER_ARCMINUTE * ARCSECOND_DENOMINATOR,
  )

  // Rounding can push the seconds up to a full minute, which no reader expects.
  if (secondNumerator >= SECONDS_PER_ARCMINUTE * ARCSECOND_DENOMINATOR) {
    secondNumerator = 0
    wholeMinutes += 1
  }

  return [
    { numerator: wholeDegrees, denominator: 1 },
    { numerator: wholeMinutes, denominator: 1 },
    { numerator: secondNumerator, denominator: ARCSECOND_DENOMINATOR },
  ]
}

/** Centimetre resolution is plenty for altitude and for the accuracy radius. */
const METER_DENOMINATOR = 100

function toMeterRational(meters: number): Rational {
  return { numerator: Math.round(Math.abs(meters) * METER_DENOMINATOR), denominator: METER_DENOMINATOR }
}

function padWithZeroes(value: number, digits: number): string {
  return String(value).padStart(digits, '0')
}

/** Exif dates look like `2026:08:24 10:19:00` — colons, not dashes, in the date. */
function formatExifDateTime(date: Date): string {
  const calendarDate = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => padWithZeroes(part, index === 0 ? 4 : 2))
    .join(':')
  const clockTime = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(part => padWithZeroes(part, 2))
    .join(':')
  return `${calendarDate} ${clockTime}`
}

/**
 * The offset that turns the local timestamps above back into UTC, as `+02:00`.
 * `getTimezoneOffset` counts minutes *behind* UTC, hence the flipped sign.
 */
function formatUtcOffset(date: Date): string {
  const offsetMinutesBehindUtc = date.getTimezoneOffset()
  const sign = offsetMinutesBehindUtc <= 0 ? '+' : '-'
  const absoluteMinutes = Math.abs(offsetMinutesBehindUtc)
  const hours = padWithZeroes(Math.floor(absoluteMinutes / 60), 2)
  const minutes = padWithZeroes(absoluteMinutes % 60, 2)
  return `${sign}${hours}:${minutes}`
}

/** GPS tags are always UTC, whatever the phone's clock is set to. */
function formatGpsDateStamp(date: Date): string {
  return [
    padWithZeroes(date.getUTCFullYear(), 4),
    padWithZeroes(date.getUTCMonth() + 1, 2),
    padWithZeroes(date.getUTCDate(), 2),
  ].join(':')
}

function toGpsTimeStamp(date: Date): Rational[] {
  return [
    { numerator: date.getUTCHours(), denominator: 1 },
    { numerator: date.getUTCMinutes(), denominator: 1 },
    // Keeping the milliseconds costs nothing and pins the fix to the right second.
    { numerator: date.getUTCSeconds() * 1000 + date.getUTCMilliseconds(), denominator: 1000 },
  ]
}

// --- Tag numbers -----------------------------------------------------------

const IFD0_TAG_ORIENTATION = 0x0112
const IFD0_TAG_SOFTWARE = 0x0131
const IFD0_TAG_DATE_TIME = 0x0132
const IFD0_TAG_EXIF_IFD_POINTER = 0x8769
const IFD0_TAG_GPS_IFD_POINTER = 0x8825

const EXIF_TAG_VERSION = 0x9000
const EXIF_TAG_DATE_TIME_ORIGINAL = 0x9003
const EXIF_TAG_DATE_TIME_DIGITIZED = 0x9004
const EXIF_TAG_OFFSET_TIME_ORIGINAL = 0x9011
const EXIF_TAG_OFFSET_TIME_DIGITIZED = 0x9012

const GPS_TAG_VERSION_ID = 0x0000
const GPS_TAG_LATITUDE_REF = 0x0001
const GPS_TAG_LATITUDE = 0x0002
const GPS_TAG_LONGITUDE_REF = 0x0003
const GPS_TAG_LONGITUDE = 0x0004
const GPS_TAG_ALTITUDE_REF = 0x0005
const GPS_TAG_ALTITUDE = 0x0006
const GPS_TAG_TIME_STAMP = 0x0007
const GPS_TAG_DATE_STAMP = 0x001d
const GPS_TAG_HORIZONTAL_POSITIONING_ERROR = 0x001f

/** The frame is drawn upright onto the canvas, so it never needs rotating. */
const ORIENTATION_TOP_LEFT = 1

/** Exif 2.32, as four ASCII digits in an UNDEFINED field. */
const EXIF_VERSION_BYTES = [0x30, 0x32, 0x33, 0x32]

/** GPS tag version 2.3.0.0, the value every current writer emits. */
const GPS_VERSION_ID_BYTES = [2, 3, 0, 0]

const WRITER_NAME = 'street-recorder'

// --- Directory assembly ----------------------------------------------------

function buildIfd0Fields(exifIfdOffset: number, gpsIfdOffset: number, capturedAt: Date): ExifField[] {
  return [
    { tag: IFD0_TAG_ORIENTATION, value: { type: 'SHORT', numbers: [ORIENTATION_TOP_LEFT] } },
    { tag: IFD0_TAG_SOFTWARE, value: { type: 'ASCII', text: WRITER_NAME } },
    { tag: IFD0_TAG_DATE_TIME, value: { type: 'ASCII', text: formatExifDateTime(capturedAt) } },
    { tag: IFD0_TAG_EXIF_IFD_POINTER, value: { type: 'LONG', numbers: [exifIfdOffset] } },
    { tag: IFD0_TAG_GPS_IFD_POINTER, value: { type: 'LONG', numbers: [gpsIfdOffset] } },
  ]
}

function buildExifIfdFields(capturedAt: Date): ExifField[] {
  const localDateTime = formatExifDateTime(capturedAt)
  const utcOffset = formatUtcOffset(capturedAt)
  return [
    { tag: EXIF_TAG_VERSION, value: { type: 'UNDEFINED', bytes: EXIF_VERSION_BYTES } },
    { tag: EXIF_TAG_DATE_TIME_ORIGINAL, value: { type: 'ASCII', text: localDateTime } },
    { tag: EXIF_TAG_DATE_TIME_DIGITIZED, value: { type: 'ASCII', text: localDateTime } },
    // The timestamps above are the phone's local time; these say which zone that was.
    { tag: EXIF_TAG_OFFSET_TIME_ORIGINAL, value: { type: 'ASCII', text: utcOffset } },
    { tag: EXIF_TAG_OFFSET_TIME_DIGITIZED, value: { type: 'ASCII', text: utcOffset } },
  ]
}

function buildGpsIfdFields(metadata: PhotoExifMetadata): ExifField[] {
  const { latitudeDegrees, longitudeDegrees } = metadata.coordinates
  const fields: ExifField[] = [
    { tag: GPS_TAG_VERSION_ID, value: { type: 'BYTE', bytes: GPS_VERSION_ID_BYTES } },
    {
      tag: GPS_TAG_LATITUDE_REF,
      value: { type: 'ASCII', text: latitudeDegrees >= 0 ? 'N' : 'S' },
    },
    { tag: GPS_TAG_LATITUDE, value: { type: 'RATIONAL', rationals: toDegreesMinutesSeconds(latitudeDegrees) } },
    {
      tag: GPS_TAG_LONGITUDE_REF,
      value: { type: 'ASCII', text: longitudeDegrees >= 0 ? 'E' : 'W' },
    },
    { tag: GPS_TAG_LONGITUDE, value: { type: 'RATIONAL', rationals: toDegreesMinutesSeconds(longitudeDegrees) } },
  ]

  const { altitudeMeters } = metadata
  if (typeof altitudeMeters === 'number' && Number.isFinite(altitudeMeters)) {
    // GPSAltitude is unsigned: below sea level is expressed by the reference byte.
    fields.push(
      { tag: GPS_TAG_ALTITUDE_REF, value: { type: 'BYTE', bytes: [altitudeMeters < 0 ? 1 : 0] } },
      { tag: GPS_TAG_ALTITUDE, value: { type: 'RATIONAL', rationals: [toMeterRational(altitudeMeters)] } },
    )
  }

  fields.push(
    { tag: GPS_TAG_TIME_STAMP, value: { type: 'RATIONAL', rationals: toGpsTimeStamp(metadata.capturedAt) } },
    { tag: GPS_TAG_DATE_STAMP, value: { type: 'ASCII', text: formatGpsDateStamp(metadata.capturedAt) } },
  )

  const { accuracyMeters } = metadata
  if (typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters)) {
    fields.push({
      tag: GPS_TAG_HORIZONTAL_POSITIONING_ERROR,
      value: { type: 'RATIONAL', rationals: [toMeterRational(accuracyMeters)] },
    })
  }

  return fields
}

/**
 * Lays out the whole TIFF block: header, IFD0, the Exif sub-IFD and the GPS IFD,
 * each directory followed by its own oversized values.
 */
function buildTiffBlock(metadata: PhotoExifMetadata): Uint8Array {
  const { capturedAt } = metadata
  const exifIfdFields = buildExifIfdFields(capturedAt)
  const gpsIfdFields = buildGpsIfdFields(metadata)

  // The sub-IFD pointers are offsets that depend on how long IFD0 turns out to
  // be, so IFD0 is measured once with placeholder pointers — its size does not
  // depend on their values — and then rebuilt with the real ones.
  const ifd0Offset = TIFF_HEADER_BYTE_LENGTH
  const ifd0ByteLength = byteLengthOfImageFileDirectory(buildIfd0Fields(0, 0, capturedAt))
  const exifIfdOffset = ifd0Offset + ifd0ByteLength
  const gpsIfdOffset = exifIfdOffset + byteLengthOfImageFileDirectory(exifIfdFields)
  const tiffBlockByteLength = gpsIfdOffset + byteLengthOfImageFileDirectory(gpsIfdFields)

  const tiffBlockBytes = new Uint8Array(tiffBlockByteLength)
  const tiffBlockView = new DataView(tiffBlockBytes.buffer)

  // TIFF header: "MM" for big-endian, the 42 magic number, then IFD0's offset.
  tiffBlockView.setUint16(0, 0x4d4d)
  tiffBlockView.setUint16(2, 0x002a)
  tiffBlockView.setUint32(4, ifd0Offset)

  const directories = [
    { fields: buildIfd0Fields(exifIfdOffset, gpsIfdOffset, capturedAt), offset: ifd0Offset },
    { fields: exifIfdFields, offset: exifIfdOffset },
    { fields: gpsIfdFields, offset: gpsIfdOffset },
  ]

  for (const directory of directories) {
    const entryTableByteLength = 2 + directory.fields.length * IFD_ENTRY_BYTE_LENGTH + 4
    writeImageFileDirectory(
      tiffBlockBytes,
      tiffBlockView,
      directory.fields,
      directory.offset,
      directory.offset + entryTableByteLength,
    )
  }

  return tiffBlockBytes
}

// --- JPEG splicing ---------------------------------------------------------

const JPEG_MARKER_PREFIX = 0xff
const JPEG_MARKER_START_OF_IMAGE = 0xd8
const JPEG_MARKER_APP1 = 0xe1

/** `Exif\0\0`: the identifier that tells APP1 readers this is Exif, not XMP. */
const EXIF_IDENTIFIER_BYTES = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]

/** A JPEG segment's length field is two bytes and counts itself. */
const MAXIMUM_SEGMENT_BYTE_LENGTH = 0xffff

function buildExifApp1Segment(metadata: PhotoExifMetadata): Uint8Array {
  const tiffBlockBytes = buildTiffBlock(metadata)
  const segmentByteLength = 2 + EXIF_IDENTIFIER_BYTES.length + tiffBlockBytes.length

  if (segmentByteLength > MAXIMUM_SEGMENT_BYTE_LENGTH) {
    throw new ExifWriteError('Los metadatos Exif no caben en un segmento JPEG.')
  }

  const segmentBytes = new Uint8Array(2 + segmentByteLength)
  const segmentView = new DataView(segmentBytes.buffer)
  segmentBytes[0] = JPEG_MARKER_PREFIX
  segmentBytes[1] = JPEG_MARKER_APP1
  segmentView.setUint16(2, segmentByteLength)
  segmentBytes.set(EXIF_IDENTIFIER_BYTES, 4)
  segmentBytes.set(tiffBlockBytes, 4 + EXIF_IDENTIFIER_BYTES.length)

  return segmentBytes
}

/**
 * Returns a copy of `jpegBlob` carrying the position, the capture time and the
 * accuracy of the fix as Exif metadata, so the photo stays located even once it
 * is renamed, edited or copied out of the Downloads folder.
 *
 * The segment goes in immediately after the start-of-image marker, where Exif
 * readers expect it. The pixel data is untouched — this is a byte splice, not a
 * re-encode, so nothing is recompressed.
 */
export async function addGpsExifToJpeg(
  jpegBlob: Blob,
  metadata: PhotoExifMetadata,
): Promise<Blob> {
  const originalBytes = new Uint8Array(await jpegBlob.arrayBuffer())

  if (
    originalBytes.length < 2 ||
    originalBytes[0] !== JPEG_MARKER_PREFIX ||
    originalBytes[1] !== JPEG_MARKER_START_OF_IMAGE
  ) {
    throw new ExifWriteError('El fotograma codificado no es un JPEG, así que no se le puede agregar Exif.')
  }

  const app1SegmentBytes = buildExifApp1Segment(metadata)
  const taggedBytes = new Uint8Array(originalBytes.length + app1SegmentBytes.length)
  taggedBytes.set(originalBytes.subarray(0, 2), 0)
  taggedBytes.set(app1SegmentBytes, 2)
  taggedBytes.set(originalBytes.subarray(2), 2 + app1SegmentBytes.length)

  return new Blob([taggedBytes], { type: 'image/jpeg' })
}
