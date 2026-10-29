# ─── Dependencias ───
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# ─── Build ───
# Esta etapa tiene el proyecto completo con Prisma, tsx y todas las
# herramientas. Se usa tambien como imagen de mantenimiento (servicio "tools"
# del compose) para correr migraciones y el seed, porque la imagen final es
# minima a proposito y no las lleva adentro.
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ─── Produccion ───
FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# La hora del local: horarios, promos por día, reportes y comandas dependen de esto
ENV TZ=America/Argentina/Buenos_Aires

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Las fotos subidas viven fuera de /public, en un volumen: Next.js solo sirve
# /public tal como estaba al momento del build.
RUN mkdir -p /app/data/uploads && chown -R nextjs:nodejs /app/data
ENV MEDIA_DIR=/app/data/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
