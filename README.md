# Street Recorder

One survey, two halves:

- **Recorder** (`#/grabar`) — takes a photo through the rear camera at a set
  distance travelled and saves each one to the device, named after the
  coordinates where it was taken and geotagged with them in EXIF. For a
  **phone**.
- **Labeller** (`#/etiquetar`) — loads those photos back, tags each one from a
  persistent label catalogue and exports coordinates plus labels as CSV. For a
  **computer**.

The home page (`#/`) is neither: it says what the app is and offers the two as a
pair of cards. The address gets opened cold, on a phone or on a laptop, and only
the reader knows which half they are there for.

Routing is React Router in hash mode: GitHub Pages is a static host with no
rewrite rule, so `/etiquetar` would come back as a 404 while `#/etiquetar` is
never sent to the server at all. The route table is in
[src/App.tsx](src/App.tsx) and the paths themselves in
[src/routePaths.ts](src/routePaths.ts), so a link and its route cannot drift
apart. The labelling page is loaded as a separate chunk, which keeps the EXIF
reader, the gallery and the store off the phone that only records.

Proof of concept, targeting **Chrome**.

The interface is light only. The palette is a handful of CSS variables in
[src/index.css](src/index.css), and `color-scheme: light` there keeps a phone in
dark mode from inverting the form controls and scrollbars. Two of those
variables exist because a colour's opposite is not always the page text:
`--color-on-accent` is what sits on an accent fill, and `--color-on-scrim` what
sits on the dark veils over the camera feed and the photo stage — those stay
dark in a light interface because what is behind them is picture, not page.

## Running it

```bash
npm install
npm run dev
```

The dev server binds to the LAN over HTTPS (self-signed). Open the `https://…`
address Vite prints on the phone and accept the certificate warning once.

HTTPS is not optional: `getUserMedia` and `geolocation` only work in a secure
context, and that means the phone will refuse a plain `http://192.168.x.x` URL.
The labelling page has no such requirement beyond hashing photos, which also
wants a secure context.

## Recording, on the phone

The interface is in Mexican Spanish — *celular*, *computadora*, *agregar*, and
`es-MX` for dates and numbers. Code, comments and this document are in English.

The distance between photos is picked in the UI — **10, 25, 50, 100 or 200 m**,
25 m by default. Changing it mid-walk takes effect at the next GPS fix; there is
no need to stop recording. The choices live in `CAPTURE_INTERVAL_OPTIONS_METERS`
in [src/pages/RecorderPage.tsx](src/pages/RecorderPage.tsx).

1. Allow the camera and location permissions.
2. Pick the distance between photos, then tap **Empezar grabación**.
3. Chrome asks **"Allow multiple downloads?"** on the second photo. Allow it —
   after that every capture saves silently.
4. Walk. Photos land in the Downloads folder as
   `40.416775N_003.703790W_20260824T101900Z.jpg`, each one carrying its position
   in EXIF as well as in its name.

## Labelling, on the computer

Press **Etiquetar fotos** on the home page, or open `#/etiquetar` directly. Copy
the photos off the phone first; the page reads them from the local disk and
uploads nothing.

1. **Agregar fotos**, or drag a folder's worth onto the page. Each file is read
   once: its coordinates and capture time come out of the EXIF the recorder
   wrote, and its bytes are hashed into the identity its labels hang off.
2. Create the labels you need in the right-hand panel. They are saved in the
   browser, so they are there the next day.
3. Tag the photo on screen by clicking a chip or pressing its number key. **←**
   and **→** step through the gallery; the strip along the bottom shows every
   photo with a coloured dot per label, so an unlabelled stretch is obvious.
4. **Exportar CSV** downloads one row per photo — coordinates, capture time,
   label names and ids. It exports everything on record, not only what is on
   screen.
5. **Borrar todos los datos** empties the browser's copy: labels, annotations,
   the lot. It asks first, and it cannot be undone.

### What persists, and what does not

| | Survives a reload | Survives clearing the data |
| --- | --- | --- |
| Labels | yes | no |
| A photo's labels + coordinates | yes | no |
| The photos in the gallery | no | — |

The gallery is emptied by a refresh because a browser cannot hand a `File` back
after one; the photos themselves stay where they always were, on disk.

