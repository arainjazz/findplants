# Plantspedia — Project Guide for Claude

> **Read `.claude/STATE.md` FIRST every session.** It is the single source of
> truth for what's done, what's in progress, and the next concrete step. Update
> it before you end a turn and before any long/risky operation — so an
> interrupted session (disconnect, context limit, closed window) loses nothing.

## What this is
Plantspedia (https://plantspedia.club , www.plantspedia.club) — a bilingual
(中文 / English) plant encyclopedia + community site centred on Ordos / Inner
Mongolia flora. Users submit plant **observations / drafts** (photo + location);
admins curate them into published **plant pages**; plus a **blog**, **catalogs**,
and **tags**.

## Stack (verified from config)
- **Frontend:** TanStack Start + React 19, file-based routes in `src/routes/`,
  Vite 7, TailwindCSS v4, shadcn/ui (Radix), TipTap rich-text editor,
  react-hook-form + zod. Scaffolded with Lovable (`@lovable.dev/...`).
- **Backend:** Supabase (Postgres + Auth + Storage, RLS). URL in `wrangler.jsonc`
  (`SUPABASE_URL`).
- **AI:** Gemini (`AI_MODEL = gemini-2.5-flash`) for identify / plant content.
- **Photos:** `exifr` reads EXIF (incl. GPS) from uploaded images.
- **Hosting:** Cloudflare Workers via Wrangler → custom domain plantspedia.club.
- **Package manager:** Bun (`bun.lock`).

## Commands
| Task       | Command                              |
|------------|--------------------------------------|
| Dev server | `npm run dev`  (port **8080**) / `bun dev` |
| Typecheck  | `./node_modules/.bin/tsc --noEmit`   |
| Lint       | `npm run lint`                       |
| Build      | `npm run build` (vite → `dist/`)     |
| Deploy     | `npm run build && ./node_modules/.bin/wrangler deploy` (→ Cloudflare Workers, custom domains plantspedia.club / www) — ⚠️ confirm intent first; the build packages the **whole working tree**, incl. uncommitted changes |
| Publish 1 plant page | `python3 publish.py --html <file>` — uploads a single plant HTML entry to Supabase (NOT an app deploy) |

## Routes / features (`src/routes/`)
- **Public:** `index`, `explore`, `identify`, `search`, `plants.index`,
  `plants.$slug`, `blog.index`, `blog.$slug`, `tags.$slug`, `login`, `signup`,
  `profile`.
- **Drafts / edits:** `drafts.$id`, `editors.$id`, `edits`.
- **Admin** (`_authenticated/admin.*`): `index`, `applications`, `batch-new`,
  `new`, `edit.$id`, `blog.new`, `blog.edit.$id`, `catalogs.$id`,
  `catalogs.new`, `tags`.

## Data model (partial — verify against `combined_schema.sql` / `all_migrations.sql`)
- `plant_drafts`: `capture_place` (free-text Chinese geo string, **inconsistent
  granularity** — from "鄂尔多斯市" to a full street address), `creator_label`
  (访客 guest / 管理员 admin), `created_by`, …
- Also: plants, blog, catalogs, tags, observations (see `scratch/*.sql`).

## Conventions
- `scratch/` = throwaway probes (python Supabase checks, SQL). Don't ship from it.
- Verify a change with **`tsc --noEmit`** then **preview in browser** before
  calling it done.
- Secrets live in `.env` — never read, print, or commit it. The service-role key
  exists only there.

## How to work here (avoid the token-burn trap)
This project has repeatedly stalled from **API connection drops (ECONNRESET)** and
**over-retrying one hard problem**. To prevent that:
1. **Ship small.** One independently-verifiable fix at a time; checkpoint after
   each. Do the quick, high-certainty fixes first.
2. **Cap retries.** If a step fails ~2× (network, a stubborn bug, an uncooperative
   tool), STOP. Write it to `.claude/STATE.md → Blockers` and move to the next
   quick win. Do not loop.
3. **Persist state often.** Update `.claude/STATE.md` after each fix and before any
   long/risky op, so a disconnect costs nothing.
