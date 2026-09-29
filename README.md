# sehooks (Script Execution Hooks) 🪝🚀

A lightweight, self-contained webhook management and script execution server with a built-in web dashboard, SQLite database, and execution logging.

[![Release](https://github.com/ExiroStudio/script-execution-hooks/actions/workflows/release.yml/badge.svg)](https://github.com/ExiroStudio/script-execution-hooks/actions/workflows/release.yml)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io-blue?logo=docker)](https://github.com/ExiroStudio/sehooks/pkgs/container/script-execution-hooks)

---

## ✨ Features

- ⚡ **Pure Go & Embedded UI**: Single static binary with zero external runtime dependencies.
- 🗄️ **Zero-Config SQLite**: Built-in SQLite database engine with automatic schema migrations.
- 🔒 **Authenticated Dashboard**: Clean web SPA to manage scripts, hooks, and inspect stdout/stderr logs.
- 🐚 **Safe Shell Execution**: Asynchronous script execution with timeout control, isolated env vars, and exit codes.
- 🐳 **Docker-Ready**: Multi-arch images (`linux/amd64`, `linux/arm64`) with `bash`, `curl`, `git`, `jq`, `docker-cli`, and `openssh-client` included.

---

## 🚀 Quick Start with Docker

### 1. Run with Docker CLI

Pull and run the latest image directly from GitHub Container Registry:

```bash
docker run -d \
  --name sehooks \
  --restart unless-stopped \
  -p 8080:8080 \
  -v sehooks_data:/data \
  -e SEH_ADMIN_PASSWORD=my_strong_password \
  ghcr.io/exirostudio/sehooks:latest
```

Open your browser and navigate to `http://localhost:8080` to access the dashboard. Log in using `admin` and your password.

---

### 2. Run with Docker Compose

Create a `docker-compose.yml` file:

```yaml
services:
  sehooks:
    image: ghcr.io/exirostudio/sehooks:latest
    container_name: sehooks
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - SEH_ADMIN_PASSWORD=my_strong_password
      - SEH_SECRET_KEY=generate_a_random_secret_here
      - SEH_PORT=8080
      - SEH_DB_PATH=/data/hooks.db
    volumes:
      - sehooks_data:/data
      # Optional: Mount host Docker socket if your scripts trigger Docker actions on the host
      # - /var/run/docker.sock:/var/run/docker.sock
      # Optional: Mount host workspace or repository directory
      # - /var/www:/var/www

volumes:
  sehooks_data:
```

Start the service:

```bash
docker compose up -d
```

---

## ⚙️ Environment Variables

| Variable | Description | Default |
|---|---|---|
| `SEH_HOST` | Host address to bind the HTTP server | `0.0.0.0` |
| `SEH_PORT` | Port for web UI and webhook API | `8080` |
| `SEH_DB_PATH` | Path to the SQLite database file | `/data/hooks.db` *(Docker)* / `./hooks.db` *(local)* |
| `SEH_ADMIN_PASSWORD` | Password for the admin dashboard | `admin` |
| `SEH_SECRET_KEY` | Secret key used for session signing | `change-me-in-production` |

---

## 🛠️ Script Execution Inside Docker

Scripts execute inside the container using `/bin/bash`. The Docker image comes pre-installed with tools commonly needed for deployment workflows:
- `bash` (default execution shell)
- `curl` & `ca-certificates` (HTTP requests, API triggers)
- `git` & `openssh-client` (Repository cloning, SSH deployment)
- `jq` (JSON parsing)
- `docker-cli` (Managing host containers via mounted `/var/run/docker.sock`)

### Triggering Host Docker Commands
If you want `sehooks` to deploy or restart containers on the host machine, mount the host's Docker socket:
```bash
-v /var/run/docker.sock:/var/run/docker.sock
```
Your script can then run standard Docker commands:
```bash
docker compose -f /var/www/my-app/docker-compose.yml pull
docker compose -f /var/www/my-app/docker-compose.yml up -d
```

---

## 📡 Triggering Webhooks

Once a hook is created in the dashboard, trigger it using a `POST` request with the hook's secret token:

```bash
curl -X POST http://your-server:8080/webhook/<secret_token>
```

Sample JSON response:
```json
{
  "ok": true,
  "message": "hook triggered, script is running",
  "hook": "Deploy Production",
  "log_id": 42
}
```

Scripts execute asynchronously in the background. You can monitor output (`stdout`, `stderr`, duration, status) in real time in the web dashboard or via `/api/logs`.

---

## 🔨 Building Locally

### Using Go:
```bash
go build -ldflags "-s -w" -o sehooks .
./sehooks
```

### Using Docker:
```bash
docker build -t sehooks:local .
docker run -p 8080:8080 sehooks:local
```

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
