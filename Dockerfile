FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY index.html manifest.webmanifest sw.js _headers ./
COPY assets ./assets
COPY icons ./icons
COPY src ./src
COPY content ./content
COPY backend ./backend
COPY tools ./tools

RUN node tools/build.js && node tools/predeploy-check.js

ENV PORT=4183
ENV HOST=0.0.0.0
ENV ELGO_DATA_DIR=/data
ENV NODE_ENV=production

VOLUME ["/data"]
EXPOSE 4183

CMD ["node", "tools/node-server.js"]
