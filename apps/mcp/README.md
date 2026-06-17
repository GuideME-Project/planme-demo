# PlanME MCP App

This workspace is reserved for the future GPT App / Apps SDK MCP server.

Current status:

- Exposes a local Streamable HTTP MCP endpoint at `/mcp`.
- Registers `recommend_planme_itinerary` and `get_planme_itinerary`.
- Registers `ui://planme/itinerary-widget.html` as a `text/html;profile=mcp-app` widget resource.
- Keeps GPT App code removable from the PlanME web app.

When implementation starts, keep GPT App-specific tool schemas, widget resources, auth policy, and MCP transport code in this workspace. Shared itinerary logic should stay in `packages/planme-core`.

## Commands

```bash
npm --workspace @planme/mcp run dev
npm run test:mcp
```
