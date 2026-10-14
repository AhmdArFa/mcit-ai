# MCIT LM — Setup, Test & Deploy Guide (A to Z)

**Audience:** an AI coding agent (or engineer) taking MCIT LM from a fresh machine to a verified,
deploy-ready installation running entirely on local AI.

**Product:** MCIT LM — AI Platform for the Ministry of Communications and Information Technology. Developed by Eng Ahmed Arfa.

Follow the steps in order. Every step ends with a **Verify** block — do not continue until it passes.

---

## 0. Architecture at a glance

| Service | Image / source | Port | Purpose |
|---|---|---|---|
| `open_notebook` | built from this repo (`Dockerfile`) | **8502** UI, **5055** API | Next.js UI + FastAPI + background worker (supervisord) |
| `surrealdb` | `surrealdb/surrealdb:v2` | 8000 | Database + vector store |
| `ollama` | `ollama/ollama` | 11434 | Local LLM (`qwen2.5:7b`) + embeddings (`nomic-embed-text`) |
| `ollama-pull` | `ollama/ollama` (one-shot) | – | Downloads the two models on first start |
| `kokoro` | `ghcr.io/remsky/kokoro-fastapi-cpu` | 8880 | Local text-to-speech for podcasts (OpenAI-compatible) |

The browser only talks to **port 8502**. With `API_URL=same-origin` the UI calls `/api/*` on its own
origin and Next.js proxies to the API on 5055 internally. Exposing 5055 is not required.

On API startup, `open_notebook/ai/local_defaults.py` registers the local models and assigns them as
defaults (chat, transformation, tools, large-context, embedding, text-to-speech) **only where no
default is set yet**, and points the seeded podcast profiles at them. No cloud API key is needed.

---

## 1. Prerequisites

| Requirement | Minimum | Recommended |
|---|---|---|
| OS | Linux, macOS, or Windows 11 + WSL2 | Ubuntu 22.04/24.04 server |
| Docker Engine + Compose v2 | Docker 24+, `docker compose` | latest |
| RAM | 16 GB | 32 GB |
| Disk | 25 GB free | 50 GB SSD |
| CPU / GPU | 4 cores | 8+ cores, or NVIDIA GPU (8 GB+ VRAM) |
| Tools | `git`, `curl`, `openssl` | – |

**Verify**
```bash
docker --version && docker compose version && git --version && openssl version
docker run --rm hello-world
```

---

## 2. Clone

```bash
git clone https://github.com/AhmdArFa/SETUP.git mcit-lm
cd mcit-lm
git checkout main        # or the release branch you were given
```

**Verify:** `ls docker-compose.yml Dockerfile MCIT_LM_SETUP_GUIDE.md frontend/public/mcit-logo.png` lists all four.

---

## 3. Configure secrets (`.env`)

The default `docker-compose.yml` works without a `.env`, but **for any shared or production machine
you must set your own secrets**:

```bash
cat > .env <<EOF
OPEN_NOTEBOOK_ENCRYPTION_KEY=$(openssl rand -hex 32)
SURREAL_USER=root
SURREAL_PASSWORD=$(openssl rand -hex 16)
# Optional: protect the UI/API with a password
# OPEN_NOTEBOOK_PASSWORD=change-me
EOF
```

> Keep the encryption key forever: it decrypts stored credentials. Never commit `.env` (it is git-ignored).

Full list of variables the app reads:

| Variable | Default | Notes |
|---|---|---|
| `OPEN_NOTEBOOK_ENCRYPTION_KEY` | `change-me-to-a-secret-string` | **Set your own** |
| `SURREAL_URL` | `ws://surrealdb:8000/rpc` | set by compose |
| `SURREAL_USER` / `SURREAL_PASSWORD` | `root` / `root` | **Change for production** |
| `SURREAL_NAMESPACE` / `SURREAL_DATABASE` | `open_notebook` | |
| `OLLAMA_API_BASE` | `http://ollama:11434` | point at a host/remote Ollama if you don't use the bundled one |
| `OLLAMA_CHAT_MODEL` | `qwen2.5:7b` | language model registered as default |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | embedding model (vector search) |
| `MCIT_LOCAL_LLM_BOOTSTRAP` | `true` | `false` disables automatic default-model setup |
| `OPENAI_COMPATIBLE_BASE_URL_TTS` | `http://kokoro:8880/v1` | local TTS endpoint |
| `LOCAL_TTS_MODEL` | `kokoro` | |
| `OPEN_NOTEBOOK_WORKER_MAX_TASKS` | `1` | background job concurrency |
| `API_URL` | `same-origin` | full URL only when the API is on another host |
| `OPEN_NOTEBOOK_PASSWORD` | unset | optional login password |

---

## 4. Choose how to run the local LLM

### Option A — bundled Ollama in Docker (default, simplest)
Nothing to do; `docker compose up` starts Ollama and pulls the models.

