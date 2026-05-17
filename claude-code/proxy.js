const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const TARGET_HOST = 'ai.mindflow.com.cn';
const PORT = 18443;
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
      const out = execSync(`openssl x509 -checkend 86400 -noout -in "${CERT_FILE}"`, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
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
  // HEAD /v1 - healthcheck
  if (req.method === 'HEAD' && req.url === '/v1') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Fix doubled /v1/v1/ path (Claude Code appends /v1 to ANTHROPIC_BASE_URL)
  let targetPath = req.url;
  if (targetPath.startsWith('/v1/v1/')) {
    targetPath = targetPath.replace('/v1/v1/', '/v1/');
  }

  // Collect body and forward
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

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
      console.error('[proxy] error:', e.message);
      res.writeHead(502);
      res.end('Proxy error');
    });

    if (bodyBuf.length > 0) proxyReq.write(bodyBuf);
    proxyReq.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[proxy] HTTPS proxy for Claude Code running on https://127.0.0.1:${PORT}`);
  // Write PID for management
  fs.writeFileSync(path.join(__dirname, 'proxy.pid'), String(process.pid));
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
