const https = require('https');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TAGGING_URL = 'http://localhost:8080'; // sGTM tagging server
const PREVIEW_URL = 'http://localhost:8081'; // sGTM debug/preview server

const tls = {
  key: fs.readFileSync(path.join(__dirname, 'certs', 'localhost-key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'certs', 'localhost.pem')),
};

const proxyTo = (base, req, res) => {
  const proxyReq = http.request(base + req.url, {
    method: req.method,
    headers: { ...req.headers, host: 'localhost' },
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('sGTM unreachable: ' + e.message);
  });
  req.pipe(proxyReq);
};

const server = https.createServer(tls, (req, res) => {
  // Tag Assistant debug endpoints live under /gtm/ and must reach the
  // preview server. Hits always go to the tagging server — it forwards ones
  // carrying the X-Gtm-Server-Preview header to the preview server itself.
  if (req.url.startsWith('/gtm/')) return proxyTo(PREVIEW_URL, req, res);
  if (req.url.startsWith('/g/collect')) return proxyTo(TAGGING_URL, req, res);

  const html = fs.readFileSync(path.join(__dirname, 'index.html'));
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

// Pass websocket upgrades (used by the Tag Assistant debug UI) through to
// the preview server as a raw TCP pipe.
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(8081, 'localhost', () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    upstream.write(raw + '\r\n');
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(PORT, () => {
  console.log(`Example app running at https://localhost:${PORT}`);
  console.log(`  /gtm/*      → ${PREVIEW_URL} (Tag Assistant debug)`);
  console.log(`  /g/collect  → ${TAGGING_URL} (or preview server when the preview header is set)`);
});
