# ANGLE website

The editable source is `ANGLE Landing Page.dc.html`. The public site is generated into `dist/` so editor-only runtime code is not shipped to production.

## Build locally

```bash
npm install
npm run build
python3 -m http.server 8001 --directory dist
```

Open `http://127.0.0.1:8001/`.

## Owner back office

The authenticated owner workspace is built into `dist/account/`. It is a
separate management interface from the POS, but uses the same Supabase project
and organisation data.

Create a local `.env` or configure these variables in Vercel:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

Before publishing `/account/`, deploy Kassa migrations
`088_backoffice_memberships.sql` and `089_sales_report_backoffice.sql`. The
Kassa frontend must keep `MIN_SCHEMA_VERSION = 89`. The release order is:

1. Supabase migrations through `089`.
2. Kassa frontend built against schema `89`.
3. ANGLE website and owner back office.

The Overview screen reads `sales_report`. Migration `089` lets an owner or
manager membership stand in for the POS PIN session; without it the screen
fails with `staff session required` for web users.

## Deploy on Vercel

1. Push this repository to GitHub.
2. Import `fairgvard-sketch/angles` in Vercel.
3. Keep the detected build command `npm run build` and output directory `dist`.
4. Add the public domain under **Project Settings -> Domains**.
5. Copy the exact A and CNAME records shown by Vercel into Wix DNS.

The owner workspace is currently available at `/account/`. It can later move
to `app.<domain>` without changing the shared Supabase identity or organisation
membership model.
