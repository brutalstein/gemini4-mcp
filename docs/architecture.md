# Architecture and design decisions

## Provider selection

`src/agy.js` wraps **only** the official documented `agy` subprocess. It calls `agy models` to discover slugs and invokes `agy --input-format stream-json --output-format stream-json --model <slug> --json-schema <temp-file> --print-timeout ...`, then sends the transcript through the documented stdin JSONL protocol for one stateless completion. This is keyless, but **not an officially supported Anthropic API or raw Gemini completion endpoint**.

A single stateless invocation per Claude request avoids accidental cross-talk between independent Claude Code chats. It adds latency and repeats conversation history. Optimizing with a persistent `agy --input-format stream-json` process would require careful per-session routing and cannot freely combine per-request JSON-schema/model flags; leave that for a separate adapter with test coverage.

## Boundaries

1. **CLI (`src/cli.js`)**: model selection, diagnostics, ephemeral launcher.
2. **Config (`src/config.js`)**: local model name, atomic save, slug validation.
3. **Gateway (`src/server.js`)**: loopback HTTP, authentication, rate limiting, body size, lifecycle.
4. **Prompt serializer (`src/prompt.js`)**: text transcript, role/tool serialization, unsupported media rejection.
5. **Provider (`src/agy.js`)**: official CLI subprocess and schema parsing.
6. **Protocol (`src/protocol.js`)**: model mapping, Anthropic message conversion, SSE events, errors.
7. **Process control (`src/process.js`)**: safe subprocess timeouts, size guards, cancellation.

All production modules rely on Node built-ins only. Provider and model behavior are injected in integration tests; Google credentials never enter the process from the gateway.

## Tool cycle

```
Claude: messages + tools
  → JSON transcript from Claude, including past tool results
  → agy model is instructed not to use its own tools
  → enforced structured output: {kind,text,tool_calls:[{name,input_json}]}
  → check tool name against client-declared tools
  → validate input_json as object
  → respond with Anthropic tool_use blocks
Claude executes its own tool, subject to Claude Code policies
  → user tool_result in next request
```

This is **experimental**. A full Antigravity agent cannot be made into a raw model merely through a prompt. Expect differences from Claude-native model use, especially streaming, tool selection and context limits. Never allow Google CLI's autonomous tools unconditional permission just to improve compatibility.

## Deliberate non-features

- No private OAuth reverse engineering, browser session scraping or token extraction.
- No custom provider HTTP protocol against an unpublished Google endpoint.
- No automatic modification of global Claude Code settings.
- No fallback to arbitrary Anthropic API billing if `agy` fails.
- No fake support claims for images, thinking signatures, exact token count or real-time streaming.

## Requirements for production hardening

A genuine production release needs at minimum a live authenticated Antigravity account test, a real Claude Code interactive tool cycle test, Windows/macOS/Linux integration runs, timeout/cancellation stress tests, end-to-end SSE compatibility tests, and a review of applicable Google/Anthropic terms. CI's mocked tests **cannot** replace these.
