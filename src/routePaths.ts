/**
 * The paths of every page, in one place, so a link and its route cannot drift
 * apart. Kept separate from the route table in `App.tsx` because the pages link
 * to each other: importing them from the table would be a cycle.
 *
 * The home page is the explanation, not the recorder: the address gets opened
 * cold — on a phone, on a laptop, from a link someone was sent — and only the
 * reader knows which half of the survey they are there for.
 */
export const APP_ROUTE_PATHS = {
  home: '/',
  recorder: '/grabar',
  labeler: '/etiquetar',
} as const
