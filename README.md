# Street Recorder

Takes a photo through the rear camera every 100 metres travelled and saves each
one to the device, named after the coordinates where it was taken.

The interval is fixed in `CAPTURE_INTERVAL_METERS` in
[src/App.tsx](src/App.tsx); there is no control for it in the UI.

Proof of concept, targeting **Chrome on a phone**.

## Running it

```bash
npm install
npm run dev
```

The dev server binds to the LAN over HTTPS (self-signed). Open the `https://…`
address Vite prints on the phone and accept the certificate warning once.

HTTPS is not optional: `getUserMedia` and `geolocation` only work in a secure
context, and that means the phone will refuse a plain `http://192.168.x.x` URL.

## Using it

The interface is in Spanish; code, comments and this document are in English.

1. Allow the camera and location permissions.
2. **Hold the phone in landscape.** Photos are meant to be taken with the phone
   sideways, so the street fits across the wide edge. The app shows a reminder
   while the phone is upright — it is a hint, not a lock: captures still happen
   in portrait, they just frame badly.
3. Tap **Empezar grabación**.
4. Chrome asks **"Allow multiple downloads?"** on the second photo. Allow it —
   after that every capture saves silently.
5. Walk. Photos land in the Downloads folder as
   `40.416775N_003.703790W_20260824T101900Z.jpg`.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml):

<https://nobeeakon.github.io/street_tree_recorder/>

**One-time setup:** in the repository, go to _Settings → Pages → Build and
deployment_ and set **Source** to **GitHub Actions**. Without that the workflow
runs but the deploy step fails.

The workflow lints and type-checks before publishing, so a broken build never
reaches Pages. `base: './'` in [vite.config.ts](vite.config.ts) keeps asset URLs
relative, which is what makes the app work from the `/street_tree_recorder/`
sub-path Pages serves it from.

Pages is HTTPS, so the camera and GPS both work on the deployed site — unlike a
plain `http://` LAN address.

## How it works

| File | Responsibility |
| --- | --- |
| [src/lib/geo.ts](src/lib/geo.ts) | Haversine distance between fixes; coordinate → file name |
| [src/lib/capture.ts](src/lib/capture.ts) | Video frame → JPEG blob → download |
| [src/hooks/useCamera.ts](src/hooks/useCamera.ts) | Rear-camera stream lifecycle |
| [src/hooks/useDistanceRecorder.ts](src/hooks/useDistanceRecorder.ts) | Watches GPS, decides when a photo is due |
| [src/App.tsx](src/App.tsx) | Viewfinder, counter, start/stop |

A photo is taken when the distance from the **last captured position** reaches
the interval — the anchor only moves once a photo has actually been saved, so a
failed capture retries at the next fix instead of skipping 100 m.

Two guards keep the counter honest:

- Fixes with accuracy worse than **25 m** are ignored. A weak fix wanders far
  enough while standing still to fake a capture.
- Fixes arriving while an encode is in flight are dropped, so one spot cannot
  produce a burst of photos.

## Known limitations

- **The app must stay in the foreground with the screen on.** It requests a
  Screen Wake Lock, but a backgrounded tab has its camera and timers suspended,
  so the phone cannot go in your pocket.
- **iOS Safari confirms every download individually.** There is no API to
  suppress that. Real background recording on iOS needs a native wrapper.
- Photos carry no EXIF GPS tags — the coordinates live in the file name only.
- Nothing is stored in the app; if a download is refused, that photo is lost.
