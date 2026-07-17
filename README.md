# MarcinBrukMaps

A simple offline-ready map app scaffold for iPhone-style use in a browser.

## Run locally

Open the app in a browser:

- Open [index.html](index.html)

For a closer mobile experience, use a simple local server:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## What it includes

- Offline-capable PWA shell with service worker cache
- Tap-to-place markers stored in local storage
- A simple iPhone-friendly layout with safe-area spacing
- A bundled SVG map asset for offline use

## Next steps for a real iPhone app

- Add real map tiles or offline MBTiles data
- Add geolocation and route tracking
- Wrap this in an Xcode/WebView project for App Store distribution