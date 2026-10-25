#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSL="$ROOT/ssl"
mkdir -p "$SSL"

openssl req -x509 -nodes -newkey rsa:4096 \
  -keyout "$SSL/privkey.pem" \
  -out "$SSL/fullchain.pem" \
  -days 825 \
  -subj "/C=EG/O=ZeroPlus/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.localhost,DNS:*.zeroplus.local,IP:127.0.0.1"

chmod 600 "$SSL/privkey.pem"
chmod 644 "$SSL/fullchain.pem"
echo "Dev certs ready in $SSL"