**NVIDIA GPU (strongly recommended for speed):** install the NVIDIA Container Toolkit, then create
`docker-compose.override.yml`:
```yaml
services:
  ollama:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

### Option B — Ollama already installed on the host (your "local LLM")
1. Install Ollama: https://ollama.com/download (Linux: `curl -fsSL https://ollama.com/install.sh | sh`)
2. Pull the models:
   ```bash
   ollama pull qwen2.5:7b
   ollama pull nomic-embed-text
   ```
3. Make Ollama reachable from containers: `sudo systemctl edit ollama` →
   `[Service]` `Environment="OLLAMA_HOST=0.0.0.0:11434"` → `sudo systemctl restart ollama`
4. Create `docker-compose.override.yml`:
   ```yaml
   services:
     open_notebook:
       environment:
         - OLLAMA_API_BASE=http://host.docker.internal:11434
       extra_hosts:
         - "host.docker.internal:host-gateway"
   ```
5. Optionally stop the bundled one: `docker compose up -d --scale ollama=0 --scale ollama-pull=0`

**Verify (either option)**
```bash
curl -s http://localhost:11434/api/tags | grep -E 'qwen2.5:7b|nomic-embed-text'
```

---

## 5. Build and start

```bash
docker compose up -d --build
docker compose ps
```
First run downloads ~4.7 GB (qwen2.5:7b), ~270 MB (nomic-embed-text) and the Kokoro image; the
image build takes 3–10 minutes.

Follow progress:
```bash
docker compose logs -f ollama-pull      # wait for "success" twice
docker compose logs -f open_notebook    # wait for "API initialization completed successfully"
```

**Verify**
```bash
curl -s http://localhost:5055/                  # → JSON with "credit": "Developed by eng. Ahmed Arfa"
curl -s http://localhost:5055/health            # → {"status":"healthy"}
curl -s http://localhost:8502/config            # → {"apiUrl":""}
curl -s http://localhost:5055/api/models/defaults   # chat/embedding/tts defaults are non-null
curl -s http://localhost:8880/v1/audio/voices | head -c 200   # Kokoro voices list
```
Open **http://localhost:8502** → MCIT logo, navy sidebar, gold accents, English UI, footer
"Developed by eng. Ahmed Arfa".

---

## 6. Functional test plan (run all)

Create a notebook (**Notebooks → New Notebook**) and work inside it.

| # | Feature | Steps | Expected |
|---|---|---|---|
| 1 | PDF ingestion | Add Source → Upload a PDF | Source appears; status completes; embedded |
| 2 | Web page | Add Source → Link → any public article URL | Title + content extracted |
| 3 | Audio / video | Add Source → Upload `.mp3` / `.mp4`, or a YouTube link | Transcript extracted (needs speech-to-text model, see §8) |
| 4 | Chat | Chat panel → ask a question about the PDF | Answer from `qwen2.5:7b` with `[source:…]` citation |
| 5 | Vector search | Ask and Search → Search tab → query | Ranked results from your sources |
| 6 | Studio: presentation | Notebook → **Studio** → Presentation, pick a style, set slides to 10, formats PowerPoint + PDF → Generate | 10-slide deck: cover with logo, agenda, varied layouts (stats, chart, process, comparison, cards), closing; speaker notes in PowerPoint |
| 7 | Studio: report | Studio → Report → Detailed → PDF + Word | Cover page, summary, key figures, sections, recommendations |
| 8 | Studio: infographic | Studio → Infographic → SVG + PDF | One-page visual with figures and a takeaway |
| 9 | Studio: summary | Studio → Executive summary → Word | Branded DOCX |
| 10 | Files | Sidebar → Files | Every generated file listed, filter by type, download and delete work |
| 10a | Assistant: end to end | Sidebar → Assistant → "Create a notebook called X, add this text as a source: ..., then make an 8-slide deck in the teal theme and a Word summary" | Steps appear live (create notebook, add source, generate file x2); two file cards to download; the new notebook exists |
| 10b | Assistant: questions | Pick a notebook in the header, ask a question | Answer cites source titles |
| 10c | Skills | Sidebar → Skills → toggle humanizer, add a skill | Changes persist after reload and apply to the next generation |
| 11 | Podcast | Podcasts → Generate → profile `solo_expert`, pick the notebook | Episode finishes with playable audio (Kokoro voices) |
| 12 | About | Sidebar → About | Product info + "Developed by eng. Ahmed Arfa" |

API-level smoke test for Studio (replace the notebook id):
```bash
NB=notebook:xxxxxxxx
curl -s -X POST localhost:5055/api/studio/generate -H 'Content-Type: application/json' \
  -d "{\"notebook_id\":\"$NB\",\"kind\":\"report\"}" > doc.json
python3 -c "import json;print(json.dumps({'document':json.load(open('doc.json')),'format':'pdf'}))" > req.json
curl -s -X POST localhost:5055/api/studio/render -H 'Content-Type: application/json' -d @req.json -o report.pdf
```

