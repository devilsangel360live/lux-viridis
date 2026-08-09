# Deploying Lux Viridis on OMV with Portainer

Step by step, for a box that already runs Docker, Portainer, and `cloudflared`
as its own service — the setup already publishing calibre-web, Suwayomi and
Kavita.

This stack ships **no tunnel container**. It publishes a LAN port and your
existing tunnel routes to it, exactly like your other hostnames.

Budget about half an hour. Most of that is the first image build, which is slow
because `better-sqlite3` compiles from source.

---

## Before you start

You need:

- **The code somewhere Portainer can reach it** — a git repository is easiest,
  and lets you redeploy later by clicking a button. See
  [Publishing the repo](README.md#publishing-the-repo). The alternative
  (uploading the compose file) is covered in
  [Appendix B](#appendix-b--without-a-git-repository).
- **A free port** on the box. Check over SSH:

  ```bash
  sudo ss -ltnp | grep -E ':(3000|8080)'
  ```

  Anything printed means that port is taken. Pick one that prints nothing —
  this guide assumes `3000`.

- **SSH access.** Two steps genuinely need a shell; Portainer cannot set
  filesystem ownership.

---

## Step 1 — Create the folders on your pool

Over SSH. The database and backups live on the pool, not inside the container,
so they survive every rebuild.

```bash
# Find your pool path first — the UUID is specific to your disk.
ls /srv
```

You will see something like `dev-disk-by-uuid-a1b2c3d4-…`. Use it below:

```bash
POOL=/srv/dev-disk-by-uuid-XXXX          # <- edit this line
sudo mkdir -p $POOL/appdata/lux/{data,backups}
```

Now hand the data folder to the container's user:

```bash
sudo chown -R 1001:1001 $POOL/appdata/lux/data
```

**Do not skip this.** The app runs as uid 1001 inside the container, and a bind
mount keeps the _host's_ ownership — the image's own permissions do not apply to
mounted folders. Without this, the app starts normally and then fails on the
first save with a read-only database error, which looks like an app bug rather
than a permissions problem.

Confirm:

```bash
ls -ln $POOL/appdata/lux
# data should show owner 1001, group 1001
```

---

## Step 2 — Add the stack in Portainer

Open Portainer → **Stacks** → **+ Add stack**.

- **Name:** `lux-viridis`
- **Build method:** **Repository**

Fill in:

| field                | value                                                    |
| -------------------- | -------------------------------------------------------- |
| Repository URL       | your repo URL, e.g. `https://github.com/you/lux-viridis` |
| Repository reference | `refs/heads/main`                                        |
| Compose path         | `docker-compose.yml`                                     |

If the repository is **private**, switch on **Authentication** and supply a
GitHub personal access token as the password. A classic token needs only the
`repo` scope; a fine-grained one needs read access to _Contents_.

---

## Step 3 — Set the environment variables

Still on the Add-stack page, scroll to **Environment variables** and add three.
Use **+ Add an environment variable** for each, or **Advanced mode** to paste
them all at once.

| name             | value                                                                            |
| ---------------- | -------------------------------------------------------------------------------- |
| `LUX_DATA_DIR`   | `/srv/dev-disk-by-uuid-44557c8d-25b0-4e66-9291-1fddc461a068/appdata/lux/data`    |
| `LUX_BACKUP_DIR` | `/srv/dev-disk-by-uuid-44557c8d-25b0-4e66-9291-1fddc461a068/appdata/lux/backups` |
| `LUX_PORT`       | `3000`                                                                           |

Substitute your real pool path from Step 1. **Absolute paths only.**

> **This step is the one that quietly goes wrong.** The compose file falls back
> to `./data` if `LUX_DATA_DIR` is unset. Nothing errors — the stack deploys,
> the app runs, and your writing goes into a Portainer-managed folder instead of
> your pool, where the backup service and your snapshot routine will not find
> it. Set the variables before deploying, and verify with Step 5.

There is no tunnel token here. This stack has no `cloudflared` service.

---

## Step 4 — Deploy

Click **Deploy the stack**.

The first build takes 5–15 minutes and Portainer's spinner gives no progress.
To watch it, open a second tab: **Stacks → lux-viridis → Logs**, or over SSH:

```bash
docker logs -f lux-viridis
```

You want to see, in order:

```
[lux] applying migrations…
[lux] applied 0000_…
   ▲ Next.js 16.x
   ✓ Ready in ...ms
```

`[lux] schema already current` instead of `applied …` is also correct — it means
the database was already migrated.

If the build fails, jump to [Troubleshooting](#troubleshooting).

---

## Step 5 — Verify before involving Cloudflare

Do this now. It separates "the app is broken" from "the routing is wrong",
which produce identical symptoms in the browser and are otherwise painful to
tell apart.

Over SSH:

```bash
curl -I http://localhost:3000/login
```

Expect `HTTP/1.1 200 OK`. If you get connection-refused, the app is not running
— check the logs, not Cloudflare.

Then confirm the database landed on the pool:

```bash
ls -la /srv/dev-disk-by-uuid-XXXX/appdata/lux/data
```

You should see `lux.db`. **If that folder is empty, Step 3 did not take effect**
— fix the variables and redeploy before you write anything you care about.

---

## Step 6 — Add the hostname to your existing tunnel

In the **Cloudflare Zero Trust** dashboard → **Networks → Tunnels** → your
existing tunnel → **Configure** → **Public Hostname** → **Add a public
hostname**:

| field     | value                            |
| --------- | -------------------------------- |
| Subdomain | `write` (or whatever you prefer) |
| Domain    | your domain                      |
| Path      | leave empty                      |
| Type      | `HTTP`                           |
| URL       | _see below_                      |

**For the URL, copy the pattern your working hostnames already use.** Open the
entry for an existing service (calibre-web, Kavita) and look at its URL:

- If it reads `192.168.x.x:8083`, use that same IP with `:3000`.
- If it reads `localhost:8083` or `127.0.0.1:8083`, use `localhost:3000`.
- If it reads a container name, your `cloudflared` shares a network with these
  services and this stack would need joining to it — see
  [Appendix A](#appendix-a--if-your-cloudflared-uses-container-names).

The right answer depends on how your `cloudflared` runs, and your existing
hostnames already encode it. Guessing produces a Cloudflare 502 against a
perfectly healthy app.

`HTTP` is correct even though visitors arrive over HTTPS. Cloudflare terminates
TLS at its edge; the last hop across your LAN is plain HTTP.

Save. Cloudflare applies it within a few seconds.

---

## Step 7 — Create your account

Visit `https://write.<your-domain>`.

The first visit shows a setup screen — no account exists yet. Create yours with
an email, a password, and two recovery answers. The recovery answers are the
only way back in if the password is forgotten, and they are stored hashed, so
they cannot be read back out of the database.

**Do not run `npm run db:seed` on this deployment.** The demo account
(`writer@example.com` / `password`) is a development convenience and would be a
working login on an internet-facing site.

### Adding a second account

The setup screen only runs once — it returns a 409 afterwards — and there is no
in-app screen for creating a second account. Add one from the server shell:

```bash
docker exec -it lux-viridis node scripts/user-standalone.mjs add
```

It asks for an email, a display name, and a password (typed twice, not echoed).
The `-it` matters: without it the tool refuses to run rather than echo the
password into your scrollback.

They can then set their own recovery questions from the account menu after
signing in.

### If a password is ever forgotten

The security questions on the login page are the first route. If those are also
forgotten, the server shell is the last resort — reaching the box is itself the
proof of identity, since there is no mail service here to send a reset link
through:

```bash
docker exec -it lux-viridis node scripts/user-standalone.mjs passwd her@email
```

Other commands: `list` (show accounts), `verify <email>` (check a password is
accepted), `remove <email>` (delete an account — it offers to transfer any
projects to another account first, and refuses rather than destroying writing).

---

## Step 8 — Restrict access (recommended)

The site is now on the public internet. Anyone who finds the hostname reaches
your login page — the app's own password is the only thing in the way.

Cloudflare Access puts a second door in front of it, free on your plan:

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**
2. Application domain: `write.<your-domain>`
3. Add a policy: **Allow**, include **Emails** → your address and your
   anyone else who should have access.

Visitors then get a Cloudflare email-code prompt and never reach the app at all
unless their address is on the list. Worth the five minutes for a site holding a
someone's private writing.

---

## Which path did I deploy with?

Worth settling before any update, because the two paths update differently and
the wrong one silently redeploys the *old* image instead of failing loudly.

Open Portainer → **Stacks → lux-viridis** and look at the top of the page:

| What you see                                     | Path                                   | To update                                |
| ------------------------------------------------ | -------------------------------------- | ---------------------------------------- |
| A repository URL and **Pull and redeploy**        | Repository (the main path)             | This section                             |
| A YAML textarea and **Update the stack**          | Web editor — [Appendix C](#appendix-c--deploying-a-prebuilt-image) | Appendix C's update steps |

A Web-editor stack has no repository behind it: the YAML in that box is the
whole stack definition, and **Update the stack** never contacts git. If the
compose file says `build: .`, Compose looks for a Dockerfile in Portainer's
stack folder, finds none, and quietly reuses whatever `lux-viridis:latest`
already exists on the box — so the containers restart on old code and the
update appears to succeed.

To check which commit is actually running, look for a file you know is recent:

```bash
docker exec lux-viridis ls -l scripts/backup-stories.mjs
```

`No such file or directory` means the image predates the Markdown backups and
needs the rebuild in Appendix C. (Run this over SSH on the box — on a laptop it
fails with _cannot connect to the Docker daemon_, which says nothing about the
deployment.)

---

## Updating later

Portainer → **Stacks → lux-viridis → Pull and redeploy**.

Tick **Re-pull image and redeploy**. Portainer pulls the latest commit, rebuilds
and restarts.

Migrations run automatically at startup. The database is a bind mount outside
the image, so rebuilds never touch your writing.

> If you deployed with a prebuilt image instead
> ([Appendix C](#appendix-c--deploying-a-prebuilt-image)), this section does not
> apply — **Pull and redeploy** fails with _pull access denied_, because the
> image is local and not in any registry. Follow Appendix C's update steps.

---

## Backups

The `backup` service copies the database to `LUX_BACKUP_DIR` every 24 hours,
keeping the most recent 14. It uses `sqlite3 .backup` rather than `cp`, because
copying a live database can capture a half-finished transaction.

Check it is working after a day:

```bash
ls -la /srv/dev-disk-by-uuid-XXXX/appdata/lux/backups
```

These backups sit on the same pool as the original, which protects against
mistakes and corruption but **not** against losing the pool. Include that folder
in whatever off-box backup you already run for the rest of your OMV data.

To restore, stop the stack, copy a snapshot over `data/lux.db`, delete any
`lux.db-wal` and `lux.db-shm` beside it, then start again.

---

## Troubleshooting

Work out which half is broken first. On the box:

```bash
curl -I http://localhost:3000/login
```

200 means the app is fine and the problem is routing. Anything else means the
problem is the app.

| symptom                                                         | cause and fix                                                                                                                                                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare 502, `curl` returns 200                              | Tunnel URL is wrong for how your `cloudflared` runs. Copy the URL form from a working hostname (Step 6).                                                                                |
| `curl` connection refused                                       | App not running. `docker logs lux-viridis`.                                                                                                                                             |
| Deploy fails: _port is already allocated_                       | Something else holds 3000. Pick another `LUX_PORT`, redeploy, update the tunnel URL to match.                                                                                           |
| App runs, saving fails, logs show `SQLITE_READONLY` or `EACCES` | Step 1's `chown` was missed. `sudo chown -R 1001:1001 <data dir>`, then restart the stack.                                                                                              |
| `lux.db` is not in your pool folder                             | `LUX_DATA_DIR` was unset or relative at deploy time. Fix the variable, redeploy, and move any existing database across.                                                                 |
| Login page accepts the password then returns to login           | Cookie rejected because the connection is not HTTPS — the browser console says so explicitly. Reach the site through the Cloudflare hostname, not the LAN IP. To test over the LAN first, set `LUX_INSECURE_COOKIES: "1"` in the app service, then **remove it** once the tunnel is up: over plain HTTP the password crosses the network in clear text. |
| Build fails during `npm ci` or `node-gyp`                       | Out of memory compiling `better-sqlite3`. Stop other containers and retry, or add swap.                                                                                                 |
| Build fails at `npm run build`, no useful error in Portainer    | Build it over SSH to see the real error: `docker build -t lux-viridis:latest .`. If that succeeds where Portainer fails, deploy the image instead — [Appendix C](#appendix-c--deploying-a-prebuilt-image). |
| Stack redeploy fails: _pull access denied_                      | The stack uses a locally built image, so there is nothing to pull. Use **Update the stack** with **Re-pull image** off, not **Pull and redeploy** — [Appendix C](#appendix-c--deploying-a-prebuilt-image). |
| A variable set in Portainer never reaches the app               | Check with `docker exec lux-viridis env \| grep LUX_`. If missing, put it in the compose YAML's `environment:` block instead and update the stack.                                       |
| Build fails: _no such file or directory, Dockerfile_            | Compose path is wrong in the stack settings. It should be `docker-compose.yml` at the repository root.                                                                                  |

---

## Appendix A — if your `cloudflared` uses container names

If your existing tunnel routes to services by container name (e.g.
`http://kavita:5000`), then `cloudflared` shares a Docker network with them, and
this stack needs to join it too.

Find the network:

```bash
docker inspect <your-cloudflared-container> \
  --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'
```

Then add to the `app` service in `docker-compose.yml`, replacing
`<network-name>`:

```yaml
    networks:
      - proxy

networks:
  proxy:
    external: true
    name: <network-name>
```

The tunnel URL then becomes `http://lux-viridis:3000` — the container name with
the _internal_ port 3000, not `LUX_PORT`. With this arrangement you can also
drop the `ports:` block entirely, which stops the app being reachable from the
LAN at all.

---

## Appendix B — without a git repository

If you would rather not publish the code, copy it to the box and point Portainer
at the folder.

From your Mac:

```bash
rsync -av --exclude node_modules --exclude .next --exclude data \
  ~/Projects/"Lux Viridis"/ \
  omv-user@omv-host:/srv/dev-disk-by-uuid-XXXX/appdata/lux/app/
```

The exclusions matter: `node_modules` is large and built for macOS, and `data`
is your local database, which would overwrite the deployed one.

Portainer's **Web editor** cannot build from a local path, so deploy this one
over SSH instead:

```bash
cd /srv/dev-disk-by-uuid-XXXX/appdata/lux/app
cp .env.example .env
nano .env                      # set the three variables from Step 3
docker compose up -d --build
```

The stack still appears in Portainer (as _limited_ control) for logs and
restarts. Updating means repeating the `rsync` and the `docker compose up -d
--build`.

---

## Appendix C — deploying a prebuilt image

Portainer builds the image itself in the main path above. If that build fails
inside Portainer but succeeds over SSH, build it by hand and have the stack run
the finished image instead. The app is identical either way; only who runs
`docker build` changes.

Common reasons the Repository path fails on a NAS, none of which affect a
hand-run `docker build`: Portainer's build has no TTY and a short timeout, so a
15-minute native-module compile can be killed with no useful error; a private
repo needs a token with _Contents_ read access; and Portainer clones to its own
volume, which on a small system disk can run out of space while the pool sits
empty. If you land here, it is worth writing down which of these it was — the
choice between paths is otherwise impossible to reconstruct months later.

Build on the box:

```bash
git clone https://github.com/devilsangel360live/lux-viridis.git /tmp/lux-build
cd /tmp/lux-build
docker build -t lux-viridis:latest .
```

Unlike Portainer's spinner, this prints the real error if a build step fails.

Then in Portainer → **Stacks → + Add stack**, set **Build method** to **Web
editor** and paste the compose file with `build: .` removed from **both** the
`app` and `stories` services, so they use the image you just built. Leaving
`build: .` in is what produces the silent no-op described in
[Which path did I deploy with?](#which-path-did-i-deploy-with):

```yaml
services:
  app:
    image: lux-viridis:latest
    container_name: lux-viridis
    restart: unless-stopped
    environment:
      DATABASE_FILE: /data/lux.db
      NODE_ENV: production
    volumes:
      - ${LUX_DATA_DIR:-./data}:/data
    ports:
      - "${LUX_PORT:-3000}:3000"

  # Nightly Markdown dump — the readable backup. Same image as app; the
  # entrypoint override matters, or this container would re-run migrations.
  stories:
    image: lux-viridis:latest
    container_name: lux-stories
    restart: unless-stopped
    depends_on:
      - app
    environment:
      DATABASE_FILE: /data/lux.db
      BACKUP_DIR: /backups/stories
      BACKUP_KEEP: "5"
    volumes:
      - ${LUX_DATA_DIR:-./data}:/data
      - ${LUX_BACKUP_DIR:-./backups}:/backups
    entrypoint: ["/bin/sh", "-c"]
    command: >
      "while true; do
         node scripts/backup-stories.mjs || echo '[backup] stories FAILED';
         sleep 86400;
       done"
```

Copy the `backup` service across from `docker-compose.yml` unchanged, and set
the environment variables from Step 3 as normal. Then delete the build clone —
`/tmp` does not survive a reboot, and nothing needs it after the image exists:

```bash
cd / && rm -rf /tmp/lux-build
```

Do **not** run `docker compose up` from the clone directory. `LUX_DATA_DIR` is
not set there, so the compose file falls back to `./data` and the database lands
in `/tmp` instead of your pool — where it will not survive a reboot. Deploy from
Portainer, where the variables are set, and confirm with Step 5.

### Updating

The one-button redeploy does not work here: **Pull and redeploy** tries to fetch
`lux-viridis:latest` from Docker Hub, where it does not exist, and fails with
_pull access denied_. Rebuild and restart instead:

```bash
rm -rf /tmp/lux-build                    # a leftover clone would fail the next line
git clone https://github.com/devilsangel360live/lux-viridis.git /tmp/lux-build
cd /tmp/lux-build
docker build -t lux-viridis:latest .
cd / && rm -rf /tmp/lux-build
```

Then Portainer → **Stacks → lux-viridis → Update the stack**, with **Re-pull
image** left off. Leaving it **on** fails the whole stack with _pull access
denied for lux-viridis_ — it forces a registry lookup for an image that only
exists on this box.

Migrations run at startup as usual, and the database is a bind mount, so none of
this touches your writing.

Confirm the new image is what is actually running, rather than trusting the
green tick — the failure mode here is a redeploy that succeeds on stale code:

```bash
docker exec lux-viridis cat package.json | grep '"backup:stories"'
docker ps --format '{{.Names}}\t{{.Status}}' | grep lux
```

The first prints the script line if the image includes the Markdown backups; the
second should list `lux-viridis`, `lux-stories` and `lux-backup`.

### Environment variables that will not apply

Adding a variable in Portainer's editor saves the definition without
necessarily recreating the container, so the running app never sees it. Check:

```bash
docker exec lux-viridis env | grep LUX_
```

If a variable you set is missing, put it directly in the compose YAML instead —
in the `app` service's `environment:` block, quoted, e.g.
`LUX_INSECURE_COOKIES: "1"` — and update the stack again.
