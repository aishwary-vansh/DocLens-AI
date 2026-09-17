FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
FROM deps AS build
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY generated ./generated
COPY src ./src
COPY tsconfig.json ./tsconfig.json
RUN npx prisma generate
RUN npm run build
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
RUN mkdir -p uploads
EXPOSE 3001
CMD ["node", "dist/src/main.js"]