Automated checks (from repo root, needs `uv` and Node 22):
```bash
uv sync && uv run pytest tests/ && uv run ruff check .
cd frontend && npm ci && npm run lint && npm run test && npm run build
```

---

Assistant API smoke test:
```bash
RUN=$(curl -s -X POST localhost:5055/api/agent/runs -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"List my notebooks"}]}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
sleep 20; curl -s localhost:5055/api/agent/runs/$RUN | python3 -m json.tool | head -40
```

## 7. Performance expectations (CPU vs GPU)

| Operation | CPU only (8 cores) | NVIDIA GPU |
|---|---|---|
| Chat answer | 10–60 s | 1–5 s |
| Studio document | 1–4 min | 10–30 s |
| Assistant multi-file request (2-3 files) | 4–10 min | 30–90 s |
| 10-min podcast | 20–60 min | 3–8 min |

The UI allows up to 10 minutes per request; Next.js proxy timeout is 15 minutes. Larger notebooks
are truncated to ~18 k characters for Studio generation (8 k-token window of qwen2.5:7b via Ollama).

---

## 8. Optional: speech-to-text for audio/video sources

Audio/video ingestion needs a speech-to-text model. To keep it local, run an OpenAI-compatible
Whisper server (e.g. `fedirz/faster-whisper-server`), set
`OPENAI_COMPATIBLE_BASE_URL_STT=http://whisper:8000/v1`, then in **Models** add an
OpenAI-compatible speech-to-text model (e.g. `Systran/faster-whisper-small`) and set it as default.
YouTube links with captions work without STT.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| "Unable to Connect to API Server" | `docker compose logs open_notebook`; make sure `API_URL=same-origin` (or a reachable URL); `curl localhost:8502/config` must return `{"apiUrl":""}` |
| Chat errors "model not found" | `docker compose logs ollama-pull`; run `docker compose exec ollama ollama pull qwen2.5:7b` |
| Sources stuck "processing" | worker runs inside `open_notebook`; check logs for `surreal-commands-worker` |
| Podcast error "no voice model" | Kokoro not reachable: `curl localhost:8880/v1/audio/voices`; restart `open_notebook` so the bootstrap reassigns |
| Very slow responses | use a GPU (§4) or a smaller model (`OLLAMA_CHAT_MODEL=qwen2.5:3b` + pull it) |
| Reset everything | `docker compose down` then delete `surreal_data/ notebook_data/` (**destroys data**) |

---

## 10. Production deployment checklist

1. Linux server, Docker + NVIDIA toolkit (if GPU).
2. `.env` with **unique** `OPEN_NOTEBOOK_ENCRYPTION_KEY`, `SURREAL_PASSWORD`, and `OPEN_NOTEBOOK_PASSWORD`.
3. Keep SurrealDB/Ollama/Kokoro bound to `127.0.0.1` (already done in `docker-compose.yml`).
4. Put a reverse proxy with TLS in front of **8502 only**, e.g. Caddy:
   ```
   mcit-lm.example.gov.eg {
       reverse_proxy 127.0.0.1:8502
   }
   ```
   Increase proxy timeouts to ≥ 15 minutes (long local generations) and body size to ≥ 100 MB (uploads).
5. Remove the `5055:5055` port mapping if nothing external needs the raw API.
6. Backups: nightly archive of `surreal_data/` and `notebook_data/` (stop or snapshot first).
7. Updates: `git pull && docker compose up -d --build` (migrations run automatically; back up first).
8. Note: the built-in auth is a single shared password and CORS is open — for multi-user or internet
   exposure, add SSO / network restrictions at the proxy layer.

---

## 12. Where things live

| Path | What |
|---|---|
| `frontend/public/mcit-logo.png` | Official MCIT logo used by the UI |
| `open_notebook/exports/assets/mcit-logo.png` | Same logo, embedded in generated files |
| `open_notebook/exports/content.py` | Studio: notebook material → structured document (LLM) |
| `open_notebook/exports/renderers.py` | Studio: PDF / DOCX / PPTX / SVG / HTML / MD / TXT / JSON renderers |
| `api/routers/studio.py` | `/api/studio/*` endpoints |
| `frontend/src/components/studio/StudioDialog.tsx` | Studio UI |
| `open_notebook/agent/` | Assistant runner, tools, skills |
| `api/routers/agent.py` | `/api/agent/*` endpoints |
| `frontend/src/app/(dashboard)/assistant/` | Assistant page |
| `open_notebook/exports/themes.py` | Studio styles |
| `open_notebook/ai/local_defaults.py` | Local model + podcast profile bootstrap |
| `frontend/src/app/globals.css` | Navy/gold design tokens |
| `frontend/src/components/layout/` | Sidebar, footer, app shell |
