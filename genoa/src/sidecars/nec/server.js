const http = require("http");
const { spawnSync } = require("child_process");

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    const probe = spawnSync("python3", ["-c", "import PyNEC; print('ok')"], { encoding: "utf8" });

    return json(res, 200, {
      ok: true,
      service: "nec-sidecar",
      engine: "necpp/PyNEC",
      pynec_available: probe.status === 0,
      pynec_error: probe.status === 0 ? null : probe.stderr,
      license_boundary: "external sidecar"
    });
  }

  if (req.method === "POST" && req.url === "/model/run") {
    return json(res, 200, {
      ok: false,
      error: "MODEL_RUN_NOT_IMPLEMENTED_YET",
      engine: "necpp/PyNEC",
      license_boundary: "external sidecar"
    });
  }

  return json(res, 404, { ok: false, error: "not_found" });
});

server.listen(8085, "0.0.0.0", () => {
  console.log("nec-sidecar running on 8085");
});
