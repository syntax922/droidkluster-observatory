FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/projector/package.json packages/projector/
RUN npm ci --workspaces --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/projector packages/projector
RUN npm run build --workspace @observatory/core --workspace @observatory/projector

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/projector/dist packages/projector/dist
COPY --from=build /app/packages/projector/package.json packages/projector/
USER node
CMD ["node", "packages/projector/dist/index.js"]
