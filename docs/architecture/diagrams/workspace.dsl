workspace "Chain Insights Repository" "Repository-scoped C4 model for repos/infra/chain-insights." {
    model {
        investigator = person "Investigator / Agent" "Uses CLI, ChatGPT, Codex, Claude Code, or MCP clients to investigate blockchain activity."
        graphMcp = softwareSystem "Data Pipeline GraphRAG MCP" "Public MCP endpoint serving graph queries, risk tools, and quota metadata."
        amlAcp = softwareSystem "AML ACP" "Marketplace bridge that calls Chain Insights workflows through the proxy."

        chainInsights = softwareSystem "Chain Insights Toolkit" "Open-source AML investigation package, CLI, MCP proxy, and graph analysis tooling." {
            ciaCli = container "cia CLI" "Command-line interface for configuration, wallet operations, and graph tool calls." "TypeScript CLI" {
                configResolver = component "Config Resolver" "Resolves graphMcpEndpoint, auth token, and hosted/local endpoint precedence." "src/config"
                mcpClient = component "Graph MCP Client" "Calls GraphRAG MCP tools and refreshes tool catalogues." "src/mcp"
                amlWorkflows = component "AML Workflow Commands" "Runs address risk and graph query workflows." "src/investigation"
                installer = component "Agent Installer" "Installs MCP proxy configuration for local agent clients." "bin/install.cjs"
            }
            mcpProxy = container "MCP Proxy" "Stdio or local proxy surface that lets agent clients call Chain Insights tools." "TypeScript / MCP"
            npmPackage = container "NPM Package" "Published package containing CLI, proxy, docs, and installer assets." "npm"
        }

        investigator -> ciaCli "Runs investigation and setup commands"
        investigator -> mcpProxy "Calls tools from agent clients"
        amlAcp -> mcpProxy "Uses proxy mode for curated paid workflows"
        ciaCli -> graphMcp "Calls graph tools and AML primitives"
        mcpProxy -> graphMcp "Proxies configured tools"
        npmPackage -> ciaCli "Packages CLI entrypoint"
        npmPackage -> mcpProxy "Packages proxy entrypoint"

        configResolver -> mcpClient "Provides endpoint and auth config"
        mcpClient -> graphMcp "Calls public MCP tools"
        amlWorkflows -> mcpClient "Composes graph tool calls"
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
