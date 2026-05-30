# Knowledge Exports

Chain Insights workspaces are Obsidian-compatible vaults. Normal local
investigation work happens in the workspace; exports are portable, redacted,
and shareable bundles for partner handoff, LLM Wiki ingestion, and archive.

Chain Insights can export a verified case as a local knowledge bundle for LLM
Wiki, Codex, Claude Code, ChatGPT, Obsidian, and any agent that can read a
folder of Markdown and JSON files.

The export is local-first. Chain Insights writes files under your initialized
workspace and does not upload the case anywhere by itself.

## Install Viewers And Agent Tools

Install Chain Insights:

```bash
npm install -g chain-insights
cia --version
```

Install Obsidian when you want a human vault UI:

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

Install LLM Wiki when you want an agent-native research wiki on top of the
exported case:

```bash
# Claude Code
claude plugin install wiki@llm-wiki

# OpenAI Codex
codex plugin marketplace add nvk/llm-wiki
# Then open /plugins, enable "LLM Wiki", and use @wiki.
```

For any other LLM agent, install the portable LLM Wiki instructions in the
project where the agent runs:

```bash
curl -sL https://raw.githubusercontent.com/nvk/llm-wiki/master/AGENTS.md \
  > AGENTS.md
```

You do not need Obsidian or LLM Wiki to read an export. The bundle is plain
Markdown plus JSON, so editors and agents can consume it directly.

## Create A Case Export

Start from a Chain Insights workspace:

```bash
mkdir -p ~/work/chain-insights-investigations
cd ~/work/chain-insights-investigations
cia init .
```

Open a case and run investigation tools with `--case` so evidence, reports, and
graph artifacts stay attached to the case:

```bash
cia case open "Exchange deposit clustering" \
  --tags aml,bittensor \
  --description "Trace source funds into exchange entities"
```

After evidence exists, verify and export:

```bash
cia case evidence verify <case-id>
cia case export <case-id> --target obsidian-llmwiki --mode private
```

The default output path is:

```text
published/<case-slug>/
```

Inspect the bundle:

```bash
find published/<case-slug> -maxdepth 3 -type f | sort
```

## Output Files

The export writes:

```text
README.md
Case.md
Agent Console.md
LLMWIKI.md
llms.txt
manifest.chain-insights.json
graph.chain-insights.json
Graph.canvas
Entities/
Evidence/
Prompts/Codex.md
Prompts/Claude-Code.md
Prompts/ChatGPT.md
Sources/evidence-manifest.md
Sources/reports-index.md
```

Use `manifest.chain-insights.json` as the machine-readable source of truth for
case ID, export mode, verification status, file hashes, and redaction warnings.
Use `graph.chain-insights.json` for node/edge import, and `Graph.canvas` for an
Obsidian Canvas view of the same graph.

## Open In Obsidian

1. Open Obsidian.
2. Open the vault switcher.
3. Select **Open folder as vault**.
4. Choose `published/<case-slug>/`.
5. Start with `Case.md`, `Agent Console.md`, and `Graph.canvas`.

Obsidian treats the export directory as a normal vault. It may create a local
`.obsidian/` settings folder inside the export; that file is viewer state, not
Chain Insights evidence.

## Load Into LLM Wiki

LLM Wiki stores topic wikis under `~/wiki/` by default and can ingest local
files. A simple Chain Insights flow is:

```text
/wiki init chain-insights-cases
/wiki:ingest /absolute/path/to/published/<case-slug>/LLMWIKI.md --wiki chain-insights-cases
/wiki:ingest /absolute/path/to/published/<case-slug>/Case.md --wiki chain-insights-cases
/wiki:ingest /absolute/path/to/published/<case-slug>/Agent\ Console.md --wiki chain-insights-cases
/wiki:ingest /absolute/path/to/published/<case-slug>/manifest.chain-insights.json --wiki chain-insights-cases
/wiki:ingest /absolute/path/to/published/<case-slug>/graph.chain-insights.json --wiki chain-insights-cases
/wiki:compile --wiki chain-insights-cases
```

For larger cases, drop selected exported files into the topic wiki inbox and run
LLM Wiki ingestion from there. Keep the original `published/<case-slug>/`
directory unchanged so the Chain Insights manifest hashes remain auditable.

## Use With Codex, Claude Code, Or ChatGPT

For coding-agent sessions, open or attach `published/<case-slug>/` and start
with this instruction:

```text
Read Case.md, Agent Console.md, LLMWIKI.md, manifest.chain-insights.json, and
graph.chain-insights.json first. Treat manifest.chain-insights.json and
Sources/evidence-manifest.md as canonical. Preserve full blockchain addresses
exactly unless this is a public redacted export. Use Chain Insights MCP tools
for fresh graph facts when available.
```

For ChatGPT, upload the smallest useful subset first:

- `Case.md`
- `Agent Console.md`
- `manifest.chain-insights.json`
- `graph.chain-insights.json`
- selected files from `Evidence/` and `Entities/`

## Export Modes

Use the least-shareable mode that fits the audience:

| Mode | Use it for |
| --- | --- |
| `private` | Local analyst work. May include full addresses and sensitive notes. |
| `partner` | Controlled partner handoff. Review the bundle before sharing. |
| `public` | Demos and public writeups. Addresses are aliased and redaction metadata is written to the manifest. |

Do not share `private` exports outside the investigation team.

## MCP Tool Flow

Agents connected through the Chain Insights MCP proxy can create the same
bundle without shelling out:

1. Call `case_verify_evidence` for the case.
2. Call `case_export` with `case_id`, `target=obsidian-llmwiki`, and
   `mode=private`.
3. Open the returned `outputDir`, then read `Agent Console.md` first.

The MCP tool and CLI command write the same file format.
