# ======================================================
# Zero Plus - Nginx with JA3/JA4 support
# ======================================================
FROM nginx:1.27-alpine

# في الإنتاج الحقيقي يُفضل بناء Nginx من المصدر مع موديول JA4
# حالياً بنستخدم صورة رسمية + إعدادات قوية
# (لو عايز JA4 حقيقي 100% نبني custom image لاحقاً)

RUN apk add --no-cache curl

# نسخ الإعدادات
COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/ /etc/nginx/conf.d/

# مجلد الـ SSL (لو هتستخدم شهادات)
RUN mkdir -p /etc/nginx/ssl

EXPOSE 80 443

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]