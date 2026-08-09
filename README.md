# Lux Viridis

A writing and planning workspace for novels — a word processor that also holds
the world bible and the structural plan, in the spirit of Scrivener with a
Reedsy-like writing canvas.

## Getting started

```bash
npm install
npm run db:migrate   # create data/lux.db
npm run db:seed      # demo project: "The Salt Road"
npm run dev          # http://localhost:3000
```

The seed creates a demo account: **writer@example.com** / **password**, with
recovery answers *Fido* and *The Hobbit* so the forgot-password flow can be
tried. On a fresh database with no seed, the first visit offers a setup screen
instead.

`npm run db:reset` wipes the database and reseeds it.

## Writing typography

Eight bundled faces for the writing canvas — literary serifs (Literata, EB
Garamond, Spectral, Lora, Newsreader), a monospaced typewriter face, a clean
sans, and Atkinson Hyperlegible for maximum legibility. Size and line spacing
are adjustable alongside.

Bundled rather than uploadable on purpose: accepting arbitrary font binaries on
a family server means parsing untrusted files and inheriting whatever licence
they carry — a lot of surface for a preference. All eight are open-licensed and
vendored into `src/app/fonts/`, loaded with `next/font/local`, so nothing is
fetched from Google at build time or at runtime — the image builds on a machine
with no outbound network. `npm run fonts:vendor` refreshes the files.

The choice is per reader, stored in `localStorage` — it is a comfort setting
like zoom, and follows the person rather than the manuscript. It applies to the
writing canvas only; the interface stays sans-serif, since that contrast is part
of what makes the canvas feel like a page.

## Publishing the repo

Create an empty repository on GitHub (no README, no `.gitignore` — the tree
already has both), then:

```bash
git remote add origin git@github.com:<you>/lux-viridis.git
git push -u origin main
```

With the `gh` CLI installed, one command does both:

```bash
gh repo create lux-viridis --public --source=. --remote=origin --push
```

Nothing here is sensitive: the database, `.env` and `backups/` are gitignored,
so no writing and no credentials are in the repository. Choose private instead
if you would rather the deployment details not be public.

Deliberately never committed: `data/` (the database holds manuscripts *and*
password hashes), `backups/`, and `.env` (the tunnel token grants the ability to
route traffic to your machine). `.env.example` is committed, since it documents
every variable and contains no values. If you clone this on the OMV box, the
tunnel token is the one thing you must supply by hand.

## Deploying to OMV

Written for a box that already runs Docker and a `cloudflared` service of its
own — the same way calibre-web, Suwayomi and Kavita are already published. This
stack therefore ships **no tunnel container**: it publishes a LAN port, and the
existing tunnel routes to it like any other hostname.

Roughly half an hour, most of it waiting for the image to build.

### 1. Create a folder on the pool

Everything lives together — code, database, backups — so one folder is the
whole deployment:

```bash
# Adjust to your actual pool path; `ls /srv` will show it.
sudo mkdir -p /srv/dev-disk-by-uuid-XXXX/appdata/lux
cd /srv/dev-disk-by-uuid-XXXX/appdata/lux
sudo chown -R $USER:$USER .
```

### 2. Get the code onto the box

```bash
git clone <your-repo-url> app
cd app
```

No repo yet? See **Publishing the repo** below. As an alternative, copy it from
your Mac — the `--exclude`s matter, since `node_modules` is large and
platform-specific, and `data/` is your local database:

```bash
# Run this on the Mac, not on OMV.
rsync -av --exclude node_modules --exclude .next --exclude data \
  ~/Projects/"Lux Viridis"/ omv-user@omv-host:/srv/.../appdata/lux/app/
```

### 3. Configure

```bash
cp .env.example .env
nano .env
```

```
LUX_DATA_DIR=/srv/dev-disk-by-uuid-XXXX/appdata/lux/data
LUX_BACKUP_DIR=/srv/dev-disk-by-uuid-XXXX/appdata/lux/backups
LUX_PORT=3000
```

Pick a `LUX_PORT` nothing else on the box is using — check with
`sudo ss -ltnp | grep :3000`. Whatever you choose is the port you give the
tunnel in the next step.

### 4. Start it

