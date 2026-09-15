FROM debian:12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 ninja-build ca-certificates libc6-i386 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work/build/engine-linux
