# sehooks (Script Execution Hooks) 🪝🚀

A lightweight, self-contained webhook management and script execution server with a built-in web dashboard, SQLite database, and execution logging.

[![Release](https://github.com/ExiroStudio/script-execution-hooks/actions/workflows/release.yml/badge.svg)](https://github.com/ExiroStudio/script-execution-hooks/actions/workflows/release.yml)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io-blue?logo=docker)](https://github.com/ExiroStudio/sehooks/pkgs/container/script-execution-hooks)

---

## ✨ Features

- ⚡ **Pure Go & Embedded UI**: Single static binary with zero external runtime dependencies.
- 🗄️ **Zero-Config SQLite**: Built-in SQLite database engine with automatic schema migrations.
- 🔒 **Authenticated Dashboard**: Clean web SPA to manage scripts, hooks, and inspect stdout/stderr logs.
- 🔐 **Encrypted Environments**: AES-256-GCM encrypted `.env` storage with automated backend deployment helpers.
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
| `SEH_SECRET_KEY` | Secret key used for session signing and AES-256-GCM encryption of environment secrets | `change-me-in-production` |

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

### 🔑 Private Registry Authentication (e.g. ghcr.io)
When running `docker pull ghcr.io/...` inside `sehooks`, the Docker client inside the container needs credentials. Choose either of these two methods:

#### Method 1: Inherit Host Credentials (Recommended)
If you already executed `docker login ghcr.io` on your host machine, mount your host's Docker configuration directory:
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  - ${HOME}/.docker:/root/.docker:ro
```
> [!NOTE]
> Ensure `docker login ghcr.io` was executed by the same host user running `docker compose`. If using `sudo docker compose`, mount `/home/youruser/.docker:/root/.docker:ro` explicitly.

#### Method 2: Automatic Login via Environment Variables
Pass your credentials as container environment variables. The built-in entrypoint will automatically authenticate on container startup:
```yaml
environment:
  - GHCR_TOKEN=ghp_your_github_personal_access_token
  - GHCR_USERNAME=your_github_username   # optional
```
For Docker Hub or custom private registries:
```yaml
environment:
  - DOCKER_REGISTRY=registry.example.com # optional, defaults to Docker Hub
  - DOCKER_USERNAME=myuser
  - DOCKER_PASSWORD=mypassword
```

---

## 🔐 Environment Variables & Automated Backend Deployments

sehooks provides a built-in **Environments Manager** designed for automated CI/CD and backend deployments. You can create environment profiles (e.g. `Production Backend`, `Staging`, `Worker`) and link them to **Scripts** or **Hooks**.

### 🛡️ Security Features
- **AES-256-GCM Encryption**: Variables marked as `Secret` are encrypted at-rest in the SQLite database using a 256-bit key derived via SHA-256 from `SEH_SECRET_KEY`.
- **Restricted Permissions**: When a script runs, the temporary environment file is created with strict `0600` permissions (`-rw-------`), accessible only by the current process user.
- **Auto-Cleanup**: The temporary environment file is automatically shredded/deleted immediately when script execution finishes.

### 📋 Managing Environments in the Dashboard
1. Navigate to **Environments** in the sidebar.
2. Click **+ New Environment** and enter a name (e.g., `Prod Backend`).
3. Add variables using the interactive **Key-Value Editor**, or click **Import .env** to paste a raw `.env` file directly.
4. Toggle the 🔒 icon on any row to mark sensitive values (such as `DB_PASSWORD`, `API_KEY`, `JWT_SECRET`) as encrypted secrets.
5. In **Scripts** or **Hooks**, select your environment profile from the **Environment Profile** dropdown.

### 🚀 Using in Deployment Scripts

When a script with an attached environment runs, sehooks provides:
1. **Direct Shell Variables**: Each key is exported into the shell environment (`$DB_HOST`, `$PORT`, etc.).
2. **`$SEH_ENV_FILE`**: An environment variable pointing to the temporary `.env` file.
3. **`seh_import_env [target_path]`**: A built-in shell helper function that safely copies the environment file into your target project directory (default: `./.env`) with `chmod 0600`.

#### Backend Deployment Example:
```bash
#!/bin/bash
set -e

cd /var/www/my-api-server

# Pull latest code
git pull origin main

# Safely copy and sync .env for the backend service (defaults to ./.env)
seh_import_env

# Or specify a custom target path:
# seh_import_env config/.env.production

# Restart Docker containers or systemd service
docker compose down
echo "Deployment completed successfully!"
```

---

## 🐳 Docker Compose & Additional Files (e.g. `nginx.conf`)

sehooks supports native **Docker Compose** projects alongside standard Bash scripts, as well as managing **Additional Files**:

### 1. Execution Methods:
- **🐧 Bash Script (`bash`)**: Traditional shell script execution with built-in helpers.
- **🐳 Docker Compose (`docker_compose`)**: Dedicated runner for Docker Compose. The main editor stores `docker-compose.yml`, environment profiles automatically sync into `.env`, and your custom compose commands (e.g. `docker compose up -d --build --remove-orphans`) run safely with process isolation.

### 2. Additional Files:
Attach auxiliary configuration files to any script or compose project:
- `nginx.conf`, `conf.d/app.conf`
- `Dockerfile`
- Application configuration files (`config.yaml`, `init.sql`, etc.)

Before execution begins, sehooks validates relative paths against directory traversal and writes these files directly into the project's `working_dir` so they are immediately accessible to bind mounts and scripts.

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
