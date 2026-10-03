# AizenSMP Dashboard

Live security and server dashboard for AizenSMP.

## Render
- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Environment variable: `DASHBOARD_API_TOKEN`

## API
- GET `/api/stats` — dashboard data
- POST `/api/event` — authenticated server event ingestion
- Authentication: `Authorization: Bearer <DASHBOARD_API_TOKEN>`

The dashboard is intentionally kept in its own repository. The Minecraft server only sends events to the API; no dashboard files are stored in the server repository.