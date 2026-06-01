# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# GAAex frontend — production image (multi-stage)
# Stage 1: node:20-alpine builds the Vite bundle
# Stage 2: nginx:1.27-alpine serves /dist with SPA history fallback
# ---------------------------------------------------------------------------

# ============================================================================
# Stage 1: builder — compile the Vite/React SPA
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps from a clean lockfile (reproducible) before copying source so
# this layer caches when only source changes.
COPY package.json package-lock.json ./
RUN npm ci

# Now bring in the rest of the source
COPY . .

# Build-time API base URL — bake into the bundle. Override with
# `docker build --build-arg VITE_API_BASE=https://api.example.com`.
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}

RUN npm run build

# ============================================================================
# Stage 2: runtime — nginx serves the static bundle
# ============================================================================
FROM nginx:1.27-alpine AS runtime

# Inline nginx config: gzip on, long-cache static assets, SPA history fallback
# for client-side routes (try_files $uri /index.html).
RUN rm /etc/nginx/conf.d/default.conf \
 && printf '%s\n' \
    'server {' \
    '    listen 80;' \
    '    server_name _;' \
    '    root /usr/share/nginx/html;' \
    '    index index.html;' \
    '' \
    '    # gzip on text-like assets' \
    '    gzip on;' \
    '    gzip_vary on;' \
    '    gzip_min_length 1024;' \
    '    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;' \
    '' \
    '    # Long-cache hashed assets emitted by Vite' \
    '    location /assets/ {' \
    '        expires 1y;' \
    '        add_header Cache-Control "public, immutable";' \
    '        try_files $uri =404;' \
    '    }' \
    '' \
    '    # SPA history fallback — every unmatched path returns index.html' \
    '    location / {' \
    '        try_files $uri $uri/ /index.html;' \
    '    }' \
    '' \
    '    # Never cache index.html so deploys take effect immediately' \
    '    location = /index.html {' \
    '        add_header Cache-Control "no-store, no-cache, must-revalidate";' \
    '    }' \
    '}' \
    > /etc/nginx/conf.d/app.conf

# Copy the built SPA from the builder stage
COPY --from=builder /app/dist/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
