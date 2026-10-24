import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve("dist");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/") {
    response.writeHead(302, { Location: "/q3n8v/" });
    response.end();
    return;
  }
  const relative = decodeURIComponent(url.pathname.replace(/^\/q3n8v\/?/, "")) || "index.html";
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
});

server.listen(4173, "127.0.0.1", () => {
  console.log("Preview: http://127.0.0.1:4173/q3n8v/");
});
