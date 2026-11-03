// ==================================================================
// ZERO PLUS — Test Environment (Test Origin + Fake DNS) في ملف واحد
// ------------------------------------------------------------------
//   Test Origin : http://127.0.0.1:8088
//   Fake DNS    : 127.0.0.1:5354 (UDP) — بيقرا ./records.json في كل استعلام
//
// تشغيل:
//   npm i dns2
//   node zero-plus-test-env.js
//
// مثال records.json:
//   {
//     "app.example.com": {
//       "A": ["127.0.0.1"],
//       "TXT": ["zero-plus-verify=abc123"],
//       "CNAME": []
//     }
//   }
// ==================================================================

const http = require("node:http");
const fs = require("node:fs");
const dns2 = require("dns2");

const { Packet } = dns2;

// ------------------------------------------------------------------
// الإعدادات
// ------------------------------------------------------------------

const HOST = "127.0.0.1";
const ORIGIN_PORT = 8088;
const DNS_PORT = 5354;
const RECORDS_FILE = "./records.json";

// ------------------------------------------------------------------
// 1) Test Origin
// ------------------------------------------------------------------

const originServer = http.createServer((req, res) => {
  const response = [
    "ZERO PLUS TEST ORIGIN",
    "=====================",
    "",
    `Status: ONLINE`,
    `Method: ${req.method}`,
    `Path: ${req.url}`,
    `Host: ${req.headers.host || "unknown"}`,
    `User-Agent: ${req.headers["user-agent"] || "unknown"}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");

  console.log("\n========== INCOMING REQUEST ==========");
  console.log(response);
  console.log("======================================\n");

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });

  res.end(response);
});

// ------------------------------------------------------------------
// 2) Fake DNS
// ------------------------------------------------------------------

function readRecords() {
  try {
    return JSON.parse(fs.readFileSync(RECORDS_FILE, "utf8"));
  } catch {
    return {};
  }
}

const dnsServer = dns2.createServer({
  udp: true,
  handle: (request, send) => {
    const response = Packet.createResponseFromRequest(request);
    const [question] = request.questions;

    // طلب من غير سؤال → نرد برد فاضي بدل ما السيرفر يقع
    if (!question) {
      send(response);
      return;
    }

    const name = question.name.toLowerCase();
    const rec = readRecords()[name] ?? {};
    const base = { name, class: Packet.CLASS.IN, ttl: 60 };

    if (question.type === Packet.TYPE.TXT) {
      for (const v of rec.TXT ?? [])
        response.answers.push({ ...base, type: Packet.TYPE.TXT, data: v });
    }
    if (question.type === Packet.TYPE.A) {
      for (const ip of rec.A ?? [])
        response.answers.push({ ...base, type: Packet.TYPE.A, address: ip });
    }
    if (question.type === Packet.TYPE.CNAME) {
      for (const d of rec.CNAME ?? [])
        response.answers.push({ ...base, type: Packet.TYPE.CNAME, domain: d });
    }

    send(response);
  },
});

// ------------------------------------------------------------------
// تشغيل الاتنين
// ------------------------------------------------------------------

originServer.listen(ORIGIN_PORT, HOST, () => {
  console.log("--------------------------------------");
  console.log("ZERO PLUS TEST ORIGIN");
  console.log("--------------------------------------");
  console.log(`Running at: http://${HOST}:${ORIGIN_PORT}`);
  console.log("Status: ONLINE");
  console.log("--------------------------------------");
});

dnsServer.listen({
  udp: {
    port: DNS_PORT,
    address: HOST,
    type: "udp4",
  },
});

console.log(`Fake DNS on ${HOST}:${DNS_PORT}`);

// ------------------------------------------------------------------
// إيقاف نظيف (Ctrl+C)
// ------------------------------------------------------------------

function shutdown() {
  console.log("\nShutting down ZERO PLUS test environment...");
  try {
    originServer.close();
  } catch {
    /* ignore */
  }
  try {
    dnsServer.close();
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(0), 300).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);