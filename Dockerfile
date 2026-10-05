# ---------------------------------------------------------------------------
#  Knowstead – Dokumentations- und Wissensmanagementsystem
#
#  Zwei Stufen: Die Oberfläche wird gebaut, der Server läuft direkt aus dem
#  TypeScript-Quelltext (Node 24 entfernt die Typen beim Laden).
# ---------------------------------------------------------------------------
FROM node:26-alpine AS build
WORKDIR /app

# Abhängigkeiten zuerst – bessere Schichtnutzung beim Neubauen
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build


FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    KNOWSTEAD_SERVICE=docker

# Texterkennung für gescannte PDFs und Bilder (optional): docker compose build --build-arg WITH_OCR=true
ARG WITH_OCR=false
RUN apk add --no-cache tini \
 && if [ "$WITH_OCR" = "true" ]; then apk add --no-cache tesseract-ocr tesseract-ocr-data-deu tesseract-ocr-data-eng; fi \
 && mkdir -p /app/data && chown -R node:node /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/plugins ./plugins
COPY --from=build --chown=node:node /app/docs ./docs
COPY --from=build --chown=node:node /app/web/dist ./web/dist
COPY --from=build --chown=node:node /app/CHANGELOG.md ./CHANGELOG.md

USER node
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]
