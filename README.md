# Pulse Live Polls

Pulse is a focused live open-question app: a presenter creates one room and one prompt, shares the room code or link, and participants submit anonymous text answers while the presenter watches the response wall update in real time.

## Stack

- Next.js App Router
- React
- Vercel-compatible Node.js route handler
- Postgres through Neon’s serverless driver
- Tailwind CSS

## Local setup

Prerequisites: Node.js `>=22.13.0` and a Postgres database.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Set `DATABASE_URL` in `.env.local` to a Neon, Vercel Postgres/Neon, Supabase, or other Postgres connection string. Set `NEXT_PUBLIC_SITE_URL` to the public site URL in production. The poll tables are created automatically on the first API request. Each room accepts one open-ended question with responses up to 500 characters.

The local server is available at `http://localhost:3000`. The dev script binds to all interfaces, so another device on the same network can use the host machine’s IP address.

## Optional Google Sheets backend

For a small local session, the one-question backend can use Google Sheets instead of Postgres:

1. Create a Google Sheet and copy its ID from the URL.
2. Open **Extensions → Apps Script**, create a script, and paste `google-apps-script/Code.gs` into it.
3. Replace `spreadsheetId` and `sharedSecret` at the top of `Code.gs`.
4. Run `setup()` once and approve the Google Sheets permissions.
5. Deploy it from **Deploy → New deployment → Web app**, executing as you and allowing access to anyone with the link.
6. Add the deployment URL and the same secret to `.env.local`:

```env
GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
GOOGLE_APPS_SCRIPT_SECRET=the-same-secret-used-in-Code.gs
```

Restart `npm run dev`. When `GOOGLE_APPS_SCRIPT_URL` is present, the Next.js API proxies room and response requests to the Apps Script backend. The sheet will contain `Rooms` and `Responses` tabs. Keep the shared secret private; anyone with the deployment URL and secret can write responses.

## Vercel deployment

1. Push this repository to GitHub.
2. Import the repository into Vercel.
3. Keep the detected Next.js framework and default build settings.
4. Add `DATABASE_URL` as a Production, Preview, and Development environment variable.
5. Add `NEXT_PUBLIC_SITE_URL` with the deployment URL or your custom domain.
6. Deploy.

Vercel should use:

- Install command: `npm install`
- Build command: `next build` (or `npm run build`)
- Output directory: `.next`

Do not use the old Cloudflare D1 binding. The API now reads `DATABASE_URL` and uses standard Postgres SQL through `@neondatabase/serverless`.

## Useful commands

- `npm run dev`: start local development
- `npm run build`: create a production build
- `npm start`: serve the production build locally
- `npm test`: run the build and deployment-safety checks
- `npm run lint`: run ESLint
