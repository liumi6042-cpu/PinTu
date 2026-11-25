#!/bin/sh
# Run only after Qiniu permission is approved and the CDN DNS/challenge path works.
set -eu
test "$(id -u)" -eq 0
cd /opt/jigsaw-cdn-cert
python3 certificate_ops.py preflight
# Certbot reconfigure performs staging renewal before saving the webroot configuration.
cp -p /etc/letsencrypt/renewal/api.ymxc.top.conf "/opt/jigsaw-cdn-cert/renewal.before-$(date -u +%Y%m%dT%H%M%SZ).conf"
certbot reconfigure --cert-name api.ymxc.top --webroot --webroot-path /var/www/acme --preferred-challenges http --non-interactive
python3 certificate_ops.py sync
install -m 0644 jigsaw-cdn-cert.service jigsaw-cdn-cert.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/jigsaw-cdn-cert.service /etc/systemd/system/jigsaw-cdn-cert.timer
systemctl daemon-reload
systemctl enable --now jigsaw-cdn-cert.timer
systemctl list-timers jigsaw-cdn-cert.timer --no-pager
