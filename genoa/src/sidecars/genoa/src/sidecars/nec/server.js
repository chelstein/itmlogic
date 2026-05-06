const http = require("http");

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      service: "nec-sidecar",
      engine: "necpp/PyNEC",
      license_boundary: "external sidecar"
    }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false }));
});

server.listen(8085, "0.0.0.0", () => {
  console.log("nec-sidecar running on 8085");
});
