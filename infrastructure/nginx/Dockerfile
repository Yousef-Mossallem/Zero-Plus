# ======================================================
# Zero Plus Nginx — build with SSL fingerprint (JA3-style)
# ======================================================
FROM debian:bookworm-slim AS builder

ENV NGINX_VERSION=1.27.4
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl git \
    libpcre3-dev zlib1g-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Nginx source
RUN curl -fsSL "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" -o nginx.tar.gz \
 && tar -xzf nginx.tar.gz

# موديول بصمة TLS (JA3 / fingerprint) — شائع مع $ssl_ja3
# لو المستودع تغيّر، بدّل الـ URL لنفس الموديول عندك
RUN git clone --depth=1 https://github.com/fooinha/nginx-ssl-fingerprint.git

WORKDIR /build/nginx-${NGINX_VERSION}

RUN ./configure \
      --prefix=/etc/nginx \
      --sbin-path=/usr/sbin/nginx \
      --modules-path=/usr/lib/nginx/modules \
      --conf-path=/etc/nginx/nginx.conf \
      --error-log-path=/var/log/nginx/error.log \
      --http-log-path=/var/log/nginx/access.log \
      --pid-path=/var/run/nginx.pid \
      --lock-path=/var/run/nginx.lock \
      --http-client-body-temp-path=/var/cache/nginx/client_temp \
      --http-proxy-temp-path=/var/cache/nginx/proxy_temp \
      --with-http_ssl_module \
      --with-http_v2_module \
      --with-http_realip_module \
      --with-http_stub_status_module \
      --with-http_gzip_static_module \
      --with-threads \
      --with-compat \
      --add-module=/build/nginx-ssl-fingerprint \
 && make -j"$(nproc)" \
 && make install

# ---- runtime ----
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 libpcre3 zlib1g openssl curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/cache/nginx /var/log/nginx /etc/nginx/conf.d /etc/nginx/ssl

COPY --from=builder /usr/sbin/nginx /usr/sbin/nginx
COPY --from=builder /etc/nginx /etc/nginx

COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/ /etc/nginx/conf.d/
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80 443

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD curl -fsS http://127.0.0.1/nginx-health || exit 1

ENTRYPOINT ["/entrypoint.sh"]