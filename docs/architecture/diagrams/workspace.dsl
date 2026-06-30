workspace "Chain Insights Repository" "Repository-scoped C4 model for repos/infra/chain-insights." {
    model {
        investigator = person "Investigator / Agent" "Uses CLI, ChatGPT, Codex, Claude Code, or MCP clients to investigate blockchain activity."
        rbmk = softwareSystem "RBMK Control Center" "Runs npm release smoke checks, staging validation, and docs workflows."
        graphMcp = softwareSystem "Data Pipeline GraphRAG MCP" "Public MCP endpoint serving graph queries, risk tools, quota, and report metadata."
        amlAcp = softwareSystem "AML ACP" "Marketplace bridge that calls Chain Insights workflows through the proxy."
        obsidian = softwareSystem "Obsidian / LLM Wiki" "Optional local knowledge workspace and exported investigation bundle target."

        chainInsights = softwareSystem "Chain Insights Toolkit" "Open-source AML investigation package, CLI, workspace manager, MCP proxy, and case evidence tooling." {
            ciaCli = container "cia CLI" "Command-line interface for workspace setup, case workflows, exports, and graph tool calls." "TypeScript CLI" {
                configResolver = component "Config Resolver" "Resolves graphMcpEndpoint, auth token, workspace paths, and hosted/local endpoint precedence." "src/config"
                mcpClient = component "Graph MCP Client" "Calls GraphRAG MCP tools and refreshes tool catalogues." "src/mcp"
                amlWorkflows = component "AML Workflow Commands" "Runs address risk, staking, trace, and graph query workflows." "src/workflows"
                caseManager = component "Case Manager" "Creates, resumes, verifies, and updates local case evidence manifests." "src/cases"
                exportBuilder = component "Export Builder" "Builds Obsidian, LLM Wiki, Codex, Claude Code, and ChatGPT handoff bundles." "src/export"
                installer = component "Agent Installer" "Installs MCP proxy configuration for local agent clients." "src/install"
            }
            mcpProxy = container "MCP Proxy" "Stdio or local proxy surface that lets agent clients call Chain Insights tools." "TypeScript / MCP"
            workspaceStore = container "Local Workspace Store" "Filesystem workspace containing cases, evidence manifests, dossiers, exports, and config." "Files"
            npmPackage = container "NPM Package" "Published package containing CLI, proxy, docs, and installer assets." "npm"
        }

        investigator -> ciaCli "Runs investigation and setup commands"
        investigator -> mcpProxy "Calls tools from agent clients"
        rbmk -> npmPackage "Validates release smoke checks"
        amlAcp -> mcpProxy "Uses proxy mode for curated paid workflows"
        ciaCli -> graphMcp "Calls graph tools and AML primitives"
        mcpProxy -> graphMcp "Proxies configured tools"
        ciaCli -> workspaceStore "Writes local cases, evidence, config, and exports"
        mcpProxy -> workspaceStore "Uses local workspace configuration"
        ciaCli -> obsidian "Opens or exports curated investigation bundles"
        npmPackage -> ciaCli "Packages CLI entrypoint"
        npmPackage -> mcpProxy "Packages proxy entrypoint"

        configResolver -> mcpClient "Provides endpoint and auth config"
        mcpClient -> graphMcp "Calls public MCP tools"
        amlWorkflows -> mcpClient "Composes graph and trace calls"
        amlWorkflows -> caseManager "Stores compact evidence pointers"
        caseManager -> workspaceStore "Writes manifests, dossiers, and sessions"
        exportBuilder -> workspaceStore "Reads cases and evidence"
        exportBuilder -> obsidian "Writes handoff bundles"
        installer -> workspaceStore "Writes client proxy configuration"
    }

    views {
        systemContext chainInsights "chain-insights-context" {
            include *
            autoLayout lr
        }

        container chainInsights "chain-insights-containers" {
            include *
            autoLayout lr
        }

        component ciaCli "chain-insights-components" {
            include *
            autoLayout lr
        }

        styles {
            element "Person" {
                shape person
                background "#08427b"
                color "#ffffff"
            }
            element "Software System" {
                background "#1168bd"
                color "#ffffff"
            }
            element "Container" {
                background "#438dd5"
                color "#ffffff"
            }
            element "Component" {
                background "#85bbf0"
                color "#111827"
            }
            relationship "Relationship" {
                color "#666666"
            }
        }
    }
}
