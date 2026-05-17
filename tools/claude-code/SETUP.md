# Claude Code with Custom API Proxy (mindflow.com.cn)

## Problem

Claude Code (v2.1.143) validates model names against `api.anthropic.com` before making any API calls — even when `ANTHROPIC_BASE_URL` points to a different provider. If your API key is only valid on the proxy (not on the real Anthropic API), model validation fails with:

```
There's an issue with the selected model (claude-opus-4-6).
It may not exist or you may not have access to it.
```

This happens because Claude Code sends a validation request to `api.anthropic.com` using the same `ANTHROPIC_API_KEY`, which gets rejected by the real API.

## Solution

Intercept the validation by routing `api.anthropic.com` to a local HTTPS proxy that:

1. Responds to healthcheck/validation requests locally
2. Forwards actual API calls (`/v1/messages`) to the real backend (`ai.mindflow.com.cn`)
3. Fixes a path-doubling bug (`/v1/v1/messages` → `/v1/messages`)

### Architecture

```
Claude Code
    │
    ├── Validation (HEAD /v1) ──→ Local proxy ──→ 200 OK
    │
    └── API calls (/v1/messages) ──→ Local proxy ──→ ai.mindflow.com.cn
                                      (fixes /v1/v1/ path)
```

## Setup Steps

### 1. Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

### 2. Create the proxy

Save as `tools/claude-code/proxy.js`:

- Self-signed TLS cert for `api.anthropic.com` (auto-generated, 365-day expiry)
- Listens on `127.0.0.1:18443`
- Forwards to `ai.mindflow.com.cn:443`
- Fixes doubled `/v1/v1/` path prefix

### 3. Redirect api.anthropic.com to localhost

```bash
echo "127.0.0.1 api.anthropic.com" | sudo tee -a /etc/hosts
```

### 4. Auto-start proxy via systemd

```ini
# ~/.config/systemd/user/claude-code-proxy.service
[Unit]
Description=Claude Code API proxy (ai.mindflow.com.cn)
After=network.target

[Service]
Type=simple
ExecStart=/path/to/node /path/to/proxy.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now claude-code-proxy.service
```

### 5. Launcher script

The `claude-code` wrapper handles everything:

```bash
claude-code -p "your prompt"   # one-shot
claude-code                     # interactive
claude-code --proxy-status      # check proxy health
```

It sets:
- `NODE_TLS_REJECT_UNAUTHORIZED=0` (self-signed cert)
- `ANTHROPIC_BASE_URL=https://127.0.0.1:18443/v1`
- `ANTHROPIC_API_KEY=<your-key>`
- `--bare --model claude-opus-4-6 --dangerously-skip-permissions`

## File Layout

```
tools/claude-code/
├── proxy.js          # HTTPS proxy (auto-generates certs)
├── claude-code       # Launcher script (symlinked to ~/.local/bin/)
├── certs/
│   ├── cert.pem      # Auto-generated TLS cert
│   └── key.pem       # Auto-generated TLS key
└── proxy.pid         # PID file (managed by proxy.js)
```

## Key Takeaways

- Claude Code's model validation is hardcoded to hit `api.anthropic.com` regardless of `ANTHROPIC_BASE_URL`
- The only workaround is DNS-level interception (`/etc/hosts`) + a local TLS proxy
- The proxy also fixes a path-doubling bug where Claude Code sends `/v1/v1/messages` when `ANTHROPIC_BASE_URL` already includes `/v1`
- `--bare` mode skips hooks/LSP/plugins but does NOT skip model validation
- `--dangerously-skip-permissions` is needed for non-interactive (`-p`) mode with tool access

## Tested With

- Claude Code v2.1.143
- Node.js v24.14.0
- API: `ai.mindflow.com.cn/v1` with model `claude-opus-4-6`
- Verified: file system access, bash execution, internet connectivity
