# Obsidian Vault Workflow

Chain Insights workspaces are Obsidian-compatible investigation vaults.
Obsidian is the first-class human review UI, while Chain Insights case files,
evidence manifests, reports, graph JSON, and exports remain plain local files.
Obsidian plugin is not required.

## Install

Install Chain Insights:

```bash
npm install -g chain-insights
cia --version
```

Install Obsidian when you want the vault UI:

- Windows and macOS: download the installer from
  <https://obsidian.md/download> and open it.
- Linux AppImage: download the AppImage from <https://obsidian.md/download>,
  then run:

```bash
chmod u+x Obsidian-<version>.AppImage
./Obsidian-<version>.AppImage --no-sandbox
```

- Linux Flatpak:

```bash
flatpak install flathub md.obsidian.Obsidian
flatpak run md.obsidian.Obsidian
```

## Create An Investigation Vault

Create a normal local folder and initialize it:

```bash
mkdir -p ~/work/chain-insights-investigations
cd ~/work/chain-insights-investigations
cia init .
cia obsidian open .
```

If the app association is not available, open Obsidian manually, choose
**Open folder as vault**, and select the initialized workspace folder.

The workspace includes Chain Insights runtime metadata, case state, generated
vault notes, Obsidian settings, evidence, entities, canvases, reports, and
published handoff bundles. The files remain readable in any editor.

## Work A Case

Open a case:

```bash
cia case open "Exchange deposit clustering" \
  --tags aml,bittensor \
  --description "Trace source funds into exchange entities"
```

Run investigation tools with `--case` so evidence and report pointers attach to
the case:

```bash
cia mcp trace-victim-funds \
  --network bittensor \
  --victim-addresses 5GTjfJaLpBNrgybhY24NqhDnKW9r94z72RSYLxeodxJfSkj5 \
  --case 1
```

Refresh live vault notes whenever case evidence, dossiers, or sessions change:

```bash
cia case vault refresh 1 --force
```

Use Obsidian for review of `Home.md`, case notes, entity notes, evidence notes,
and canvases. Use the CLI or MCP tools for live GraphRAG MCP reads and evidence
capture.

## VS Code And Agent Operator Setup

Open the same folder in VS Code, Codex, Claude Code, or another local agent.
The agent and Obsidian should operate over the same workspace path:

```bash
code .
codex
claude
```

Agents should read the workspace notes, case files, evidence manifests, graph
JSON, and report pointers before running new tools. When a result changes the
case, refresh the vault notes again:

```bash
cia case vault refresh 1 --force
```

## LLM Wiki Overlay

LLM Wiki is an optional overlay for agent-native retrieval and compiled case
knowledge. Use the live workspace for normal local work, then export a selected
case when you need an ingestion bundle:

```bash
cia case evidence verify 1
cia case export 1 --target obsidian-llmwiki --mode private
```

The exported `published/<case-slug>/LLMWIKI.md`,
`manifest.chain-insights.json`, `graph.chain-insights.json`, and Markdown notes
can be ingested into an LLM Wiki topic while the original workspace remains the
auditable source.

## Sharing

Normal local investigation work stays in the initialized vault. Export only
when you need sharing, partner handoff, LLM Wiki ingestion, or archive.

Use `private` only inside the investigation team. Use `partner` for controlled
handoff after review. Use `public` for demos and public writeups where address
aliasing and redaction metadata are required.

Do not share `.chain-insights/` runtime state, local credentials, wallet
material, debug tokens, or unreviewed private notes. Review generated bundles
before sending them outside the team.