Create the data directories first and hand them to the container's user. The
app runs as uid 1001, and a bind mount keeps the *host's* ownership — so
without this the first write fails with a read-only database error:

```bash
mkdir -p /srv/dev-disk-by-uuid-XXXX/appdata/lux/{data,backups}
sudo chown -R 1001:1001 /srv/dev-disk-by-uuid-XXXX/appdata/lux/data
```

```bash
docker compose up -d --build
```

The first build takes 5–15 minutes, mostly compiling `better-sqlite3`.

Verify it works on the LAN before involving Cloudflare — this splits "the app is
broken" from "the routing is wrong", which otherwise look identical:

```bash
docker compose ps                        # 'running', app also 'healthy'
docker compose logs -f app               # "applying migrations…" then "Ready in ..."
curl -I http://localhost:3000/login      # expect HTTP/1.1 200
```

### 5. Add the hostname to your existing tunnel

Exactly as you did for calibre-web and Kavita. In the **Cloudflare Zero Trust**
dashboard → **Networks → Tunnels**, pick your existing tunnel → **Configure** →
**Public Hostname** → **Add a public hostname**:

| field | value |
|---|---|
| Subdomain | e.g. `write` |
| Domain | your domain |
| Type | `HTTP` |
| URL | same host:port form your other services use, with `LUX_PORT` |

The URL is whatever pattern already works for your other services — if
`books.…` points at `192.168.x.x:8083`, then `write.…` points at the same host
IP with `LUX_PORT`. Copy the working entry rather than inventing a new form.

Why it depends on your setup: a `cloudflared` in Docker cannot reach
`localhost` — inside that container `localhost` is the connector itself. It
works if run with `network_mode: host`, or if you use the host's LAN IP, or if
`cloudflared` is a systemd service on the box rather than a container. Your
existing hostnames prove which case you are in, so mirror them.

`HTTP` is correct even though visitors arrive over HTTPS: Cloudflare terminates
TLS at the edge, and the last hop on your LAN is plain HTTP.

Then visit `https://write.yourdomain.com`. The setup screen creates your
account. **Do not seed the demo data on a deployment** —
`writer@example.com / password` is a development convenience.

### 6. Lock it down (recommended)

The site is on the public internet, and anyone who finds it reaches your login
page. To put Cloudflare's own authentication in front of it, go to **Zero Trust
→ Access → Applications → Add an application → Self-hosted**, select the
hostname, and add a policy allowing only the email addresses that should have
access. Visitors then get a Cloudflare email-code prompt before the app is
reachable at all.

### Updating later

```bash
cd /srv/.../appdata/lux/app
git pull
docker compose up -d --build
```

Migrations run automatically on start. The database is on a bind mount outside
the image, so rebuilds never touch your writing.

### If something goes wrong

First establish which half is broken. If `curl -I http://localhost:3000/login`
on the box returns 200, the app is fine and the problem is routing.

| symptom | cause |
|---|---|
| Cloudflare `502`, `curl` on the box works | Tunnel URL unreachable from the connector — use the form your other hostnames use, not `localhost` |
| `curl` on the box fails too | App not running: `docker compose logs app` |
| Port already allocated on `up` | Something else holds `LUX_PORT`; pick another and update the tunnel |
| Login does nothing, no error | Reached over plain HTTP; set `LUX_INSECURE_COOKIES=1` |
| `EACCES` / read-only database | `LUX_DATA_DIR` not writable by uid 1001: `sudo chown -R 1001:1001 <data dir>` |
| Build fails compiling `better-sqlite3` | Out of memory; stop other containers or add swap |

### How it fits together

Two services, no database container: SQLite is a file on a bind mount, which for
two writers is faster than Postgres and reduces backups to copying one file.

- **app** — multi-stage build. The compiler toolchain that `better-sqlite3`
  needs lives only in the build stage; the runtime image is Next's standalone
  output (~60MB of app on a slim Node 22 base). Runs as a non-root user, and
  publishes `LUX_PORT` on the host so the existing tunnel can reach it.
- **backup** — nightly `sqlite3 .backup` to `LUX_BACKUP_DIR`, keeping 14
  snapshots. `.backup` rather than `cp` because copying a live database can
  capture a torn transaction.

