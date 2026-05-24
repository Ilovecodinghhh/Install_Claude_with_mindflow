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

## Browser Support (Playwright MCP)

Claude Code doesn't include browser tools by default — it only ships with Bash, Read, Edit, WebFetch, and WebSearch. To give it full browser control (navigate, click, screenshot, fill forms, etc.), add the **Playwright MCP server**.

### 1. Install the Playwright MCP package and browser

```bash
npm install -g @playwright/mcp
npx playwright install chromium
```

### 2. Create `.mcp.json` in your workspace root

```json
{
  "mcpServers": {
    "playwright": {
      "command": "playwright-mcp",
      "args": ["--headless"]
    }
  }
}
```

> **Note:** Use `--headless` for servers without a display. Remove it if you want to see the browser window on a desktop environment.

### 3. Auto-approve browser tool permissions

Add `mcp__playwright__*` to your allowed tools in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Read(*)",
      "Write(*)",
      "WebFetch(*)",
      "WebSearch(*)",
      "mcp__playwright__*"
    ]
  }
}
```

Without this, Claude Code will prompt for approval on every browser action.

### 4. Verify

```bash
claude-code -p "Navigate to https://example.com and tell me the heading text."
```

Expected output should mention **"Example Domain"** — confirming Playwright launched headless Chromium, navigated to the page, and read the DOM.

### Available Browser Tools

Once configured, Claude Code gets these Playwright MCP tools:

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_snapshot` | Capture accessibility snapshot of the page |
| `browser_click` | Click an element |
| `browser_type` | Type text into an input |
| `browser_screenshot` | Take a PNG screenshot |
| `browser_hover` | Hover over an element |
| `browser_select_option` | Select from dropdowns |
| `browser_drag` | Drag and drop |
| `browser_press_key` | Press keyboard keys |
| `browser_tab_*` | Manage browser tabs |

### Troubleshooting

- **"Cannot find playwright-mcp"** — Make sure `npm root -g` is in your PATH, or use the full path in `.mcp.json`: `"command": "/full/path/to/playwright-mcp"`
- **Browser fails to launch** — Install system dependencies: `npx playwright install-deps chromium`
- **Display errors on headless server** — Ensure `--headless` is in the args. If still failing, set `DISPLAY=` (empty) in your environment.

## Custom Context Window Size

Claude Code defaults to a 200k token context window. You can increase this (up to the model's maximum) by setting two environment variables in the launcher script:

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | Maximum tokens before auto-compaction triggers | `200000` |
| `DISABLE_COMPACT` | Disable automatic context compaction entirely | unset |

### Configuration

Add these to the `exec env` block in the `claude-code` launcher script:

```bash
exec env \
  NODE_TLS_REJECT_UNAUTHORIZED=0 \
  ANTHROPIC_BASE_URL="https://127.0.0.1:${PROXY_PORT}/v1" \
  ANTHROPIC_API_KEY="<your-key>" \
  CLAUDE_CODE_MAX_CONTEXT_TOKENS=500000 \
  DISABLE_COMPACT=1 \
  claude --bare --model claude-opus-4-6 --dangerously-skip-permissions "$@"
```

### How It Works

- **`CLAUDE_CODE_MAX_CONTEXT_TOKENS=500000`** — Sets the operational context limit to 500k tokens. Claude Code won't trigger compaction until this threshold is reached.
- **`DISABLE_COMPACT=1`** — Prevents automatic conversation summarization, so you get the full raw context up to the token limit.

> **Note:** Claude Code may still *report* 200k as the model's context window (this is hardcoded in its model capabilities map), but the actual operational limit is controlled by `CLAUDE_CODE_MAX_CONTEXT_TOKENS`. You can verify it's active by asking Claude Code to check the environment variable.

### Common Sizes

| Setting | Use Case |
|---------|----------|
| `200000` | Default — good for most tasks |
| `500000` | Large codebases, long sessions |
| `1000000` | Maximum — for models that support 1M context |

> **Warning:** Larger context windows consume more tokens per request, which increases API costs and latency. Only increase if needed.

## Superpowers Plugin (Structured Development Methodology)

The [Superpowers](https://github.com/obra/superpowers) plugin gives Claude Code a complete software development workflow: brainstorming → design → planning → TDD → subagent-driven development → code review.

### Install

```bash
# Add the marketplace
claude plugin marketplace add obra/superpowers-marketplace

# Install the plugin
claude plugin install superpowers@superpowers-marketplace
```

### What It Does

Once installed, Superpowers activates automatically. When you start building something, Claude Code will:

1. **Brainstorm** — Ask clarifying questions, explore alternatives, present a design doc
2. **Plan** — Break work into 2-5 minute tasks with exact file paths and verification steps
3. **Build with TDD** — Write failing test → make it pass → refactor → commit (per task)
4. **Subagent execution** — Launch fresh subagents per task with two-stage review
5. **Code review** — Review against plan, report issues by severity
6. **Finish** — Verify tests, present merge/PR options, clean up

Skills are mandatory workflows, not suggestions. The agent checks for relevant skills before every task.

## Disable Attribution Header

Add `CLAUDE_CODE_ATTRIBUTION_HEADER: "0"` to the `env` section of `~/.claude/settings.json` to prevent Claude Code from adding attribution headers to API requests:

```json
{
  "env": {
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0"
  }
}
```

## Tested With

- Claude Code v2.1.143
- Node.js v24.14.0
- API: `ai.mindflow.com.cn/v1` with model `claude-opus-4-6`
- Playwright MCP v0.0.75 with Chromium Headless Shell 148.0
- Verified: file system access, bash execution, internet connectivity, **browser navigation and DOM reading**, **500k context window**
