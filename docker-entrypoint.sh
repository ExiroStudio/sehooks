#!/bin/bash
set -e

export HOME="${HOME:-/root}"
export DOCKER_CONFIG="${DOCKER_CONFIG:-/root/.docker}"

# Detect if Docker credentials exist in /root/.docker/config.json
if [ -f /root/.docker/config.json ]; then
  if grep -q "ghcr.io" /root/.docker/config.json 2>/dev/null; then
    echo "🔑 [sehooks] Detected ghcr.io credentials from /root/.docker/config.json"
  else
    echo "ℹ️ [sehooks] /root/.docker/config.json mounted, but no 'ghcr.io' entry found inside it"
  fi
  if grep -q "credsStore" /root/.docker/config.json 2>/dev/null; then
    echo "⚠️ [sehooks] Notice: 'credsStore' found in config.json. Host credential helpers (secretservice/pass) are not accessible inside containers."
  fi
else
  echo "ℹ️ [sehooks] No /root/.docker/config.json detected."
fi

# If Docker daemon socket is mounted, check if auto-login via environment variables is requested
if [ -S /var/run/docker.sock ]; then
  # Auto-login to GitHub Container Registry (ghcr.io)
  if [ -n "${GHCR_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; then
    _TOKEN="${GHCR_TOKEN:-$GITHUB_TOKEN}"
    _USER="${GHCR_USERNAME:-${GITHUB_USER:-${USER:-docker}}}"
    # If /root/.docker is read-only or not writable, use /tmp/.docker so login can store config
    if ! touch /root/.docker/.writable_test 2>/dev/null; then
      export DOCKER_CONFIG=/tmp/.docker
      mkdir -p "$DOCKER_CONFIG"
    else
      rm -f /root/.docker/.writable_test
    fi
    if echo "$_TOKEN" | docker login ghcr.io -u "$_USER" --password-stdin >/dev/null 2>&1; then
      echo "🔑 [sehooks] Logged in to ghcr.io successfully as '$_USER'"
    else
      echo "⚠️ [sehooks] Warning: Failed to log in to ghcr.io with provided token"
    fi
  fi

  # Auto-login to custom / Docker Hub registry
  if [ -n "${DOCKER_PASSWORD:-}" ] && [ -n "${DOCKER_USERNAME:-}" ]; then
    _REGISTRY="${DOCKER_REGISTRY:-}"
    if ! touch /root/.docker/.writable_test 2>/dev/null; then
      export DOCKER_CONFIG=/tmp/.docker
      mkdir -p "$DOCKER_CONFIG"
    else
      rm -f /root/.docker/.writable_test
    fi
    if echo "$DOCKER_PASSWORD" | docker login $_REGISTRY -u "$DOCKER_USERNAME" --password-stdin >/dev/null 2>&1; then
      echo "🔑 [sehooks] Logged in to ${_REGISTRY:-Docker Hub} as '$DOCKER_USERNAME'"
    else
      echo "⚠️ [sehooks] Warning: Failed to log in to ${_REGISTRY:-Docker Hub}"
    fi
  fi
fi

exec "$@"
