FROM node:22-alpine

WORKDIR /app
COPY server.js index.html ./
COPY css ./css
COPY js ./js
COPY assets ./assets

# Imported chats, settings and the custom background live here; mount it as a volume.
RUN mkdir -p /data && chown node:node /data
ENV PORT=8080 HOST=0.0.0.0 DATA_DIR=/data
VOLUME /data
EXPOSE 8080

USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server.js"]
