# Pulse Live Polls

Pulse is a focused live open-question app: a presenter creates one room and one prompt, shares the room code or link, and participants submit anonymous text answers while the presenter watches the response wall update in real time.

## Stack

- Next.js App Router
- React
- Supabase Auth and Supabase Postgres
- Vercel
- Tailwind CSS

## Local setup

Prerequisites: Node.js `>=22.13.0`.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_SITE_URL` in `.env.local`. Run [`supabase/schema.sql`](supabase/schema.sql) once in the Supabase SQL Editor. The local server is available at `http://localhost:3000`; the dev script also binds to the host machine’s network interfaces.

Presenter accounts are managed by Supabase Auth. Audience members remain anonymous. Rooms, questions, responses, and presenter ownership are stored in Supabase Postgres.

## Exporting results

Use **Export results** in the presenter view or completed session report to download a CSV containing the room, question, participant name, answer, and submission time. No Google Sheet connection is required.

## Vercel deployment

1. Push this repository to GitHub and import it into Vercel.
2. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_SITE_URL` as Production, Preview, and Development variables.
3. Keep the default Next.js build settings and deploy.

Vercel uses `npm install` and `next build`. Supabase Auth’s Site URL and redirect URLs must include the deployed Vercel URL.

## Useful commands

- `npm run dev`: start local development
- `npm run build`: create a production build
- `npm start`: serve the production build locally
- `npm test`: run the build and deployment-safety checks
- `npm run lint`: run ESLint
