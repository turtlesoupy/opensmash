FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
WORKDIR /workspace/pipeline/web-prototype
COPY pipeline/web-prototype/package.json pipeline/web-prototype/pnpm-lock.yaml pipeline/web-prototype/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY pipeline/web-prototype/ ./
COPY pipeline/engines/ssb64/launcher /workspace/pipeline/engines/ssb64/launcher
COPY pipeline/engines/melee/launcher /workspace/pipeline/engines/melee/launcher
COPY pipeline/engines/melee/web/app /workspace/pipeline/engines/melee/web/app
COPY pipeline/engines/melee/web/lib /workspace/pipeline/engines/melee/web/lib
COPY pipeline/engines/melee/web/public/catalog.json /workspace/pipeline/engines/melee/web/public/catalog.json
COPY pipeline/engines/melee/runtime/launch-options.json /workspace/pipeline/engines/melee/runtime/launch-options.json
COPY pipeline/engines/melee/runtime/web/launch-options.mjs /workspace/pipeline/engines/melee/runtime/web/launch-options.mjs
RUN pnpm build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
COPY pipeline/engines/melee/requirements.txt /tmp/melee-requirements.txt
RUN python3 -m venv /opt/melee-python && /opt/melee-python/bin/pip install --no-cache-dir -r /tmp/melee-requirements.txt 'google-cloud-storage>=2,<4'
ENV MELEE_PYTHON=/opt/melee-python/bin/python
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
WORKDIR /workspace/pipeline/web-prototype
COPY pipeline/web-prototype/package.json pipeline/web-prototype/pnpm-lock.yaml pipeline/web-prototype/pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /workspace/pipeline/web-prototype/dist ./dist
COPY pipeline/web-prototype/server ./server
COPY pipeline/engines/melee/server /workspace/pipeline/engines/melee/server
COPY pipeline/engines/melee/tools /workspace/pipeline/engines/melee/tools
COPY pipeline/engines/melee/opensmash_melee /workspace/pipeline/engines/melee/opensmash_melee
COPY pipeline/engines/melee/runtime /workspace/pipeline/engines/melee/runtime
COPY pipeline/engines/melee/web/public/catalog.json /workspace/pipeline/engines/melee/web/public/catalog.json
COPY pipeline/web-prototype/shared ./shared
COPY pipeline/web-prototype/config ./config
COPY pipeline/web-prototype/visual ./visual
# The baked fighters are NOT in the image. config/baked-assets.json (copied
# with config/ above) pins every runtime file by SHA-256, and the API runs with
# BAKED_ASSET_SOURCE=remote so it serves the roster from that manifest and
# points browsers at the immutable objects in the public bucket. Keeping the
# ~3 GB roster out of the image is what makes builds, pushes and cold starts
# fast. play/ exists only so local-mode code paths never trip on a missing dir.
RUN mkdir -p /workspace/pipeline/play/ui
COPY BattleShip/web-dist/index.html BattleShip/web-dist/BattleShip.js BattleShip/web-dist/BattleShip.wasm BattleShip/web-dist/manifest.json /workspace/BattleShip/web-dist/
COPY BattleShip/web-dist/files /workspace/BattleShip/web-dist/files
# In-browser asset extraction (BattleShip/docs/web_rom_extraction.md): Torch
# compiled to wasm + the recipe tree, and the worker/stager scripts. Without
# these the engine has no way to obtain BattleShip.o2r, which is deliberately
# absent from files/. A missing source path fails the build here, on purpose.
COPY BattleShip/web-dist/torch /workspace/BattleShip/web-dist/torch
COPY BattleShip/web-dist/rom-extract.js BattleShip/web-dist/torch-worker.js /workspace/BattleShip/web-dist/

# Defense in depth: deploy.sh checks this before Cloud Build, and the image
# build independently rejects a ROM-derived archive if another build path
# ever includes one in the Docker context.
RUN test ! -e /workspace/BattleShip/web-dist/files/BattleShip.o2r
RUN chmod -R a+rX /workspace
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
