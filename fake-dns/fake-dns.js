const dns2 = require("dns2");
const fs = require("fs");
const { Packet } = dns2;

function readRecords() {
  try {
    return JSON.parse(fs.readFileSync("./records.json", "utf8"));
  } catch {
    return {};
  }
}

const server = dns2.createServer({
  udp: true,
  handle: (request, send) => {
    const response = Packet.createResponseFromRequest(request);
    const [question] = request.questions;
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

server.listen({
  udp: {
    port: 5354,
    address: "127.0.0.1",
    type: "udp4"
  }
});

console.log("Fake DNS on 127.0.0.1:5354");