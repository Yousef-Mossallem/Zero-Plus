#!/usr/bin/env sh
set -e

if [ ! -f /etc/nginx/ssl/fullchain.pem ] || [ ! -f /etc/nginx/ssl/privkey.pem ]; then
  echo "WARN: missing certs — generating ephemeral self-signed"
  mkdir -p /etc/nginx/ssl
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/privkey.pem \
    -out /etc/nginx/ssl/fullchain.pem \
    -days 30 \
    -subj "/CN=localhost"
fi

# اختبار الكونفج قبل التشغيل
nginx -t
exec nginx -g 'daemon off;'