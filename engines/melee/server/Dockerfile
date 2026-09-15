FROM python:3.12-slim-bookworm
WORKDIR /app/engines/melee
COPY engines/melee/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY engines/melee/opensmash_melee ./opensmash_melee
COPY engines/melee/tools ./tools
COPY engines/melee/runtime ./runtime
COPY engines/melee/web/public/catalog.json ./web/public/catalog.json
ENV MELEE_BROWSER_BUILD=/inputs/browser OPENSMASH_CHARACTER_ROOT=/inputs/characters MELEE_SYS_ROOT=/inputs/sys
# /data must be a private writable conversion workspace, already provisioned
# with verified game templates. Neither the image nor the HTTP API accepts a disc.
CMD ["python", "tools/serve_hosted.py", "--host", "0.0.0.0", "--workspace", "/data"]
