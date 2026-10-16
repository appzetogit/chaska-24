#!/usr/bin/env bash
#
# Redeploy chaska24by7.com from the latest `main` on this box.
#
# Pulls the repo, installs backend deps, applies any new migrations, reloads
# the PM2 processes with zero downtime, then builds and publishes the
# frontend. Run this ON THE SERVER, from anywhere, as root:
#
#   bash /var/www/chaska/deploy/deploy.sh
#
# A failed step stops the script (set -e) rather than leaving the box in a
# half-deployed state with stale code half-applied.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

echo "==> Pulling latest main"
git fetch origin main
git reset --hard origin/main

echo "==> Backend: installing dependencies"
cd "$REPO/Backend"
npm install

echo "==> Backend: applying migrations + constraints + prisma generate"
npm run db:migrate

echo "==> Backend: reloading PM2 processes (zero-downtime)"
cd "$REPO"
pm2 reload deploy/ecosystem.config.cjs --update-env
pm2 save

echo "==> Frontend: building and publishing"
bash "$REPO/deploy/scripts/deploy-frontend.sh"

echo "==> Verifying"
sleep 2
curl -fsS http://localhost:5000/health && echo
curl -fsS -o /dev/null -w 'frontend: %{http_code}\n' -H 'Host: chaska24by7.com' http://localhost/

echo "==> Done"