**Re-analysing a picture** is therefore just a matter of loading the file again:
the key is a hash of its contents, so the same picture is recognised after being
renamed, copied or downloaded twice, and it comes back with its labels already
applied. Annotations reference labels by id, never by name, so renaming a label
updates every photo ever tagged with it — including ones from earlier sessions.

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
| [src/App.tsx](src/App.tsx) | The route table, in hash mode |
| [src/routePaths.ts](src/routePaths.ts) | The paths every link and route share |
| [src/lib/geo.ts](src/lib/geo.ts) | Haversine distance between fixes; coordinate → file name |
| [src/lib/capture.ts](src/lib/capture.ts) | Video frame → JPEG blob → download |
| [src/lib/exif.ts](src/lib/exif.ts) | Writes the GPS fix into the JPEG as an EXIF APP1 segment |
| [src/hooks/useCamera.ts](src/hooks/useCamera.ts) | Rear-camera stream lifecycle |
| [src/hooks/useDistanceRecorder.ts](src/hooks/useDistanceRecorder.ts) | Watches GPS, decides when a photo is due |
| [src/pages/RecorderPage.tsx](src/pages/RecorderPage.tsx) | Viewfinder, counter, interval selector, start/stop |
| [src/pages/HomePage.tsx](src/pages/HomePage.tsx) | What the app is and the way into each half; no state of its own |

And, for the labelling half:

| File | Responsibility |
| --- | --- |
| [src/lib/exifReader.ts](src/lib/exifReader.ts) | Reads the GPS fix back out of a JPEG, either byte order |
| [src/lib/photoLibrary.ts](src/lib/photoLibrary.ts) | File → hashed identity + EXIF metadata + blob URL |
| [src/lib/annotationStore.ts](src/lib/annotationStore.ts) | The schema, its validation and the `localStorage` round trip |
| [src/lib/annotationCsv.ts](src/lib/annotationCsv.ts) | The whole database → RFC 4180 CSV |
| [src/hooks/useAnnotationStore.ts](src/hooks/useAnnotationStore.ts) | Labels and annotations as React state, persisted on every change |
| [src/hooks/usePhotoGallery.ts](src/hooks/usePhotoGallery.ts) | The session's photos, the cursor, and the blob URLs |
| [src/pages/LabelerPage.tsx](src/pages/LabelerPage.tsx) | Toolbar, keyboard shortcuts, drag and drop |

A photo is taken when the distance from the **last captured position** reaches
the selected interval — the anchor only moves once a photo has actually been
saved, so a failed capture retries at the next fix instead of skipping a whole
interval.

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
- Nothing is stored by the recorder; if a download is refused, that photo is lost.
- **The labelling data lives in one browser profile.** `localStorage` is not
  shared between browsers, machines or private windows, and clearing site data
  from the browser's own settings takes it with it. The CSV is the backup.
- **A photo with no EXIF position can still be labelled**, it just exports with
  empty coordinate cells. Photos edited or re-encoded by another tool usually
  lose both their position and their identity, and come back as new photos.

## Geotagging

`canvas.toBlob()` returns a JPEG with no metadata at all, so
[src/lib/exif.ts](src/lib/exif.ts) builds the EXIF APP1 segment itself and
splices it in after the start-of-image marker. The pixel data is never touched,
so nothing is recompressed. There is no dependency for this: the writer covers
only the tags the app has values for.

| Tag | Value |
| --- | --- |
| `GPSLatitude` / `GPSLongitude` (+ refs) | The fix, as degrees/minutes/seconds to 1/10000″ (≈ 3 mm) |
| `GPSAltitude` / `GPSAltitudeRef` | Metres above sea level, when the device reports one |
| `GPSTimeStamp` / `GPSDateStamp` | UTC, to the millisecond |
| `GPSHPositioningError` | The accuracy radius the browser reported for the fix |
| `DateTimeOriginal` / `OffsetTimeOriginal` | Local capture time plus its UTC offset |

That is what a map, a photo library or `exiftool` reads to place the photo, and
unlike the file name it survives renaming, editing and re-uploading.

Reading it back is [src/lib/exifReader.ts](src/lib/exifReader.ts), which the
labelling page uses to recover the coordinates of a photo dropped on it. The
reader is the tolerant half of the pair: it walks the JPEG segments of any
camera's file, accepts either byte order, prefers the UTC `GPSTimeStamp` over
`DateTimeOriginal` when both are present, and treats a missing position as an
ordinary outcome rather than an error.