No `cloudflared` service: this assumes the box already runs one for its other
hostnames. A second connector would work but means a second tunnel to maintain,
and the app would then be the only service not published the way the rest are.
If you ever want the stack self-contained, add a `cloudflared` service with its
own token and point its Public Hostname at `app:3000` — inside one Compose
project the service name resolves, which it does not across projects.

Because the port is published on the LAN, the app is also reachable at
`http://<box-ip>:3000` from inside the house, bypassing Cloudflare — convenient,
but it means anyone on your network can reach the login page. Bind it to
localhost (`127.0.0.1:${LUX_PORT}:3000`) if you would rather it were reachable
only through the tunnel; do that only if your `cloudflared` runs on the host
rather than in a container, or it will lose its route to the app.

Migrations run in the entrypoint before the server accepts traffic, so a deploy
that adds a column can never serve requests against the old schema. The runner
applies the journal with plain SQL rather than drizzle — Next inlines
`drizzle-orm` into its server chunks instead of tracing it as a package, so it
is not resolvable from the standalone bundle. Migration identity is the sha256
of each `.sql` file, matching drizzle exactly, so a database migrated in
development is recognised as current inside the container.

**First run**: visit the domain and the setup screen creates your account. Do
not seed the demo data on a deployment — `writer@example.com / password` is a
development convenience.

Session cookies are `Secure` whenever `NODE_ENV=production`, keyed on the
environment rather than the request protocol because the app itself speaks plain
HTTP behind the tunnel. If you ever run it on a LAN with no TLS in front, set
`LUX_INSECURE_COOKIES=1` — otherwise the browser silently discards the cookie
and login appears to do nothing.

## Accounts

Local password login: scrypt hashes (no native build to complicate the eventual
container), signed HTTP-only session cookies, 30-day sessions. The first visit
to an empty database offers a setup screen; once an account exists that route is
closed, so it cannot be used to add users on a public instance.

**Passwords** can be changed from the account menu (current password required),
and recovered by answering two security questions set at signup. There is no
email server on a home instance, so a reset link is not an option.

Security questions are a weak second credential — answers are often guessable —
so they are treated accordingly: both must match, hashed with scrypt exactly
like passwords, and answering them correctly only permits setting a new
password rather than granting a session. Answers are normalised for case,
punctuation, accents and spacing, so recovery does not fail on a stray
apostrophe.

If the questions are forgotten too, `npm run user -- passwd <email>` resets a
password from the server shell. On a family instance, access to the machine is
a reasonable proof of identity. `list`, `add` and `remove` are also available.

On a deployment, use the standalone equivalent — the runtime image is Next's
bundle, which has no `tsx` to run the `.mts` version:

```bash
docker exec -it lux-viridis node scripts/user-standalone.mjs add
docker exec -it lux-viridis node scripts/user-standalone.mjs passwd <email>
```

**This is the only way to create a second account on a deployment**, since the
setup route closes after the first one. `remove` offers to transfer the
account's projects to someone else rather than deleting a person's writing:
`projects.owner_id` has no cascade, so SQLite refuses the delete outright while
any remain.

**Every project belongs to a user, and ownership is enforced in the query, not
checked afterwards.** `src/server/guard.ts` exposes `requireUser`,
`requireProject`, `requireNode`, `requireSnapshot` and `requireLink`; every API
route resolves through one of them, so "forgot to scope it" is not a shape a
route can take. Cross-user access returns 404 rather than 403 — ids cannot be
probed for existence.

## Export

DOCX and PDF, four scopes: the whole book, the selected chapter or scene, the
story bible, and the outline.

Manuscript output follows standard format — 12pt serif, double-spaced, first
line of continuing paragraphs indented, chapters starting a new page, running
head and page numbers. `src/server/export-data.ts` assembles a format-agnostic
block list, and the DOCX and PDF renderers only decide how to draw it, so the
two can never disagree about what the book contains.

PDF uses `@react-pdf/renderer` (~3MB) rather than headless Chromium (~400MB),
which matters on a home server. One trap worth knowing: setting `lineHeight` on
the react-pdf `Page` style silently suppresses every `fixed` element, so running
heads and page numbers vanish. Line spacing therefore lives on the text styles.

## Projects

The app holds many stories. The switcher in the top bar lists them with their
manuscript word counts and creates new ones; a new project starts with a minimal
Manuscript / World / Planning skeleton rather than an empty void.

