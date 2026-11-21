# SRK Film Studio

A private web app for you and your friends. Pick one of the ~96 film styles from the
[SRK-Opuscar](https://github.com/rajkumarsurgeon34-droid/SRK-Opuscar) library, type what the film
is about, and a Claude agent on your server directs it, writes the animation code, renders
it frame by frame, scores and mixes it, and hands back an MP4.

```
Browser ──► web app (Express) ──► job queue ──► Claude Agent SDK (bash, files) ──► SRK-Opuscar tools
                ▲                                                                   (Chromium, ffmpeg, Python)
                └──────────── live progress (SSE) · film, poster, subtitles ◄───────┘
```

## What to expect

| | |
|---|---|
| Time per film | about 20–90 minutes (the agent writes code, checks stills, renders every frame) |
| Cost per film | paid from your Claude API key; capped by `MAX_BUDGET_USD` (default $15) |
| Server | 4+ CPU cores, 8 GB RAM, ~6 GB disk for the image plus room for films. No GPU needed (3D styles render slower in software) |
| Not available | Text Flash Cuts, Comic History Cartoon and Manga Panels need an outside image generator, so the app shows them greyed out |

## Run it

1. Copy the settings and fill them in:
   ```sh
   cp .env.example .env
   # ANTHROPIC_API_KEY, FRIENDS=name:password,..., SESSION_SECRET=$(openssl rand -hex 32)
   ```
2. Build and start:
   ```sh
   docker compose up -d --build
   ```
3. Open http://localhost:3000 and log in with a name and password from `FRIENDS`.

**Try it free first:** set `MOCK_AGENT=1` in `.env`. The app then skips Claude and renders a
6-second test film, which proves Chromium, ffmpeg and the library work on your server.

### Hosting

Any machine that runs Docker works: a small VPS (Hetzner, DigitalOcean, Lightsail), Railway or
Fly.io with a volume mounted at `/data`. Put it behind HTTPS (Caddy, Cloudflare Tunnel, or the
platform's own) and set `COOKIE_SECURE=1`. Keep `shm_size: 2gb` (Chromium needs it).

### Without Docker

Needs Node 20+, ffmpeg 7+, Python 3.11+, and the library installed:

```sh
git clone https://github.com/rajkumarsurgeon34-droid/SRK-Opuscar ~/srk-opuscar
sh ~/srk-opuscar/plugin/skills/srk-opuscar/scripts/setup.sh deps voice music
npm install
FRIENDS=me:secret SESSION_SECRET=$(openssl rand -hex 32) ANTHROPIC_API_KEY=... npm start
```

## Settings

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | pays for the films |
| `FRIENDS` | (required) | `name:password,name2:password2`; remove a name to lock that person out |
| `SESSION_SECRET` | (required) | 16+ random characters |
| `CLAUDE_MODEL` | `claude-opus-5-5` | model that directs the film |
| `MAX_BUDGET_USD` | `15` | hard stop per film |
| `MAX_TURNS` | `400` | hard stop per film |
| `FILMS_PER_DAY` | `2` | per friend per 24 h; `0` = no limit |
| `CONCURRENCY` | `1` | films made at the same time (each one is CPU-heavy) |
| `MOCK_AGENT` | `0` | `1` = free test renders, no Claude |
| `COOKIE_SECURE` | `0` | `1` when served over HTTPS |

## How it works

- `server.js`: login, API, downloads, live progress.
- `src/jobs.js`: the queue; each film gets `data/films/<id>/film/` and a log.
- `src/agent.js`: the brief and rules handed to Claude (unattended, never asks questions, follows the
  library's `AGENTS.md`/`DIRECTOR.md`, delivers `<name>.mp4`, `poster.jpg`, `.srt`, `TREATMENT.md`, `CREDITS`, `build.sh`).
- `src/mock.js`: the free test render.
- `public/`: the website.

The agent runs with permission prompts off, because nobody is there to approve them, so the
container is the sandbox. Run it only on a server you use for this.

## Licence and credit

The app code is MIT. The film styles and guides come from **Lemo-Opuscar by Lemomo (LemoLab)**.
Its docs are under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), so this app is
for **private, non-commercial use**. Running it as a paid or commercial service needs a commercial
licence from Lemomo (lemomo.studio@gmail.com). Films you make are yours. Third-party material in
them keeps its own terms, which each film's `CREDITS` lists.
