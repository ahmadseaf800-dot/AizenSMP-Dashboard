# AizenSMP Dashboard

AIZEN SMP Security Command Center with the AIZEN AI Server Management Agent.

## AIZEN AI flow

Dashboard → AIZEN AI Builder / AizenCore → validated action → Dashboard API → command queue / GitHub Actions → Minecraft server.

AIZEN AI does not receive GitHub tokens or other secrets. The Dashboard keeps them on its backend.

## Render environment

Required:

- `DASHBOARD_ADMIN_TOKEN` — protects admin AI and server-control operations.
- `DASHBOARD_API_TOKEN` — private server-to-dashboard bridge token.
- `AIZEN_DASHBOARD_SECRET` — shared server-to-server secret with Aizen AI Builder.
- `AIZEN_AI_BUILDER_URL` — normally `https://aizen-ai-builder.onrender.com`.
- `GITHUB_TOKEN` — backend only; never expose it to the frontend.
- `GITHUB_REPO` — normally `ahmadseaf800-dot/AizenSMP`.
- `GITHUB_WORKFLOW` — normally `server.yml`.
- `GITHUB_REF` — normally `main`.

## AizenSMP GitHub Actions secrets

Add:

- `DASHBOARD_URL` — public Render URL of this Dashboard.
- `DASHBOARD_API_TOKEN` — same value used by the Dashboard backend.

The Minecraft bridge plugin uses these secrets to publish live player/staff data and consume the secure command queue.

## Security model

- Normal dashboard requests do not execute Minecraft commands.
- AIZEN AI returns a structured action; the Dashboard validates and constructs the Minecraft command.
- Sensitive actions require `DASHBOARD_ADMIN_TOKEN`.
- GitHub Actions tokens stay on the backend.
- Natural-language intent is interpreted by Aizen AI Builder/AizenCore, not by a regex command parser.
- Anti-cheat detections are only shown when an actual server-side detector reports them.
