# MCIT AI: privacy and data-sovereignty audit

Date: 2026-10-13. Verdict: **open findings; 100% private is not proven**.

This is a source review and limited runtime check, not a signed certification. No full packet
capture was taken during every feature and failure path. A claim that no user data or keys can
leak under all paths would be false.

## Egress map

| Path | Destination/data | Verdict |
|---|---|---|
| Local inference | Ollama (`11434`), Kokoro (`8880`) on Compose network/host | Local service traffic, not external cloud. No packet-capture evidence of zero other egress during inference. |
| Cloud inference | Configured provider endpoints (Groq was exercised; OpenAI and other providers are supported) | Sends prompts and relevant source text plus user-provided API credentials over HTTPS. Provider retention/no-training guarantees are **not** configured or verified. |
| Provider model discovery | Provider `/models` endpoints, including `api.groq.com` and other registry URLs | Sends provider key for authentication; no notebook text intended. Groq discovery was exercised. |
| Source ingestion | User-supplied page/YouTube URLs and optional extraction services | Sends requests to that host. Links with sensitive query strings and remote extraction services need separate review. |
| UI | `next/font/google` build-time font fetches; provider links; YouTube embeds in source details | External traffic is possible. Fonts are packaged into the built image. Next.js build/runtime telemetry is disabled in the Dockerfile. Do not open external embeds for sensitive data without a policy. |
| Avatar gallery | Nine images from `hazemelerefey/mcit-ai-library` at pinned commit `0afefb53906ae0c6ee5b8167d06c663848f7e5ae` | Build/setup download only; browser reads bundled `/avatars/*.webp` locally. The asset repository publishes no license file; verify redistribution authorization before release. |
| LobeHub application | Not used at runtime or imported as source | Its Community License requires commercial permission for some derivatives. LobeHub's optional analytics, telemetry and marketplace would need a new egress review if the whole platform were adopted. The published `@lobehub/ui` dependency is already in the frontend. |
| Update check | The old API version check reached `raw.githubusercontent.com` | Automatic check disabled in `api/routers/config.py`; the utility remains in the code for callers that may invoke it. |

## Storage map

| Data | Current location | Verdict |
|---|---|---|
| Notebooks, sources, notes, registered models, credentials | Local SurrealDB data volume | MCIT-hosted when deployed on MCIT infrastructure. Credential values are encrypted with `OPEN_NOTEBOOK_ENCRYPTION_KEY`. |
| Chat graph checkpoints | Local SQLite file under `notebook_data/sqlite-db/` | **Not in SurrealDB.** Back up, protect and encrypt the data volume. |
| Original uploads, podcast audio and generated Studio files | Local `notebook_data/` volume | **Not in SurrealDB.** Permissions, retention, backup and encryption at rest must be addressed. |
| Agent topics and messages | Browser `localStorage` (`mcit-ai-thoth-topics`) | **Not in MCIT's database.** Sensitive messages persist on the client device, unencrypted. |
| Agent avatar preference | Browser `localStorage` (`mcit-ai-agent-avatar`) | Contains only an allowlisted local image name. No remote avatar URL or file contents. |
| Skills | JSON file under `notebook_data/agent/skills.json` | **Not in MCIT's database.** User-defined instructions may contain private content. |
| Usage records | SurrealDB `usage_event` | Counts/model names and timestamps only; no prompt text intentionally written here. No pricing data. |
| Ollama models | `ollama_data/` local volume | Local cache. |

## Logging and error review

- Searched `api/` and `open_notebook/` for logger calls, prompt/response/content/key fields,
  external URLs, analytics and telemetry. `open_notebook/graphs/source.py` logs extraction
  exception text; `api/credentials_service.py` and several routers log raw exceptions. Their
  content is **not proven safe**. Older code still needs a systematic redaction pass.
- The new Thoth run engine previously logged exception tracebacks and sent exception text in
  polling events; its failure path now logs only the exception type and returns a generic error.
  Thoth tool/proxy and Studio legacy endpoints similarly avoid raw exception bodies after this pass.
- No complete credential/token canary test has been run across server logs, browser console and
  error responses. Existing log history has not been audited or removed.
- A Docker build displayed the Next.js anonymous telemetry notice. The Dockerfile now sets
  `NEXT_TELEMETRY_DISABLED=1` in both build and runtime stages; no network capture was taken
  to verify the setting prevents every telemetry request.

## Runtime checks and limits

- Docker stack, local notebook API and editor flows were exercised; Groq calls were made using a
  stored credential. No network sniffer/tcpdump capture was available for the required full-path
  comparison. This report **cannot** verify zero network egress during local inference.
- Bad-key, offline-cloud-provider, oversized-file, image generation and media ingestion failure
  paths were not all exercised. They are open audit work, not passes.
- The dev Compose configuration exposes an unauthenticated UI unless `OPEN_NOTEBOOK_PASSWORD` is
  set. Built-in authentication is a shared password, CORS defaults are permissive, and HTTPS is
  not supplied by the app. Restrict the network and add enterprise auth before deployment.

## Release blockers

1. Move browser-held agent conversations and JSON/file artifacts into a governed server-side
   store if the requirement literally means "all data in MCIT's database"; protect the existing
   SQLite and volume data while migrating.
2. Enable explicit production auth, restricted CORS, TLS termination, encrypted backups, access
   controls and retention. Remove default credentials and set a unique encryption key.
3. Complete log redaction and packet captures across all 19 flows and the named failure cases;
   verify every provider's retention policy and whether it can meet MCIT requirements.
4. Complete image generation and unsupported file-type handling before claiming universal tools.
5. Review the 25 npm advisories (12 high) reported during the Docker image build; validate the
   `@emoji-mart/react`/React 19 peer conflict from `@lobehub/ui` before shipping.

**Conclusion:** the local-first architecture can be deployed on MCIT-owned infrastructure, but
the requested 100% private/data-in-database statement cannot be signed at this stage.
