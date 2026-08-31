#!/usr/bin/env bash
# Render checked-in architecture diagram workspaces into docs/architecture/diagrams/rendered.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# DIAGRAM_REPO_ROOT lets the docs subsystem render a CALLER repo's diagrams with this
# Chain Insights-owned script; defaults to the chain-insights root for the standalone architecture-diagrams.yml.
REPO_ROOT="$(cd "${DIAGRAM_REPO_ROOT:-$SCRIPT_DIR/../..}" && pwd)"
WORKSPACE="$REPO_ROOT/workspace"
mkdir -p "$WORKSPACE"

DIAGRAM_SOURCE_ROOT="$REPO_ROOT/docs/architecture/diagrams"
RENDERED_ROOT="$REPO_ROOT/docs/architecture/diagrams/rendered"
# Pinned by digest so committed renders are reproducible across hosts and CI.
# The "diagrams current on PRs" gate compares the committed tree against a fresh
# render; `:latest` drift made that gate fail spuriously when the upstream image
# moved. To upgrade deliberately: re-pull :latest, re-render, commit the diff,
# and update these digests. (plantuml/plantuml:latest == 1.2026.4 at pin time.)
STRUCTURIZR_IMAGE="${STRUCTURIZR_IMAGE:-structurizr/structurizr@sha256:447b34c11296b88a98975ae496cdf1395ebc3099ef8339e0e1e3a5254c5138e7}"
PLANTUML_IMAGE="${PLANTUML_IMAGE:-plantuml/plantuml@sha256:e0f6fb9cb28defdbcd63320c61d0e98f6cf3302039f881278db8a9cb74c6fed2}"

usage() {
    cat <<'USAGE'
Usage: render-architecture-diagrams.sh [options]

Render every docs/architecture/diagrams/**/workspace.dsl file into checked
docs/architecture/diagrams/rendered/ PlantUML and SVG outputs.

Options:
  --help, -h     Show this help

Environment:
  STRUCTURIZR_IMAGE   Docker image used for Structurizr export
  PLANTUML_IMAGE      Docker image used for PlantUML SVG rendering
USAGE
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Error: unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [ ! -d "$DIAGRAM_SOURCE_ROOT" ]; then
    echo "No diagram source root ($DIAGRAM_SOURCE_ROOT); nothing to render."
    exit 0
fi

docker image inspect "$STRUCTURIZR_IMAGE" >/dev/null 2>&1 || docker pull "$STRUCTURIZR_IMAGE"
docker image inspect "$PLANTUML_IMAGE" >/dev/null 2>&1 || docker pull "$PLANTUML_IMAGE"

rm -rf "$RENDERED_ROOT"
mkdir -p "$RENDERED_ROOT"

workspace_name() {
    local workspace="$1"
    local parent
    parent="$(dirname "$workspace")"
    if [ "$parent" = "$DIAGRAM_SOURCE_ROOT" ]; then
        printf 'global\n'
    else
        basename "$parent"
    fi
}

mapfile -t WORKSPACES < <(find "$DIAGRAM_SOURCE_ROOT" -mindepth 1 -maxdepth 3 -name workspace.dsl -type f | sort)

if [ "${#WORKSPACES[@]}" -eq 0 ]; then
    echo "No workspace.dsl under $DIAGRAM_SOURCE_ROOT; nothing to render."
    exit 0
fi

for workspace in "${WORKSPACES[@]}"; do
    name="$(workspace_name "$workspace")"
    output_dir="$RENDERED_ROOT/$name"
    mkdir -p "$output_dir"

    workspace_rel="${workspace#"$REPO_ROOT"/}"
    output_rel="${output_dir#"$REPO_ROOT"/}"

    echo "Exporting $workspace_rel -> $output_rel"
    docker run --rm \
        --user "$(id -u):$(id -g)" \
        -v "$REPO_ROOT:/usr/local/structurizr" \
        -w /usr/local/structurizr \
        "$STRUCTURIZR_IMAGE" \
        export -workspace "$workspace_rel" -format plantuml/c4plantuml -output "$output_rel"
done

mapfile -t PUML_FILES < <(find "$RENDERED_ROOT" -type f -name '*.puml' | sort)
if [ "${#PUML_FILES[@]}" -eq 0 ]; then
    echo "Error: Structurizr export produced no PlantUML files" >&2
    exit 1
fi

echo "Rendering ${#PUML_FILES[@]} PlantUML file(s) to SVG"
docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp \
    -e JAVA_TOOL_OPTIONS=-Duser.home=/tmp \
    -v "$REPO_ROOT:/workspace" \
    -w /workspace \
    "$PLANTUML_IMAGE" \
    -tsvg "${PUML_FILES[@]#"$REPO_ROOT"/}"

# GitHub will not inline-render repo-hosted SVG inside <img> (anti-XSS content
# type), so we also emit a PNG per diagram. ARCHITECTURE.md embeds the PNG (renders
# in both GitHub web and VSCode preview) and links the SVG as the crisp vector.
echo "Rendering ${#PUML_FILES[@]} PlantUML file(s) to PNG"
docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp \
    -e JAVA_TOOL_OPTIONS=-Duser.home=/tmp \
    -v "$REPO_ROOT:/workspace" \
    -w /workspace \
    "$PLANTUML_IMAGE" \
    -tpng "${PUML_FILES[@]#"$REPO_ROOT"/}"

# PlantUML may create a root-level Java font cache when the container UID has no
# passwd entry. It is generated local state, not repo content.
rm -rf "$REPO_ROOT/?"

# Backlink header: ARCHITECTURE.md exists in every repo; repositories.md is repository-root-only.
{
    echo "# Rendered Architecture Diagrams"
    echo ""
    printf '%s' "> Back to [architecture](../../ARCHITECTURE.md)"
    [ -f "$REPO_ROOT/docs/architecture/repositories.md" ] && printf '%s' " · [repository index](../../repositories.md)"
    echo ""
} > "$RENDERED_ROOT/README.md"
cat >> "$RENDERED_ROOT/README.md" <<'EOF'

This directory is generated from `docs/architecture/diagrams/**/workspace.dsl`.

Regenerate with:

```bash
bash scripts/devops/render-architecture-diagrams.sh
```

Do not edit rendered `.puml` or `.svg` files by hand.
EOF

find "$RENDERED_ROOT" -type f | sort
