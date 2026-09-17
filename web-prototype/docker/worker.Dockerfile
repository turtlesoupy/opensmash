FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ffmpeg python3 python3-pip python3-venv \
    && python3 -m venv /opt/venv \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate

WORKDIR /workspace/pipeline/web-prototype
COPY pipeline/web-prototype/package.json pipeline/web-prototype/pnpm-lock.yaml pipeline/web-prototype/pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY pipeline/web-prototype/server ./server
COPY pipeline/web-prototype/shared ./shared
COPY pipeline/web-prototype/infra/requirements-worker.txt /tmp/requirements-worker.txt
RUN pip install --no-cache-dir -r /tmp/requirements-worker.txt

COPY pipeline/pipeline /workspace/pipeline/pipeline
COPY pipeline/skels /workspace/pipeline/skels
# Moveset-independent native source build: code/schema only, no game assets.
COPY pipeline/engines/melee/opensmash_melee/*.py /workspace/pipeline/engines/melee/opensmash_melee/
COPY pipeline/engines/melee/tools/bake_native_sources.py pipeline/engines/melee/tools/prepare_native_fit_local.py /workspace/pipeline/engines/melee/tools/
COPY pipeline/engines/melee/runtime/launch-options.json pipeline/engines/melee/runtime/retarget-options.json /workspace/pipeline/engines/melee/runtime/
COPY pipeline/web-prototype/visual/assets/ui_refs /workspace/pipeline/web-prototype/visual/assets/ui_refs
COPY pipeline/assets/portrait_style_refs /workspace/pipeline/assets/portrait_style_refs
COPY pipeline/assets/tpose_style_ref /workspace/pipeline/assets/tpose_style_ref
RUN mkdir -p /workspace/pipeline/play/ui /workspace/BattleShip/web-dist/bundles /workspace/pipeline/web-prototype/data/fighter-jobs \
    && chown -R node:node /workspace

USER node
EXPOSE 8080
# Long-lived worker service (server/worker-service.js). server/worker.js is
# the one-shot Cloud Run Job entry point, kept for manual runs.
CMD ["node", "server/worker-service.js"]
