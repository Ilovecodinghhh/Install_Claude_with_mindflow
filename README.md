# Install Claude Code with Mindflow API

Run Claude Code using a third-party API proxy ([ai.mindflow.com.cn](https://ai.mindflow.com.cn)) with an expanded 500k context window, browser automation via Playwright, and the [Superpowers](https://github.com/obra/superpowers) development methodology plugin.

## What This Does

Claude Code validates model names against `api.anthropic.com` even when using a custom `ANTHROPIC_BASE_URL`. If your API key only works on the third-party proxy, validation fails. This setup solves that by:

1. **Local HTTPS proxy** — intercepts `api.anthropic.com` via `/etc/hosts`, responds to validation locally, forwards real API calls to `ai.mindflow.com.cn`
2. **Path fix** — corrects Claude Code's `/v1/v1/messages` path-doubling bug
3. **Playwright MCP** — gives Claude Code full headless browser control
4. **500k context window** — expands the default 200k limit via `CLAUDE_CODE_MAX_CONTEXT_TOKENS`
5. **Superpowers plugin** — adds structured development methodology (brainstorming → planning → TDD → subagent-driven development)

## Quick Start

```bash
# 1. Install Claude Code
npm install -g @anthropic-ai/claude-code

# 2. Clone this repo
git clone https://github.com/Ilovecodinghhh/Install_Claude_with_mindflow.git
cd Install_Claude_with_mindflow/claude-code

# 3. Redirect api.anthropic.com to localhost
echo "127.0.0.1 api.anthropic.com" | sudo tee -a /etc/hosts

# 4. Start the proxy (generates self-signed certs automatically)
node proxy.js &

# 5. Set up systemd service (auto-start on boot)
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/claude-code-proxy.service << EOF
[Unit]
Description=Claude Code API proxy (ai.mindflow.com.cn)
After=network.target

[Service]
Type=simple
ExecStart=$(which node) $(pwd)/proxy.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now claude-code-proxy.service

# 6. Install Playwright for browser support
npm install -g @playwright/mcp
npx playwright install chromium

# 7. Create .mcp.json in your workspace
cat > /path/to/your/workspace/.mcp.json << 'EOF'
{
  "mcpServers": {
    "playwright": {
      "command": "playwright-mcp",
      "args": ["--headless"]
    }
  }
}
EOF

# 8. Configure Claude Code settings
mkdir -p ~/.claude
cat > ~/.claude/settings.json << 'EOF'
{
  "permissions": {
    "allow": [
      "Bash(*)", "Read(*)", "Write(*)",
      "WebFetch(*)", "WebSearch(*)",
      "mcp__playwright__*"
    ]
  },
  "env": {
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0"
  }
}
EOF

# 9. Install Superpowers plugin
claude plugin marketplace add obra/superpowers-marketplace
claude plugin install superpowers@superpowers-marketplace

# 10. Copy the launcher script
cp claude-code ~/.local/bin/claude-code
chmod +x ~/.local/bin/claude-code
# Edit ~/.local/bin/claude-code to set your API key

# 11. Run!
claude-code -p "Hello, confirm everything works"
claude-code   # interactive mode
```

## Architecture

```
Claude Code
    │
    ├── Validation (HEAD /v1) → Local HTTPS proxy → 200 OK (spoofed)
    │
    └── API calls (/v1/messages) → Local proxy → ai.mindflow.com.cn
                                    (fixes /v1/v1/ path doubling)
```

## File Layout

```
claude-code/
├── proxy.js          # HTTPS proxy (auto-generates certs)
├── claude-code       # Launcher script (symlink to ~/.local/bin/)
├── certs/
│   ├── cert.pem      # Auto-generated TLS cert
│   └── key.pem       # Auto-generated TLS key
├── proxy.pid         # PID file (managed by proxy.js)
└── SETUP.md          # Detailed setup documentation
```

## What's Included

| Component | Purpose |
|-----------|---------|
| **proxy.js** | Local HTTPS proxy that intercepts `api.anthropic.com` |
| **claude-code** | Launcher script with all env vars pre-configured |
| **Playwright MCP** | Browser automation (navigate, click, screenshot, etc.) |
| **Superpowers** | Structured dev methodology (brainstorm → plan → TDD → build) |
| **500k context** | Expanded context window via `CLAUDE_CODE_MAX_CONTEXT_TOKENS` |

## Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `NODE_TLS_REJECT_UNAUTHORIZED` | `0` | Accept self-signed proxy cert |
| `ANTHROPIC_BASE_URL` | `https://127.0.0.1:18443/v1` | Route through local proxy |
| `ANTHROPIC_API_KEY` | Your key | API authentication |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | `500000` | Expand context window |
| `DISABLE_COMPACT` | `1` | Prevent auto-compaction |
| `CLAUDE_CODE_ATTRIBUTION_HEADER` | `0` | Disable attribution header |

## Tested With

- Claude Code v2.1.150
- Node.js v24.14.0
- API: `ai.mindflow.com.cn/v1` with model `claude-opus-4-6`
- Playwright MCP with Chromium Headless Shell 148.0
- Superpowers plugin v5.1.0
- Verified: API proxy, browser automation, 500k context window, Superpowers plugin

## License

MIT
