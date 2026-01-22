# 🖥️ VocaCore Server Guide

This document explains how to manage the VocaCore production server hosted on Vultr.

---

## 1. SSH Into Server

### From your local machine:

```bash
ssh jake@YOUR_SERVER_IP
```

Example:

```bash
ssh jake@139.84.xxx.xxx
```

---

## 2. Basic System Info

### OS & Kernel

```bash
uname -a
lsb_release -a
```

### CPU / RAM / Disk

```bash
htop
free -h
df -h
```

---

## 3. Project Location

All apps live in:

```bash
~/apps/voice-ai
```

Go there:

```bash
cd ~/apps/voice-ai
```

---

## 4. Docker Essentials

### Check running containers

```bash
docker ps
```

### View logs

```bash
docker compose logs -f
```

### Restart everything

```bash
docker compose down
docker compose up -d
```

### Rebuild after code changes

```bash
docker compose build
docker compose up -d
```

---

## 5. Git Deployment (Manual)

### Pull latest code

```bash
git pull
```

### If conflicts

```bash
git stash
git pull
git stash pop
```

---

## 6. Automatic Deployment (GitHub Actions)

Whenever you push to `main`:

```
GitHub → SSH into server → Pull repo → Rebuild Docker → Restart
```

No manual action needed.

---

## 7. Add New Port / Service

### 1. Expose in docker-compose.yml

Example:

```yaml
ports:
  - "4000:4000"
```

### 2. Allow firewall

```bash
sudo ufw allow 4000
sudo ufw reload
```

---

## 8. Map Domain to Port (Nginx)

All domains should point to port 80/443 and proxy internally.

### Example: api.vocacore.com → port 8080

```bash
sudo nano /etc/nginx/sites-available/api.vocacore.com
```

```nginx
server {
    server_name api.vocacore.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Enable:

```bash
sudo ln -s /etc/nginx/sites-available/api.vocacore.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 9. Enable HTTPS (Let's Encrypt)

```bash
sudo certbot --nginx -d api.vocacore.com
```

Auto-renews every 90 days.

---

## 10. Redis

Check Redis:

```bash
docker exec -it vocaai-redis redis-cli ping
```

Should return:

```
PONG
```

---

## 11. Environment Variables

Stored in:

```
.env
```

After changes:

```bash
docker compose down
docker compose up -d
```

---

## 12. SSH Keys (Deployment)

Keys live at:

```bash
~/.ssh/id_ed25519
~/.ssh/authorized_keys
```

Check:

```bash
ls -la ~/.ssh
```

---

## 13. Useful Maintenance

### Kill stuck containers

```bash
docker system prune -f
```

### Check open ports

```bash
sudo ss -tulnp
```

### Disk usage by Docker

```bash
docker system df
```

---

## 14. Emergency Restart (Everything)

```bash
sudo reboot
```

Server auto-starts Docker + Nginx.

---

## Mental Model (How infra works)

```
Domain (Cloudflare / DNS)
        ↓
Nginx (443 HTTPS)
        ↓
Docker container
        ↓
Node.js / WebSocket / API
```

---

## Golden Rules

* Never edit in `/root`
* Never commit `.env`
* Always deploy via GitHub
* All traffic goes through Nginx
* Only expose ports when needed

---

## Production Checklist

| Item           | Status |
| -------------- | ------ |
| SSH key login  | ✅      |
| Firewall (ufw) | ✅      |
| Docker         | ✅      |
| Nginx          | ✅      |
| HTTPS          | ✅      |
| Auto deploy    | ✅      |
| Redis          | ✅      |
