# gemini4-mcp

**Experimental, API-key-free Claude Code ↔ Google Antigravity CLI compatibility bridge.**

Use the native **Claude Code** terminal UI while attempting to route model responses through the **official Google Antigravity CLI**, authenticated by **your own Google account**. Select from whatever models the *installed* `agy` CLI advertises. This does **not** reuse or extract OAuth tokens, scrape Antigravity endpoints, call a hidden API, or require a Gemini API key.

> [!WARNING]
> **Compatibility preview, not a production-ready drop-in replacement.** Google's `agy` is a full coding *agent*, not a raw LLM completion API. The bridge constrains its output with official `--json-schema`, requests tool calls in a structured format, and translates them back to Anthropic Messages, but cannot guarantee equivalent tool behavior, instruction precedence, context limits, performance, thinking blocks, or latency. The real Google-authenticated round-trip **has not been tested here** (no Antigravity session or Claude Code installation available in the build environment). Anthropic explicitly does not support Claude Code routing to non-Claude models. Use at your own risk and respect your service terms and quotas.

## How it works

```
Claude Code CLI  [unchanged tools / skills / MCP / hooks]
      │ Anthropic Messages requests: ANTHROPIC_BASE_URL
      ▼
127.0.0.1 ephemeral token-protected local HTTP gateway
      │ validate → transcript → JSON schema → tool translation
      ▼
Official Antigravity CLI: agy --input-format stream-json --output-format stream-json
      --model ... --json-schema ...
      │ Antigravity's own signed-in Google account (native keyring)
      ▼
Chosen model advertised by `agy models`
```

**Why it is a local gateway rather than a Claude skill/MCP/hook:** a Claude Code skill, MCP server or hook augments tools and workflows; it does not replace Claude Code's main model provider. Claude Code's documented gateway environment variables allow routing its model requests to a local Anthropic-format service, which is the mechanism used here. Note that Anthropic does not officially support non-Claude backends.

## Prerequisites

