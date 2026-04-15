# i6MM Platform Admin

Track-Chef administration portal — super-admin tools for managing tenants, users, and platform-wide operations.    

## Setup

```bash
npm install
cp .env.example .env.local
# fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_ADMIN_FUNCTION_URL
npm run dev
```

## Required environment variables

- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key
- `VITE_SUPABASE_ADMIN_FUNCTION_URL` — Edge function URL for admin operations

These **must** be set in the deployment platform's environment variables, otherwise the app will fail to initialize the Supabase client.

## Build & deploy

```bash
npm run build       # produces dist/
npm run typecheck   # optional strict TS check
```

Output goes to `dist/`. The `public/_redirects` file enables SPA routing on Netlify / Cloudflare Pages.

## Access

Authorised personnel only — login restricted to users with `is_super_admin = true` in the `profiles` table.
