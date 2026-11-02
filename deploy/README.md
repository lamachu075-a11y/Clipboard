# Host Clipboard Extractor on a subdomain of your server

This puts the app on its own subdomain (for example `https://clip.example.com`) on a server
that already runs other sites with **Nginx**. Your existing apps keep running: the script only
adds a new site for the subdomain, checks the whole Nginx configuration before reloading, and
undoes its change if anything is wrong.

The app is a static site (`npm run build` → `out/`), so the server only serves files: no Node
process or extra port is needed.

## 1. Point the subdomain at your server

At your domain registrar or DNS provider, add an **A record**:

| Type | Name | Value |
| --- | --- | --- |
| A | `clip` (or any name you like) | your server's IP address |

Check it (it can take a few minutes): `dig +short clip.example.com` should print your server's IP.

## 2. One-time server preparation

SSH into the server, then:

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx   # HTTPS certificates
sudo ufw allow 'Nginx Full' 2>/dev/null || true      # open ports 80 and 443 if you use ufw
```

## 3. Build and install

Pick **A** if the server has Node.js 22.18 or newer (`node -v`), otherwise **B**.

### A. Build on the server

```bash
git clone https://github.com/lamachu075-a11y/Clipboard.git clipboard-extractor
cd clipboard-extractor
npm ci
npm run build
sudo bash deploy/setup-subdomain.sh clip.example.com you@example.com --files out
```

(If the repository is private, `git clone` asks for your GitHub username and a
[personal access token](https://github.com/settings/tokens) as the password.)

### B. Build on your computer, upload to the server

On your computer, in the project folder:

```bash
npm ci
npm run build
scp -r out deploy user@SERVER_IP:~/clipboard-extractor/
```

Then on the server:

```bash
sudo bash ~/clipboard-extractor/deploy/setup-subdomain.sh clip.example.com you@example.com --files ~/clipboard-extractor/out
```

The script prints each step and ends with `Done: https://clip.example.com`.

## Updating the app later

Build again and run the same command: it copies the new files and leaves the Nginx config and
certificate as they are.

```bash
git pull && npm ci && npm run build          # (on your computer for option B, then scp the out folder)
sudo bash deploy/setup-subdomain.sh clip.example.com you@example.com --files out
```

## Script options

```
sudo bash deploy/setup-subdomain.sh <subdomain> <email> [--files DIR] [--no-https] [--force]
```

| Option | What it does |
| --- | --- |
| `--files DIR` | copy the built site from `DIR` (the `out` folder) to `/var/www/<subdomain>` |
| `--no-https` | skip the certificate (automatic clipboard reading then doesn't work: Ctrl/⌘+V and Paste still do) |
| `--force` | rewrite the script's own Nginx config for the subdomain (run it again without `--no-https` afterwards to restore HTTPS) |
| `WEB_ROOT=/path` | (environment variable) serve the files from another folder |

Safety checks: the script refuses a subdomain that another site already uses, never overwrites
a config file it did not create, and if `nginx -t` fails it removes its own file so Nginx and
your sites stay exactly as before.

## Troubleshooting

- **"the certificate failed"**: the DNS record doesn't point to this server yet, or port 80 is
  blocked. Fix that and run the script again.
- **"Automatic reading needs an https:// address"** in the app: the site is on `http://`. Run the
  script again without `--no-https` once certbot is installed.
- **Other web servers.** If your server uses **Apache** instead of Nginx, the equivalent site is:

  ```apache
  <VirtualHost *:80>
      ServerName clip.example.com
      DocumentRoot /var/www/clip.example.com
      <Directory /var/www/clip.example.com>
          Options -Indexes
          AllowOverride None
          Require all granted
          FallbackResource /404.html
      </Directory>
  </VirtualHost>
  ```

  then `sudo a2ensite clip.example.com && sudo systemctl reload apache2 && sudo certbot --apache -d clip.example.com`.

  With **Caddy** (HTTPS is automatic), add to the Caddyfile:

  ```
  clip.example.com {
      root * /var/www/clip.example.com
      try_files {path} {path}/ {path}.html
      file_server
  }
  ```
