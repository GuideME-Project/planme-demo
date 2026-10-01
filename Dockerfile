# PlanME web (Next.js standalone) for ECS Fargate. Build from the repository root:
#   docker build -t planme-web .
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/planme-core/package.json packages/planme-core/package.json
RUN npm ci --workspace @planme/web --workspace @planme/core --include-workspace-root=false

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so CI must pass them as build args.
ARG NEXT_PUBLIC_ODSAY_API_KEY
ARG NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID
ARG NEXT_PUBLIC_NCP_MAPS_CLIENT_ID
ENV NEXT_PUBLIC_ODSAY_API_KEY=$NEXT_PUBLIC_ODSAY_API_KEY \
    NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID=$NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID \
    NEXT_PUBLIC_NCP_MAPS_CLIENT_ID=$NEXT_PUBLIC_NCP_MAPS_CLIENT_ID
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
# Standalone output keeps the monorepo layout because outputFileTracingRoot is the repository root.
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