- Windows 10/11, macOS, or Linux; **Node.js 20+**.
- The [official Google Antigravity CLI](https://antigravity.google/docs/cli/install/) (`agy`) available on your PATH.
- A Google account signed in by launching **`agy` interactively once**. Google login and available model quotas depend on your actual Antigravity plan. A Google AI Pro subscription does **not** prove this bridge has access to any particular model.
- [Claude Code](https://code.claude.com/docs/en/overview) (`claude`) available on your PATH.

### Install Google's official CLI

Follow Google's [current official instructions](https://antigravity.google/docs/cli/install/) for your OS. At the time this repository was written:

- macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`
- Windows PowerShell: `irm https://antigravity.google/cli/install.ps1 | iex`

Review remotely fetched installation scripts or use Google's manual install route according to your security preferences. This repository **does not run these scripts for you**.

Open a terminal and launch `agy`. Complete Google's browser sign-in, then exit. Verify available models:

```shell
agy models
```

If this fails, fix your Antigravity installation/account before using the bridge. **Do not set `modelProvider: "gemini"` unless you *intentionally* want Google's separate API-key-based mode.**

## Install this repository

After cloning or downloading/extracting the source, inside the project folder:

```shell
npm install -g .
g4 doctor
g4 models
```

This package uses **zero runtime npm dependencies**. Installation registers the `g4` command. Windows users should reopen their terminal if their PATH changed.

For direct usage without global installation, run `node src/cli.js` in place of `g4`.

## Select a Gemini model

```shell
g4 models
g4 model set gemini-4-carbon-high   # example; choose one that exists for YOUR account
g4 model show
```

The list is discovered from `agy models` each time; **no hard-coded, stale model list**. Invalid model names are rejected before saving. An unknown model fails at Google CLI rather than silently changing models.

## Launch Claude Code with Gemini selected

```shell
g4 claude
```

Or pick a model for only this session:

```shell
g4 claude --model gemini-4-argon-high
```

Optionally forward Claude Code CLI arguments after `--`:

```shell
g4 claude --model gemini-4-argon-high -- --print "Reply with a short greeting"
```

While the wrapper is running, it sets `ANTHROPIC_BASE_URL`, an **ephemeral random local** `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_MODEL` for the **child Claude Code process only**. It does **not** overwrite your global `~/.claude/settings.json`, Google OAuth credentials, or existing Claude sessions. The local gateway stops after Claude Code exits.

Inside Claude Code, try `/status` to verify the base URL points to `127.0.0.1` and a gateway credential is active. `/model` behavior with third-party model slugs varies by Claude Code version. The most reliable selector is `g4 claude --model <slug>`.

### Windows PowerShell quick start

```powershell
# In the cloned or extracted gemini4-mcp repository
npm install -g .
agy             # one-time official Google sign-in
# close agy (Ctrl+C if needed)
g4 doctor
g4 models
g4 model set gemini-4-carbon-high
g4 claude
```

## Manual gateway / integration

```shell
g4 serve --model gemini-4-carbon-high --port 8787
```

This prints a randomly generated token and `ANTHROPIC_BASE_URL`. Set that URL and token in **the current terminal session** to connect a Claude Code process. Don't paste tokens into chat, commit them, or leave them in a shared dotfile. Prefer `g4 claude`, which isolates the credentials to its child process.

### CLI configuration / environment variables

| Setting | Purpose |
| --- | --- |
| `G4_MODEL` | Session-specific Gemini model override |
| `G4_CONFIG_PATH` | Override `~/.gemini4-mcp/config.json` |
| `AGY_PATH` | Path to official Antigravity CLI executable |
| `G4_AGY_CWD` | Optional explicitly trusted working directory for CLI; by default a temporary isolated directory |
| `CLAUDE_PATH` | Path to Claude Code CLI executable |
| `ANTHROPIC_BASE_URL` | Set automatically in spawned Claude Code only |
| `ANTHROPIC_AUTH_TOKEN` | Random local gateway credential; not a Google API key |

No token is stored in `g4` configuration. Default model config stores only a model slug and is written atomically with restrictive permissions where available.

## Supported vs. unsupported features

| Capability | Status |
| --- | --- |
| Select models discovered via `agy models` | Implemented; live validation requires `agy` installed |
| Google account auth through official CLI | Uses `agy`'s native auth; actual login not tested here |
| Keyless model invocation via `agy --input-format stream-json` and `--json-schema` | Implemented; mocked tests pass |
| Claude Code text messages | Implemented compatibility mapping; live validation pending |
| Claude Code client tool requests/results | Experimental JSON-schema translation; fidelity not guaranteed |
| Anthropic SSE endpoint | Frames emitted after Antigravity finishes; **not incremental real-time inference streaming** |
| Local password/token protection | Implemented; loopback binding only |
| Claude Code `/v1/messages/count_tokens` | **Heuristic estimate**, not an exact tokenizer |
| Images, documents, audio/video | **Unsupported**; clearly rejected (422) |
| Thinking/signature blocks | **Unsupported**; incoming thinking is intentionally omitted |
| Prompt caching/batch/1M context/fine-grained tool streaming | **Unsupported/not validated** |
| Concurrent requests | One at a time; excess requests receive HTTP 429 |
| Production guarantee / exact same agent behavior | **Not claimed** |

The CLI may introduce its *own* agent tool behavior. The prompt asks it to act only as a model, but natural-language instructions cannot guarantee that. Use a test project, review all proposed commands and edits, and never use blanket permission-bypass modes in Google CLI or Claude Code.

## Security design

- No unofficial Antigravity HTTP endpoints, web-scraping, leaked OAuth tokens, account session extraction, or hidden provider protocol.
- No Gemini API key. The Google account login lives entirely in the official Antigravity CLI's credential storage.
- Gateway binds only to `127.0.0.1` by default; bearer token generated per run.
- No telemetry or prompt logging in gateway; client prompt text is only passed to the official CLI process.
- Subprocess launch uses argument arrays rather than shell string interpolation on Unix. Windows command-shim execution requires a shell; metacharacter restrictions apply to forwarded CLI args.
- Schema file is created with user-only permissions (where supported) and deleted in `finally`.
- Maximum prompt/body/response size, subprocess timeout, and rate limiting.
- No auto-approval of model tool calls; malformed or undeclared client tools are rejected.

For details see [SECURITY.md](SECURITY.md) and [architecture notes](docs/architecture.md).

## Test and package

```shell
npm run verify
npm pack --dry-run
```

Automated tests use **mocked Antigravity responses** and a **real loopback HTTP server**, so they exercise JSON parsing, SSE translation, security, failure paths, model routing, temp-file cleanup and the CLI. GitHub Actions runs the test suite on **Ubuntu, Windows and macOS** with Node.js 20/22 after the project is pushed.

**Not yet completed:** full live integration with actual Google login, real Claude Code versions, OS-specific launch scripts, and upstream account/quota errors. Do not label the bridge "fully working" until these pass on a real user machine.

## Official references checked (November 16, 2026)

- [Antigravity CLI installation and official account sign-in](https://antigravity.google/docs/cli/install/)
- [Antigravity CLI headless mode, JSON schema, model selection](https://antigravity.google/docs/cli/headless/)
- [Claude Code: connect to LLM gateways](https://code.claude.com/docs/en/llm-gateway-connect)
- [Claude Code: gateway support restrictions](https://code.claude.com/docs/en/llm-gateway)
- [Claude Code: model configuration](https://code.claude.com/docs/en/model-config)
- [Google: consumer Gemini CLI login deprecation](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)

## License

MIT. Unofficial community project; not affiliated with, sponsored by or endorsed by Google or Anthropic.
