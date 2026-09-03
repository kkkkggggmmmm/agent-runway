FROM node:22-bookworm-slim AS web-build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ARG CODEX_VERSION=0.153.0
RUN npm install --global --omit=dev "@openai/codex@${CODEX_VERSION}" \
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin agentrunway \
  && mkdir -p /home/agentrunway/state \
  && chown -R agentrunway:agentrunway /home/agentrunway

WORKDIR /app
COPY --from=web-build /app/dist ./dist
COPY --from=web-build /app/server ./server
COPY --from=web-build /app/cloud ./cloud

USER agentrunway
ENV NODE_ENV=production \
    PORT=8080 \
    AGENT_RUNWAY_DATA_DIR=/home/agentrunway/state

EXPOSE 8080
CMD ["node", "cloud/server.mjs"]
