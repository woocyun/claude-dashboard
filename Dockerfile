FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
# No runtime npm deps — copy only the compiled output and static assets.
COPY --from=builder /app/dist ./dist
COPY public/ ./public/
EXPOSE 4317
CMD ["node", "dist/server.js"]
