# MarcinBrukMaps

A field-mapping progressive web app built for mobile use on iPhone-style browsers.

## Run locally

Open the app in a browser or use a simple local server:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## What it includes

- Leaflet map with live OpenStreetMap tiles
- GPS location support with a current-position marker and accuracy circle
- Building outlines loaded from OpenStreetMap through the Overpass API
- Clickable buildings with status, notes, save, and reset controls
- Local saving in `localStorage` for selected building status and notes
- A PWA shell that caches local app files for installability

## Notes

- Map tiles are loaded online from OpenStreetMap at runtime.
- Building outlines are fetched from the Overpass API only when the visible map area is small enough and zoomed to 16 or higher.
- Selected building statuses and notes are stored locally on the device.
- Full offline map tile support is not implemented yet and is a future stage.

## Limitations

- The service worker caches only the local app shell files.
- Remote map tiles and Overpass requests still require an internet connection.
- Overpass requests are debounced and limited to smaller visible areas to avoid overload.
