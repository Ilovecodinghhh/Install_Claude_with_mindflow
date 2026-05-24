const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const TARGET_HOST = 'ai.mindflow.com.cn';
const PORT = parseInt(process.env.PROXY_PORT || '18443', 10);
const CERT_DIR = path.join(__dirname, 'certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');

// Auto-generate certs if missing or expired
function ensureCerts() {
  let needGen = false;
  if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) {
    needGen = true;
  } else {
    try {
      execSync(`openssl x509 -checkend 86400 -noout -in "${CERT_FILE}"`, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
    } catch { needGen = true; }
  }
  if (needGen) {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${KEY_FILE}" -out "${CERT_FILE}" ` +
      `-days 365 -nodes -subj '/CN=api.anthropic.com' -addext 'subjectAltName=DNS:api.anthropic.com'`,
      { stdio: 'pipe' }
    );
    console.log('[proxy] Generated fresh TLS certs');
  }
}

ensureCerts();

const server = https.createServer({
  key: fs.readFileSync(KEY_FILE),
  cert: fs.readFileSync(CERT_FILE),
}, (req, res) => {
  console.log(`[proxy] ${req.method} ${req.url}`);

  // Intercept validation/healthcheck requests locally
  // Claude Code sends HEAD or GET to /v1 and various other endpoints for validation
  if (req.method === 'HEAD') {
    console.log(`[proxy] Intercepted HEAD ${req.url} → 200`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end();
    return;
  }

  // Handle POST to eval/telemetry endpoints locally (mindflow returns 404 for these)
  if (req.method === 'POST' && (req.url.includes('/api/eval/') || req.url.includes('/api/event_logging/') || req.url.includes('/api/statsig'))) {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      console.log(`[proxy] Intercepted POST ${req.url} → 200 (telemetry sink)`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"success":true}');
    });
    return;
  }

  // Handle GET requests to non-messages endpoints (validation, model listing, etc.)
  if (req.method === 'GET' && !req.url.includes('/messages')) {
    console.log(`[proxy] Intercepted GET ${req.url} → 200 (validation)`);
    // Return a minimal valid response for model validation
    if (req.url.includes('/models') || req.url.includes('/v1')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: [{
          id: 'claude-opus-4-6',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'anthropic'
        }]
      }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
    return;
  }

  // Fix doubled /v1/v1/ path (Claude Code appends /v1 to ANTHROPIC_BASE_URL)
  let targetPath = req.url;
  if (targetPath.startsWith('/v1/v1/')) {
    targetPath = targetPath.replace('/v1/v1/', '/v1/');
    console.log(`[proxy] Fixed path: ${req.url} → ${targetPath}`);
  }

  // Collect body and forward to mindflow
  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    const bodyBuf = Buffer.concat(body);
    const headers = { ...req.headers };
    delete headers.host;

    const options = {
      hostname: TARGET_HOST,
      port: 443,
      path: targetPath,
      method: req.method,
      headers: { ...headers, host: TARGET_HOST },
    };

    console.log(`[proxy] → ${req.method} https://${TARGET_HOST}${targetPath}`);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log(`[proxy] ← ${proxyRes.statusCode} ${req.method} ${targetPath}`);
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
      console.error(`[proxy] ERROR forwarding ${req.method} ${targetPath}: ${e.message}`);
      res.writeHead(502);
      res.end('Proxy error');
    });

    if (bodyBuf.length > 0) proxyReq.write(bodyBuf);
    proxyReq.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[proxy] HTTPS proxy for Claude Code running on https://127.0.0.1:${PORT}`);
  fs.writeFileSync(path.join(__dirname, 'proxy.pid'), String(process.pid));
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
