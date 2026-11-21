# SRK Film Studio: web app + film worker in one image.
# Contains Node 22, ffmpeg 7, Python 3.11, headless Chromium, the SRK-Opuscar library and the app.
FROM node:22-bookworm-slim

ARG SRK_REPO=https://github.com/rajkumarsurgeon34-droid/SRK-Opuscar.git
ARG SRK_REF=main
# 1 = also install the narration (TTS + speech check) and plucked-strings tiers (~0.7 GB more)
ARG WITH_VOICE=1
ARG WITH_MUSIC=1

ENV DEBIAN_FRONTEND=noninteractive \
    SRK_OPUSCAR_HOME=/opt/srk-opuscar \
    DATA_DIR=/data \
    LEMO_ANGLE=swiftshader \
    NODE_ENV=production

# System tools. Debian's ffmpeg is 5.x and the library needs 7+, so use a static build.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl xz-utils python3 python3-venv python3-pip \
      fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
  && curl -fsSL https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz \
     | tar -xJ -C /tmp \
  && mv /tmp/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg /tmp/ffmpeg-master-latest-linux64-gpl/bin/ffprobe /usr/local/bin/ \
  && rm -rf /tmp/ffmpeg-master-latest-linux64-gpl /var/lib/apt/lists/* \
  && ffmpeg -version | head -1

# The style library (guides, core tools, every STYLE.md; demo sources are fetched on demand).
RUN git clone --depth 1 --filter=blob:none --sparse --branch "$SRK_REF" "$SRK_REPO" "$SRK_OPUSCAR_HOME" \
  && cd "$SRK_OPUSCAR_HOME" \
  && git sparse-checkout set --no-cone '/*' '!/styles/*/demo/' '!/styleboard/' '!/docs/readme/' '!/docs/cover.jpg' '!/styles/*/poster.jpg' \
  && git config lemo.managed true \
  && npm install --no-audit --no-fund --loglevel=error \
  && git checkout -q -- package.json package-lock.json \
  && node node_modules/playwright-core/cli.js install-deps chromium-headless-shell \
  && rm -rf /var/lib/apt/lists/* \
  && chown -R node:node "$SRK_OPUSCAR_HOME"

USER node
# Package tiers, installed by the library's own setup script (as the user that runs the films).
RUN cd "$SRK_OPUSCAR_HOME" && S=plugin/skills/srk-opuscar/scripts/setup.sh \
  && TIERS="" && [ "$WITH_VOICE" = 1 ] && TIERS="$TIERS voice"; [ "$WITH_MUSIC" = 1 ] && TIERS="$TIERS music"; \
     sh "$S" deps $TIERS && sh "$S"

# The app.
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error
COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

USER root
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
