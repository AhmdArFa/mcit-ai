# MCIT AI

The private AI workspace for the Ministry of Communications and Information Technology.
**Thoth** is the agent; the notebook Assistant answers questions using notebook sources.

Developed by Eng Ahmed Arfa for MCIT.

## Run Locally

Docker Compose starts SurrealDB, Ollama, Kokoro TTS, the API/worker and the Next.js UI.
The first start downloads the `qwen2.5:7b` and `nomic-embed-text` models.

```bash
docker compose up -d --build
```

Open `http://localhost:8502`. The API health endpoint is `http://localhost:5055/health`.
Set unique `OPEN_NOTEBOOK_ENCRYPTION_KEY`, `SURREAL_PASSWORD`, and
`OPEN_NOTEBOOK_PASSWORD` values in `.env` before putting the app on a shared network.
See [MCIT_LM_SETUP_GUIDE.md](MCIT_LM_SETUP_GUIDE.md) for setup and troubleshooting.



## Features

- Source ingestion, notebook-grounded chat, vector search and notebook management.
- Thoth agent with tool execution, expandable progress and model-reported token usage.
- Studio: presentations, PDF reports, infographics, summaries and Excel dashboards.
- Files: edit generated slides, spreadsheets and documents in place; organize PDF pages and
  edit Markdown/text. Export the latest native file from the panel.
- Local TTS via Kokoro for podcast generation. Ollama is the default LLM; optional cloud
  providers send task content to their endpoints when selected.

The avatar gallery is bundled from the MCIT asset repository at a pinned revision.
`tutankhamun.webp` is the default. Select another locally stored avatar in Thoth's profile;
no runtime request to GitHub is made.
Confirm the asset repository's redistribution rights before a public release.

Thoth uploads supported files through the same local ingestion path as notebooks. A PDF can be
uploaded directly from the Agent composer. Image files such as PNG currently need a configured
local OCR/vision extractor; they return an explicit unsupported-format error instead of being
silently queued. The selected notebook is pinned while an attachment is pending.

The LobeHub application source is **not** imported: its Community License can require a
commercial derivative license, and its PostgreSQL/S3/Redis agent stack is not compatible with
MCIT AI's current notebooks and Studio storage without a migration. MCIT AI uses the published
`@lobehub/ui` component package for interface elements. See
[ADR-015](docs/7-DEVELOPMENT/decisions/ADR-015-lobehub-integration-boundary.md).

## Deployment Status

This refactor is **not certified for production**. Read [TEST_REPORT.md](TEST_REPORT.md) and
[PRIVACY_AUDIT.md](PRIVACY_AUDIT.md) before deployment. In particular, the default Docker
configuration is for local development; not all data is stored in SurrealDB and cloud
provider retention has not been verified. Do not claim 100% privacy or zero egress.

