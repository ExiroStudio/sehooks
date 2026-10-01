# syntax=docker/dockerfile:1

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS builder

WORKDIR /src

# Download Go dependencies first for layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code and embedded static assets
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags "-s -w -extldflags '-static'" \
    -o /app/sehooks \
    .

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM alpine:3.21

# Install bash (required by internal/executor) and common utilities for webhook scripts
RUN apk add --no-cache \
    bash \
    ca-certificates \
    curl \
    jq \
    git \
    openssh-client \
    tzdata \
    docker-cli

# Directory for SQLite database persistence
RUN mkdir -p /data

# Default environment configuration
ENV SEH_HOST=0.0.0.0 \
    SEH_PORT=8080 \
    SEH_DB_PATH=/data/hooks.db \
    HOME=/root \
    DOCKER_CONFIG=/root/.docker

WORKDIR /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

COPY --from=builder /app/sehooks /app/sehooks

EXPOSE 8080

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f -s http://127.0.0.1:${SEH_PORT}/ > /dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["/app/sehooks"]
