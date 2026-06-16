# PlanME Demo

PlanME technical-validation demo for Custom GPT Actions, PlanME web handoff, dynamic preview image URLs, and future GPT App / Apps SDK experiments.

## Workspace Structure

```text
planme-demo/
  apps/
    web/   # Next.js PlanME demo web app
    mcp/   # GPT App / Apps SDK MCP server placeholder
  packages/
    planme-core/ # Shared itinerary data, types, and GPT Actions response builders
  docs/
    custom-gpt-actions.md
```

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run test:actions
```

The root package delegates web commands to `@planme/web`.

## Deployment Note

After the monorepo migration, Vercel should treat `apps/web` as the Next.js application root, or run the root workspace build command with output configured for the web app. The current source layout keeps `apps/mcp` removable so GPT App experiments can be dropped without affecting the PlanME web app.
