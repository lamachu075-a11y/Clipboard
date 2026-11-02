#!/usr/bin/env bash
# Host Clipboard Extractor on its own subdomain with Nginx, next to the
# apps already on this server. Run it on the server, as root (sudo).
#
#   sudo bash deploy/setup-subdomain.sh <subdomain> <email> [--files DIR] [--no-https] [--force]
#
#   <subdomain>   e.g. clip.example.com (its DNS A record must point to this server)
#   <email>       for the Let's Encrypt certificate (expiry notices)
#   --files DIR   copy the built site from DIR (the "out" folder of `npm run build`)
#   --no-https    skip the certificate (the app then only works with Ctrl/⌘+V / Paste)
#   --force       replace this script's own config for the subdomain if it exists
#
# Safe for existing apps: it only adds a new site file for <subdomain>, checks
# the whole Nginx config before reloading, and removes its file again if the
# check fails. Other sites are never edited.
set -euo pipefail

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mWarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

DOMAIN="" EMAIL="" FILES="" HTTPS=1 FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --files) FILES="${2:-}"; shift 2 ;;
    --no-https) HTTPS=0; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage ;;
    -*) die "unknown option $1" ;;
    *) if [ -z "$DOMAIN" ]; then DOMAIN="$1"; elif [ -z "$EMAIL" ]; then EMAIL="$1"; else die "unexpected argument $1"; fi; shift ;;
  esac
done
[ -n "$DOMAIN" ] || usage
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] || die "\"$DOMAIN\" is not a valid domain name"
[ "$HTTPS" = 0 ] || [ -n "$EMAIL" ] || die "give an email for the HTTPS certificate, or use --no-https"
[ "$(id -u)" = 0 ] || die "run as root: sudo bash $0 $*"
command -v nginx >/dev/null || die "Nginx is not installed. If your server uses Apache or Caddy, the config in deploy/README.md shows the equivalent."

# Where things go (Debian/Ubuntu layout, with a fallback to conf.d).
WEB_ROOT="${WEB_ROOT:-/var/www/$DOMAIN}"
if [ -d /etc/nginx/sites-available ] && [ -d /etc/nginx/sites-enabled ]; then
  CONF="/etc/nginx/sites-available/$DOMAIN"
  LINK="/etc/nginx/sites-enabled/$DOMAIN"
else
  CONF="/etc/nginx/conf.d/$DOMAIN.conf"
  LINK=""
fi
MARK="# Managed by Clipboard Extractor deploy/setup-subdomain.sh"
# Listen on IPv6 too, but only where the server has it (otherwise Nginx refuses to start).
LISTEN6=""
[ -s /proc/net/if_inet6 ] && LISTEN6="listen [::]:80;"

# Never take over a subdomain another config already serves.
if [ -e "$CONF" ] && ! grep -qF "$MARK" "$CONF"; then
  die "$CONF already exists and was not created by this script. Pick another subdomain or remove it yourself."
fi
if [ -e "$CONF" ] && [ "$FORCE" = 0 ]; then
  say "$DOMAIN is already set up; updating files only (use --force to rewrite its Nginx config)"
  SKIP_CONF=1
else
  SKIP_CONF=0
fi
DOMAIN_RE="${DOMAIN//./\\.}"
OTHER=""
for f in $(grep -rlsE "server_name[^;]*[[:space:]]${DOMAIN_RE}[[:space:];]" /etc/nginx/ || true); do
  [ "$(readlink -f "$f")" = "$(readlink -f "$CONF")" ] && continue
  OTHER="$OTHER $f"
done
[ -z "$OTHER" ] || die "$DOMAIN is already used in:$OTHER"

# 1. Site files.
mkdir -p "$WEB_ROOT"
if [ -n "$FILES" ]; then
  [ -f "$FILES/index.html" ] || die "$FILES/index.html not found: pass the \"out\" folder of npm run build"
  say "Copying the site to $WEB_ROOT"
  if command -v rsync >/dev/null; then rsync -a --delete "$FILES"/ "$WEB_ROOT"/; else rm -rf "${WEB_ROOT:?}"/*; cp -a "$FILES"/. "$WEB_ROOT"/; fi
elif [ ! -f "$WEB_ROOT/index.html" ]; then
  cat > "$WEB_ROOT/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>Clipboard Extractor</title>
<p style="font:16px system-ui;margin:3em">The subdomain works. Upload the built app (the <code>out</code> folder) here to finish.</p>
HTML
  warn "no --files given: put the built app in $WEB_ROOT (a placeholder page is there for now)"
fi
chmod -R a+rX "$WEB_ROOT"

# 2. Nginx site.
if [ "$SKIP_CONF" = 0 ]; then
  say "Writing $CONF"
  BACKUP=""
  [ -e "$CONF" ] && BACKUP=$(mktemp) && cp "$CONF" "$BACKUP"
  cat > "$CONF" <<NGINX
$MARK
server {
    listen 80;
    $LISTEN6
    server_name $DOMAIN;

    root $WEB_ROOT;
    index index.html;

    # Pages are exported with trailing slashes: /admin/ -> /admin/index.html
    location / {
        try_files \$uri \$uri/ \$uri.html =404;
    }

    # Build files have content hashes in their names: cache them for a year.
    location /_next/static/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    error_page 404 /404.html;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
}
NGINX
  [ -z "$LINK" ] || ln -sf "$CONF" "$LINK"
  if ! nginx -t 2>/tmp/nginx-test.log; then
    cat /tmp/nginx-test.log >&2
    if [ -n "$BACKUP" ]; then cp "$BACKUP" "$CONF"; else rm -f "$CONF" ${LINK:+"$LINK"}; fi
    die "the Nginx config check failed (see above), so Nginx was not changed and your sites keep running as before"
  fi
fi
say "Reloading Nginx (your other sites keep running)"
if systemctl is-active --quiet nginx 2>/dev/null; then systemctl reload nginx; else nginx -s reload 2>/dev/null || nginx; fi

# Check the server answers for the subdomain (the reload takes a moment).
if command -v curl >/dev/null; then
  ok=0
  for _ in 1 2 3 4 5; do
    sleep 1
    if curl -s -H "Host: $DOMAIN" http://127.0.0.1/ | grep -qE "Clipboard Extractor|The subdomain works"; then ok=1; break; fi
  done
  if [ "$ok" = 1 ]; then say "Nginx is serving $DOMAIN"; else warn "Nginx did not answer for $DOMAIN on this machine yet; check with: curl -H 'Host: $DOMAIN' http://127.0.0.1/"; fi
fi

# 3. HTTPS (needed for automatic clipboard reading).
SCHEME=http
if [ "$HTTPS" = 1 ]; then
  if grep -q "listen .*443" "$CONF"; then
    say "HTTPS is already set up for $DOMAIN"
    SCHEME=https
  elif ! command -v certbot >/dev/null; then
    warn "certbot is not installed, so the site is on http:// for now. Install it and re-run:"
    echo "    sudo apt install certbot python3-certbot-nginx"
  else
    say "Getting an HTTPS certificate for $DOMAIN"
    if certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect; then
      SCHEME=https
    else
      warn "the certificate failed. Usually the DNS record for $DOMAIN does not point to this server yet."
      echo "    Check with:  dig +short $DOMAIN    then re-run this script."
    fi
  fi
fi

say "Done: $SCHEME://$DOMAIN"
echo "    To update the app later: copy a new build with --files, e.g."
echo "    sudo bash deploy/setup-subdomain.sh $DOMAIN $EMAIL --files out"
