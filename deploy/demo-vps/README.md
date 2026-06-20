# TerraOS demo — VPS deployment (Ubuntu)

Public, TLS-secured demo for prospects. Caddy fronts the stack and obtains a
certificate automatically; an hourly cron resets the demo to a clean state.

## 1. Prerequisites

- An Ubuntu 22.04+ VPS (Hetzner CX22 / Scaleway DEV1-S are plenty).
- A DNS `A` record pointing your domain (e.g. `demo.example.com`) at the VPS IP.
- Docker + Compose plugin:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```

## 2. Get the code

```bash
sudo mkdir -p /opt/terraos && sudo chown "$USER" /opt/terraos
git clone <your-repo-url> /opt/terraos
cd /opt/terraos
```

## 3. Configure secrets

Create `/opt/terraos/.env` (read by Compose):

```ini
DEMO_DOMAIN=demo.example.com
JWT_SECRET=<openssl rand -hex 32>
DEMO_VIEWER_PASSWORD=<choose>
DEMO_OPERATOR_PASSWORD=<choose>
DEMO_ADMIN_PASSWORD=<choose-strong>
```

> The admin password powers `/demo/reset` and the cron. Keep it strong — the
> demo accounts are intentionally easy to share with prospects, the admin is not.

## 4. Launch

```bash
set -a; . ./.env; set +a
docker compose -f docker-compose.demo.yml -f deploy/demo-vps/compose.caddy.yml up -d --build
```

Caddy provisions HTTPS within a minute. Visit `https://demo.example.com` and log
in with `demo-operator@terraos.app`.

## 5. Hourly auto-reset

```bash
chmod +x deploy/demo-vps/reset-demo.sh
# Edit crontab.example: set your domain + admin password (or source an env file)
crontab deploy/demo-vps/crontab.example
```

Verify a manual run:

```bash
API_URL=https://demo.example.com DEMO_ADMIN_PASSWORD=... ./deploy/demo-vps/reset-demo.sh
```

## 6. Operations

```bash
# logs
docker compose -f docker-compose.demo.yml -f deploy/demo-vps/compose.caddy.yml logs -f scenario-player
# update
git pull && docker compose -f docker-compose.demo.yml -f deploy/demo-vps/compose.caddy.yml up -d --build
# stop
docker compose -f docker-compose.demo.yml -f deploy/demo-vps/compose.caddy.yml down
```

See [`../../docs/demo.md`](../../docs/demo.md) for the architecture and the
client-meeting checklist.
