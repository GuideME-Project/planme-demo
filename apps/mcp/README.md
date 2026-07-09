# PlanME MCP App

This workspace is reserved for the future GPT App / Apps SDK MCP server.

Current status:

- Exposes a local Streamable HTTP MCP endpoint at `/mcp`.
- Exposes GPTs Actions REST endpoints under `/api/gpt/*`.
- Registers PlanME planning, preview, commit, recommend, and read tools.
- Registers `ui://planme/itinerary-widget.html` as a `text/html;profile=mcp-app` widget resource.
- Uses server-side OpenAI generation for recommendation requests that do not already include concrete days.
- Keeps GPT App code removable from the PlanME web app.

When implementation starts, keep GPT App-specific tool schemas, widget resources, auth policy, and MCP transport code in this workspace. Shared itinerary logic should stay in `packages/planme-core`.

## Commands

```bash
npm --workspace @planme/mcp run dev
npm run test:mcp
```

## Vercel

Create a separate Vercel project for the MCP app and set:

- Root Directory: `apps/mcp`
- Framework Preset: Other
- Install Command: `npm ci`
- Build Command: leave empty
- Environment Variable: `OPENAI_API_KEY`

The public MCP URL should be:

```text
https://<mcp-project-domain>/mcp
```

The GPT Builder Actions schema URL should be:

```text
https://<mcp-project-domain>/api/gpt/openapi
```

The schema exposes:

- `POST /api/gpt/planning/start`
- `POST /api/gpt/itineraries/recommend`
