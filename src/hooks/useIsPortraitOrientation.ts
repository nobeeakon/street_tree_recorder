import { useSyncExternalStore } from 'react'

/**
 * Tracks whether the device is held upright, so the UI can nudge the user to
 * turn it sideways. Photos are framed better in landscape: a street fits across
 * the wide edge, and the saved JPEG keeps the sensor's native aspect ratio.
 */

const PORTRAIT_MEDIA_QUERY = '(orientation: portrait)'

function subscribeToOrientationChanges(notifyReactOfChange: () => void): () => void {
  const portraitMediaQueryList = window.matchMedia(PORTRAIT_MEDIA_QUERY)
  portraitMediaQueryList.addEventListener('change', notifyReactOfChange)
  return () => portraitMediaQueryList.removeEventListener('change', notifyReactOfChange)
}

function getIsPortraitSnapshot(): boolean {
  return window.matchMedia(PORTRAIT_MEDIA_QUERY).matches
}

export function useIsPortraitOrientation(): boolean {
  // No server snapshot: this app only ever runs in a browser.
  return useSyncExternalStore(subscribeToOrientationChanges, getIsPortraitSnapshot)
}
