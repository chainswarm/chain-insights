# Security Policy

## Supported Versions

Chain Insights is pre-1.0. Security fixes are applied to the latest `main` branch and the latest published npm package.

## Reporting a Vulnerability

Report suspected vulnerabilities privately to the maintainers before opening a public issue. Include:

- Affected version, commit, or npm package version.
- Reproduction steps or a minimal proof of concept.
- Impact assessment, especially for wallet handling, x402 payments, MCP tool execution, graph report files, or local workspace data.

Do not include live private keys, bearer tokens, seed phrases, or funded wallet material in reports. Use test wallets and redacted logs.

## Supply Chain Scope

The project treats dependency compromise, npm package takeover, malicious lifecycle scripts, poisoned GitHub Actions, and wallet/payment package tampering as security issues.

CI runs dependency audits, npm registry signature verification, secret-pattern scanning, CodeQL, OpenSSF Scorecard, and pinned GitHub Actions. Dependency updates are handled through Dependabot.
