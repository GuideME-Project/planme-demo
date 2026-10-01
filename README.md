# PlanME Demo

PlanME 여행 일정 상세 화면, 공유 링크, OpenGraph 메타데이터를 제공하는 Next.js 웹 앱입니다.

## Workspace Structure

```text
planme-demo/
  apps/
    web/   # Next.js PlanME web app (standalone output, Docker/ECS)
  packages/
    planme-core/ # Shared itinerary data and types
  docs/
```

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run test:v3
```

The root package delegates web commands to `@planme/web`.

## Deployment

The web app runs as a Docker container (Next.js `output: "standalone"`) behind an ALB on ECS Fargate.

```bash
docker build -t planme-web .
docker run -p 3000:3000 -e PLANME_REDIS_URL=redis://<host>:6379 planme-web
```

- Health check: `GET /api/health` (does not call Redis or external APIs).
- `NEXT_PUBLIC_ODSAY_API_KEY`, `NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID`, `NEXT_PUBLIC_NCP_MAPS_CLIENT_ID` are inlined at build time, so pass them as `--build-arg`.
- `PLANME_REDIS_URL`: Redis(Valkey) TCP URL. Required in production; local runs fall back to process memory. All keys use the `planme:` prefix.
- `PLANME_WEB_ORIGIN`: public origin (default `https://planme.kr`), also used as the ODsay `Referer`.
- Client addresses for rate limiting use the last `X-Forwarded-For` entry, which the ALB appends in its default `append` mode.
