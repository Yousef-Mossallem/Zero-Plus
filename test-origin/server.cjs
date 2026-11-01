const http = require("node:http");

const PORT = 8088;

const server = http.createServer((req, res) => {
    const response = [
        "ZERO PLUS TEST ORIGIN",
        "=====================",
        "",
        `Status: ONLINE`,
        `Method: ${req.method}`,
        `Path: ${req.url}`,
        `Host: ${req.headers.host || "unknown"}`,
        `User-Agent: ${req.headers["user-agent"] || "unknown"}`,
        `Time: ${new Date().toISOString()}`
    ].join("\n");

    console.log("\n========== INCOMING REQUEST ==========");
    console.log(response);
    console.log("======================================\n");

    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
    });

    res.end(response);
});

server.listen(PORT, "127.0.0.1", () => {
    console.log("--------------------------------------");
    console.log("ZERO PLUS TEST ORIGIN");
    console.log("--------------------------------------");
    console.log(`Running at: http://127.0.0.1:${PORT}`);
    console.log("Status: ONLINE");
    console.log("--------------------------------------");
});