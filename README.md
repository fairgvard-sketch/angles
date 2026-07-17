# ANGLE website

The editable source is `ANGLE Landing Page.dc.html`. The public site is generated into `dist/` so editor-only runtime code is not shipped to production.

## Build locally

```bash
npm run build
python3 -m http.server 8001 --directory dist
```

Open `http://127.0.0.1:8001/`.

## Deploy on Vercel

1. Push this repository to GitHub.
2. Import `fairgvard-sketch/angles` in Vercel.
3. Keep the detected build command `npm run build` and output directory `dist`.
4. Add the public domain under **Project Settings -> Domains**.
5. Copy the exact A and CNAME records shown by Vercel into Wix DNS.

The future customer dashboard should be deployed separately at `app.<domain>` so the public website and authenticated product can evolve independently.
