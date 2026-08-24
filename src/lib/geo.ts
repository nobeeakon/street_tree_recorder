/**
 * Geographic helpers: measuring how far the phone has travelled between GPS
 * fixes, and turning a fix into the file name of the photo taken there.
 */

export interface GeographicCoordinates {
  latitudeDegrees: number
  longitudeDegrees: number
}

/** IUGG mean Earth radius, accurate enough for the short hops between GPS fixes. */
const EARTH_MEAN_RADIUS_METERS = 6_371_008.8

/** Six decimals of a degree is ~0.11 m at the equator: finer than any consumer GPS. */
const COORDINATE_DECIMAL_PLACES = 6

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function distanceInMetersBetween(
  origin: GeographicCoordinates,
  destination: GeographicCoordinates,
): number {
  // Haversine rather than a flat-earth approximation: it stays accurate at any
  // latitude and costs nothing at the rate GPS fixes arrive (about 1/second).
  const latitudeDeltaRadians = toRadians(destination.latitudeDegrees - origin.latitudeDegrees)
  const longitudeDeltaRadians = toRadians(destination.longitudeDegrees - origin.longitudeDegrees)
  const originLatitudeRadians = toRadians(origin.latitudeDegrees)
  const destinationLatitudeRadians = toRadians(destination.latitudeDegrees)

  const haversineOfCentralAngle =
    Math.sin(latitudeDeltaRadians / 2) ** 2 +
    Math.cos(originLatitudeRadians) *
      Math.cos(destinationLatitudeRadians) *
      Math.sin(longitudeDeltaRadians / 2) ** 2

  const centralAngleRadians =
    2 *
    Math.atan2(Math.sqrt(haversineOfCentralAngle), Math.sqrt(1 - haversineOfCentralAngle))

  return EARTH_MEAN_RADIUS_METERS * centralAngleRadians
}

/**
 * Formats one coordinate as a zero-padded magnitude plus a hemisphere letter,
 * e.g. `40.416775N`. Avoiding a minus sign keeps the name friendly to shells and
 * to file pickers, and the padding makes names sort in numeric order.
 */
function formatDegreesWithHemisphere(
  degrees: number,
  integerDigits: number,
  positiveHemisphere: string,
  negativeHemisphere: string,
): string {
  const hemisphere = degrees >= 0 ? positiveHemisphere : negativeHemisphere
  const magnitude = Math.abs(degrees).toFixed(COORDINATE_DECIMAL_PLACES)
  const [integerPart, fractionalPart] = magnitude.split('.')
  return `${integerPart.padStart(integerDigits, '0')}.${fractionalPart}${hemisphere}`
}

/** `2026-08-24T10:19:00.123Z` becomes `20260824T101900Z`, which no OS objects to. */
export function formatTimestampForFileName(capturedAt: Date): string {
  return capturedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * Builds the photo file name from the position it was taken at, for example
 * `40.416775N_003.703790W_20260824T101900Z.jpg`. The timestamp suffix keeps two
 * photos taken at the same spot on different runs from overwriting each other.
 */
export function buildPhotoFileName(
  coordinates: GeographicCoordinates,
  capturedAt: Date,
): string {
  const latitude = formatDegreesWithHemisphere(coordinates.latitudeDegrees, 2, 'N', 'S')
  const longitude = formatDegreesWithHemisphere(coordinates.longitudeDegrees, 3, 'E', 'W')
  return `${latitude}_${longitude}_${formatTimestampForFileName(capturedAt)}.jpg`
}
