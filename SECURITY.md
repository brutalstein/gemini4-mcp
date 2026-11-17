# Security policy

**Experimental compatibility preview. Not reviewed for production deployment.**

## Sensitive data and subscriptions

- Never request or share Google's access tokens, refresh tokens, cookies, local keychain files, account password, or API keys.
- The `agy` CLI authenticates itself through Google's supported Google account flow. The bridge does not read credentials, even when invoked from an Antigravity installation.
- Antigravity CLI may receive source code and model prompts as required for inference. Review Google's applicable privacy, quota, and service conditions.
- The bearer token printed by `g4 serve` is **only a credential for the local HTTP server**, not a Google API key. It must remain secret from other local users.

## Threat model

A local unprivileged process that knows the gateway's random bearer token could send model requests and use your Google Antigravity quota. The server is localhost only by design, rejecting external interface binding. The `g4 claude` launcher creates an ephemeral token and isolates it to the child Claude Code process.

The Antigravity CLI is itself an agent, which can possess local tools. Our prompt requests model-only behavior, but this **does not enforce** tool prohibition. Run the Google CLI with restrictive native permissions and review file/network/command operations. Don't invoke the `--dangerously-skip-permissions` flag.

Prompt injection is possible through client messages and tool outputs despite serialization. Never interpret the bridge as a security boundary against malicious model text.

## Report an issue

Open a GitHub security advisory or report to the repository owner without pasting credentials. Provide redacted error logs and sanitized reproduction steps.
