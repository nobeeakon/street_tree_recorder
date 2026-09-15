/**
 * The paths of every page, in one place, so a link and its route cannot drift
 * apart. Kept separate from the route table in `App.tsx` because the pages link
 * to each other: importing them from the table would be a cycle.
 */
export const APP_ROUTE_PATHS = {
  recorder: '/',
  labeler: '/etiquetar',
  about: '/acerca-de',
} as const
