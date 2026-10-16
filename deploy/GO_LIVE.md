# Go live on chaska24by7.com

Target host: single VM, `187.127.151.210` (root access over SSH key
`~/.ssh/chaska_deploy` on the deploying machine). Ubuntu 26.04, 2 vCPU, 7.7 GB
RAM, 95 GB disk.

| Host                     | Serves                    | Backed by                        |
| ------------------------ | -------------------------- | --------------------------------- |
| `chaska24by7.com`, `www` | frontend SPA               | static build in `/srv/chaska/admin` |
| `api.chaska24by7.com`    | API + socket + uploads     | PM2 `chaska-*`, ports 5000/5001   |

No AWS, no RDS, no S3, no Cloudflare. Postgres + PostGIS and Redis run on the
same box as the app. Uploaded files are written to local disk
(`/srv/chaska/uploads`) and served directly by nginx.

The repo is checked out at `/var/www/chaska`. Served content lives under
`/srv/chaska` instead — serving out of the working tree would expose `.git`
and a redeploy that touches the tree would take the uploads with it.

## Done (initial deploy)

- Node 22, PostgreSQL 18 + PostGIS, Redis, nginx, certbot, PM2 installed.
- 2 GB swap added.
- `ufw` enabled: OpenSSH, 80, 443 only.
- Database `chaska` created, role `chaska` (password generated, see secrets
  note below), `postgis` extension enabled, `random_page_cost` tuned to 1.1.
- All 34 migrations + `constraints.sql` applied, Prisma client generated.
- `Backend/.env` written for production: fresh JWT secrets and `DEPLOY_SECRET`,
  the same SMS/Firebase/SMTP/Maps credentials already in use locally,
  `CORS_ORIGINS` set to the two frontend hosts, `UPLOAD_STORAGE_ROOT=/srv/chaska/uploads`.
- `Frontend/.env.production` written with `VITE_API_BASE_URL=https://api.chaska24by7.com/api/v1`.
- nginx vhosts for both hosts, HTTP only (port 80) — certbot adds the 443
  block and redirect once DNS resolves; see "TLS" below.
- PM2 running `chaska-api` (cluster), `chaska-socket`, `chaska-scheduler`,
  `chaska-worker-order`, `chaska-worker-tracking` (queues are on: Redis is
  local). `pm2 startup` + `pm2 save` done, survives a reboot.
- One super admin account seeded (see secrets note).

## Not done yet — needs your input

- **TLS.** Blocked on DNS (see below). nginx is serving plain HTTP right now.
- **Razorpay is on TEST keys**, copied from local dev. Replace
  `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` in
  `/var/www/chaska/Backend/.env` with live keys before accepting real payments,
  then `pm2 reload chaska-api`.
- **Mobile app links** (`ANDROID_PACKAGE_NAME`, `ANDROID_SHA256_FINGERPRINTS`,
  store URLs) are blank — fill in when the apps exist.

## 1. DNS

Add these A records at your domain registrar / DNS provider, pointing at the
server:

    chaska24by7.com         A   187.127.151.210
    www.chaska24by7.com     A   187.127.151.210
    api.chaska24by7.com     A   187.127.151.210

No proxy (no Cloudflare orange-cloud) — DNS-only, so certbot's HTTP-01
challenge can reach the box directly. Confirm propagation before issuing
certificates:

    dig +short chaska24by7.com
    dig +short api.chaska24by7.com

## 2. TLS (run once DNS resolves)

    ssh -i ~/.ssh/chaska_deploy root@187.127.151.210
    certbot --nginx -d chaska24by7.com -d www.chaska24by7.com -d api.chaska24by7.com

certbot edits the nginx vhosts in place (adds `listen 443 ssl` + redirect) and
sets up auto-renewal via its own systemd timer — nothing else to configure.
After it runs, update:

    Backend/.env:              FRONTEND_URL, CORS_ORIGINS -> already https, no change needed
    Frontend/.env.production:  VITE_API_BASE_URL, VITE_UPLOAD_BASE_URL -> already https, no change needed

(Already written as `https://...` in both files, so TLS "just works" once
certbot runs — no rebuild needed for that part.)

## 3. Secrets

Generated during setup, not in git. Written directly into `Backend/.env` on
the server and given to you in chat — if you've lost them:

    ssh -i ~/.ssh/chaska_deploy root@187.127.151.210
    grep -E 'DATABASE_URL|JWT_|DEPLOY_SECRET' /var/www/chaska/Backend/.env

To reset the admin password:

    cd /var/www/chaska/Backend
    ADMIN_EMAIL=admin@chaska24by7.com ADMIN_PASSWORD='new-password' node scripts/seed-admin.mjs

## 4. Redeploying

From the server:

    bash /var/www/chaska/deploy/deploy.sh

Pulls `main`, reinstalls backend deps, applies any new migrations, reloads
PM2 with zero downtime, then builds and publishes the frontend (keeping the
previous build's hashed chunks so open tabs don't 404 — see
`deploy/scripts/deploy-frontend.sh`).

## 5. Verify

    curl -sS https://api.chaska24by7.com/health
    curl -sSI -H 'Origin: https://chaska24by7.com' https://api.chaska24by7.com/api/v1/health

Then load `https://chaska24by7.com`, sign in at `/admin` with the seeded
account, open an order. The console should show a `/socket.io/` upgrade and
no CORS or mixed-content errors, and images should load from
`api.chaska24by7.com/uploads/` or `chaska24by7.com/uploads/`.

## CORS

    CORS_ORIGINS=https://chaska24by7.com,https://www.chaska24by7.com

If this list is wrong the symptom is a browser CORS error, but check
`/health` first — when the backend is down nginx's own 502 page carries no
CORS header either, and that looks identical from the browser's console.