Every query is scoped by project id — `resolveProject()` takes an explicit id or
falls back to the most recently updated story. The workspace is keyed on project
id so switching remounts it, which is what stops one story's tree from lingering
behind another's title.

## Paragraph style

Manuscript prose uses book-style first-line indents: the first paragraph after a
break is flush left, continuing paragraphs indent. Character sheets, locations,
lore and planning notes use spaced blocks instead — the indent convention
belongs to prose, and in a set of notes an indent appearing the moment you press
Enter reads as a glitch rather than as typesetting.

The class is toggled on the live editor DOM node (`indent-prose`) because
TipTap's `editorProps` are fixed when the editor is constructed and cannot react
to the open document changing type. Export always uses proper manuscript indents
regardless of what the canvas shows.

## Where new items go

Creating something puts it somewhere sensible rather than at the bottom of the
section.

- **World** entries go to the folder for their kind — a new character lands in
  Characters even if a location is currently selected, because entries of a
  type belong with their own kind.
- **Manuscript and planning** follow the selection instead: creating a scene
  while a chapter is open puts it in *that* chapter. The rule is "put it where
  I'm looking", walking up from the selection to the nearest thing that can
  legitimately contain the new type (`CONTAINER_FOR` in `binder.tsx`).

Dragging onto an empty container nests inside it — the only way to get a first
child in. Every other drop makes the node a sibling at the target's own slot,
which is what allows reordering; an earlier version always appended to the end,
so chapters could not be reordered at all.

## Word counts

One rule governs every total: **the book is the manuscript**. Character sheets,
lore and planning cards hold real writing, but counting them toward a draft's
length would tell a writer they had written thousands of words they cannot read
in order. They are reported separately as "notes", never merged and never
hidden.

Rollups are computed in `src/lib/stats.ts`:

- Top bar shows manuscript words; hovering gives pages, chapter and scene
  counts, longest and shortest chapter, and the separate notes total.
- Selecting an act or chapter shows its subtree total, how many children make it
  up, and the average among them.
- A word target renders a progress bar and a "N to go" line.

Page estimates use 250 words/page and are hidden below one page, where the
figure would be noise.

## Mentions and backlinks

Typing `@` in any document opens a picker of characters, locations and lore.
Choosing one inserts a mention that carries the target's id, and opening that
entity shows **every place it appears, in manuscript reading order**, with first
and last appearance called out. Mentions are clickable in both directions.

This is what the single-node table buys: a character sheet and a scene are the
same kind of object, so linking them is one row rather than a subsystem.

Mentions are *derived state* — the document is the source of truth. On every
save the mentions found in the body are diffed against the stored rows, so
deleting an `@mention` from the prose removes the backlink too, and a stale id
in pasted text never creates a dangling link. Trashed sources drop out of
backlinks and return on restore.

One subtlety worth knowing: a mention is an atom whose visible text lives in
`attrs`, not in child text nodes. `docToPlainText` reads that label explicitly —
otherwise mentioned names would silently vanish from word counts and search
while still being plainly visible on the page.

## Trash and version history

Two different safety nets, deliberately kept separate.

Every deletion asks first, showing what is about to go — "2 items inside · 79
words" — because a chapter takes its scenes with it and the writer should know
that before confirming, not after. Escape and Cancel both back out.

**Trash** answers "I deleted this." Deleting stamps `deletedAt` across the node
*and its whole subtree* and moves the top node to the `trash` root, remembering
where it came from. The trash view lists one entry per deletion — a chapter
shows as "1 item inside", not as three fragments — and restoring returns the
whole subtree to its original parent. If that parent is itself gone, the node
returns to the top of its section rather than failing.

**History** answers "it was better an hour ago." Snapshots are captured
automatically when a document moves substantially (≥120 words) or changes after
a long gap — and always when a document loses more than half its text, which is
the case that matters most. Manual snapshots are explicit and never pruned;
auto ones are capped at 25 per document. Restoring writes a `pre-restore`
snapshot first, so a restore is itself undoable.

The editor is keyed on `nodeId:docVersion` so a restore remounts it. Without
that the database would update while the editor kept showing the old text.

## Beat canvases

