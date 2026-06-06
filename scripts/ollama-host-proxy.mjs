import http from "node:http";

const LISTEN_PORT = Number(process.env.OLLAMA_PROXY_PORT || "33114");
const TARGET_HOST = process.env.OLLAMA_TARGET_HOST || "127.0.0.1";
const TARGET_PORT = Number(process.env.OLLAMA_TARGET_PORT || "11434");

const server = http.createServer((req, res) => {
  const headers = { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` };

  const upstream = http.request(
    {
      protocol: "http:",
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    }
    res.end(
      JSON.stringify({
        error: "ollama_proxy_upstream_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  });

  req.pipe(upstream);
});

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.log(
    `Ollama host-header proxy listening on http://127.0.0.1:${LISTEN_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`,
  );
});
