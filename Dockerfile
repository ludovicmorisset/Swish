FROM node:22-alpine

ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY --chown=node:node server.mjs package.json index.html public.html privacy.html manifest.webmanifest sw.js QUICKSTART.md README.md ./
COPY --chown=node:node src/ ./src/
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server.mjs"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e 'fetch("http://127.0.0.1:8080/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