Selecting a beat opens a mind map instead of a text editor. Cards are dragged to
position and connected with arrows, so a beat can express *why* one thing leads
to another — the causal texture that a linear list of beats flattens away.

Cards are ordinary nodes (`type: 'card'`) parented to their beat, so they are
searchable and reuse the whole node API; their canvas position lives in
`meta.x` / `meta.y` rather than in the tree's `idx`. Connections are `edge` rows
in `links`, which is the graph layer — many-to-many and cycle-tolerant, unlike
the strict single-parent hierarchy in `nodes`.

Interactions: double-click empty space to add, drag a card to move, drag the
handle on a card's right edge onto another card to connect, click a wire then
Delete (or double-click it) to remove, scroll to pan, ⌘/Ctrl+scroll to zoom.

## The core idea

Everything in the binder — an act, a chapter, a scene, a character sheet, a
location, a lore entry, a story beat — is a row in **one** `nodes` table,
distinguished only by `type`. Every view is a query over that single tree, which
is why the binder, the act plan and the manuscript order never need syncing.

Two consequences worth knowing:

- **Ordering is fractional.** A node's position is a string that sorts
  lexicographically between its neighbours (`a0`, `a0V`, `a1`). Moving chapter 40
  to the top of a 90-chapter book rewrites one row, not ninety.
- **Derived values are server-authoritative.** `plain` and `wordCount` are
  recomputed from the document body on every save, so the client can never write
  a word count that disagrees with the prose.

## Layout

```
src/
  db/
    schema.ts      one node table + links, snapshots, projects
    index.ts       driver (SQLite now, Postgres later)
    seed.ts        demo novel
  lib/
    ordering.ts    fractional index helpers
    doc.ts         ProseMirror -> plain text, word count
    api.ts         client fetchers + tree assembly
  server/
    nodes.ts       create / update / move / delete, cycle guard
  server/
    search.ts      the only dialect-aware query in the app
  components/
    rail.tsx       activity rail: Manuscript / World / Planning / Search
    binder.tsx     drag-and-drop tree for one section
    search-panel.tsx  debounced project-wide search
    editor.tsx     TipTap canvas + debounced autosave
    inspector.tsx  type-aware metadata panel
    workspace.tsx  shell wiring them together
```

## Navigation

A two-column sidebar. The narrow **rail** picks a mode; the wider column shows
that mode's tree. Clicking the active icon collapses the tree column and leaves
the rail, which gives the canvas full width without losing your place.

Splitting the sections this way is structural, not cosmetic: when all three
trees shared one scrolling column, a full-length manuscript pushed World and
Planning off-screen. Each section now owns the full column height.

## Notes on the data layer

The schema deliberately sticks to the SQLite/Postgres common subset — JSON is
stored as text, and nothing uses an SQLite-only feature. Moving to Postgres on
the OMV box means swapping the driver in `src/db/index.ts`, changing the dialect
in `drizzle.config.ts`, and regenerating migrations; the queries are unchanged.

Full-text search is the one place the dialects genuinely diverge (FTS5 vs
`tsvector`), so it lives entirely in `src/server/search.ts`. The current
implementation is a case-insensitive `LIKE` over the `plain` projection, title
and synopsis — no stemming or relevance ranking beyond field priority, but it
needs no extra tables and stays correct as prose is edited. Swapping it for
`tsvector` on Postgres means changing that one file.

## What works today

Activity rail with four modes; binder tree over all node types with
drag-to-reorder and cross-container moves; project-wide search over prose,
synopses and titles, with match highlighting and jump-to-result; TipTap editor
with debounced autosave and live word counts; type-aware inspector with
synopsis, status and per-type fields; word targets with progress; light and dark
themes; typewriter mode.

Moves are validated server-side — a node cannot be dropped into its own subtree,
and a rejected move triggers a resync so the UI cannot drift from the database.

## Not built yet

Corkboard and outliner views. Canvas edges have a
`label` column that no UI sets yet, and beat cards cannot yet mention entities
(the `links` plumbing is there — it is a picker away). Deployment is local-only
for now — no Dockerfile yet.

Note: `npm run db:reset` deletes the database file while a running dev server
still holds a handle to it. Restart the dev server after a reset or it will keep
serving the old data.
