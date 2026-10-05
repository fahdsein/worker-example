FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server.js shared.js database.js queue.js task.js ./
COPY --chown=node:node public ./public

USER node
EXPOSE 3000
CMD ["npm", "start"]
