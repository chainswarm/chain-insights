#!/usr/bin/env python3
import hashlib
import gzip
import json
import os
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEVKIT_ROOT = SCRIPT_DIR.parent
REPO_ROOT = SCRIPT_DIR.parents[4] if len(SCRIPT_DIR.parents) > 4 else Path("/")
MANIFEST = DEVKIT_ROOT / "data/manifest.json"
MAPPING_REL = "repos/ml/data-pipeline/ops/memgql/chain_insights_starrocks_mapping.json"
MAPPING_CANDIDATES = [
    Path(os.environ["MEMGQL_STARROCKS_MAPPING_FILE"])
    if os.environ.get("MEMGQL_STARROCKS_MAPPING_FILE")
    else None,
    Path("/mapping/chain_insights_starrocks_mapping.json"),
    REPO_ROOT / MAPPING_REL,
]

REQUIRED_TABLES = {
    "archive_topology_addresses_view",
    "archive_topology_edges_view",
    "archive_topology_snapshot_view",
    "archive_identity_address_links_view",
    "facts_address_labels_view",
    "facts_address_features_view",
    "facts_assets_view",
    "facts_risk_scores_view",
    "facts_neuron_endpoints_view",
    "facts_neuron_hotkeys_view",
    "facts_neuron_ip_addresses_view",
}

MEMGRAPH_OBJECTS = {
    "memgraph_nodes",
    "memgraph_relationships",
}

DENYLIST = {
    "_sync_state",
    "_indexer_checkpoints",
    "core_block_stream",
    "graphsync",
    "wallet",
    "payment",
    "quota",
    "telemetry",
}

PLACEHOLDER_MARKERS = (
    "5devkit",
    "devkit_seed",
    "devkit_peer",
    "devkit-flow",
    "devkit-tx",
    "chain-insights-devkit",
)

FORBIDDEN_MEMGRAPH_MARKERS = (
    "GlobalState",
    "_sync_state",
    "_indexer_checkpoints",
)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def mapping_path() -> Path:
    for candidate in MAPPING_CANDIDATES:
        if candidate is not None and candidate.is_file():
            return candidate
    fail(f"MemGQL mapping file not found; checked {MAPPING_CANDIDATES}")


def mapped_facade_tables() -> set[str]:
    mapping = read_json(mapping_path())
    tables: set[str] = set()
    for section in ("nodes", "edges"):
        for entry in mapping[section]:
            tables.add(entry["table"])
    return tables


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail_on_placeholder_value(context: str, value: object) -> None:
    text = str(value or "").lower()
    for marker in PLACEHOLDER_MARKERS:
        if marker in text:
            fail(f"{context} contains synthetic devkit placeholder marker: {marker}")


def fail_on_placeholder_file(path: Path) -> None:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            lowered = chunk.lower()
            for marker in PLACEHOLDER_MARKERS:
                if marker.encode("utf-8") in lowered:
                    fail(f"{path} contains synthetic devkit placeholder marker: {marker}")


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    if not MANIFEST.is_file():
        fail("manifest missing; run bash scripts/devops/chain-insights-devkit/build-fixture.sh from the RBMK root with StarRocks export credentials")
    manifest = read_json(MANIFEST)
    if manifest.get("schema") != "chain-insights.devkit.fixture.v1":
        fail("manifest schema must be chain-insights.devkit.fixture.v1")
    if manifest.get("network") != "bittensor":
        fail("manifest network must be bittensor")
    if manifest.get("semantic_database") != "bittensor_semantic":
        fail("manifest semantic_database must be bittensor_semantic")
    if manifest.get("fixture_window", {}).get("from") != "2024-01-01T00:00:00Z":
        fail("manifest fixture_window.from must be 2024-01-01T00:00:00Z")
    if manifest.get("fixture_window", {}).get("to_exclusive") != "2026-07-03T00:00:00Z":
        fail("manifest fixture_window.to_exclusive must be 2026-07-03T00:00:00Z")

    coverage = manifest.get("coverage", {})
    if int(coverage.get("substrate_rows", 0)) <= 0:
        fail("manifest coverage.substrate_rows must be positive")
    if int(coverage.get("evm_pallet_rows", 0)) <= 0:
        fail("manifest coverage.evm_pallet_rows must be positive")
    for key in ("identity_count", "member_address_count", "flow_edge_count"):
        if int(coverage.get(key, 0)) <= 0:
            fail(f"manifest coverage.{key} must be positive")

    if "uat" in manifest:
        fail("manifest must not contain UAT-only metadata")

    objects = manifest.get("objects", [])
    names = {entry.get("name", "") for entry in objects}
    allowed = mapped_facade_tables()
    starrocks_names = names - MEMGRAPH_OBJECTS
    missing_required = REQUIRED_TABLES - starrocks_names
    missing_mapped = allowed - starrocks_names
    missing_memgraph = MEMGRAPH_OBJECTS - names
    unknown = names - allowed - MEMGRAPH_OBJECTS
    if missing_required:
        fail(f"manifest missing required tables: {sorted(missing_required)}")
    if missing_mapped:
        fail(f"manifest missing mapped tables: {sorted(missing_mapped)}")
    if missing_memgraph:
        fail(f"manifest missing Memgraph fixture objects: {sorted(missing_memgraph)}")
    if unknown:
        fail(f"manifest contains non-mapped tables: {sorted(unknown)}")

    for entry in objects:
        name = entry.get("name", "")
        lowered = name.lower()
        for forbidden in DENYLIST:
            if forbidden in lowered:
                fail(f"manifest object {name} contains denylisted term {forbidden}")
        is_memgraph_object = name in MEMGRAPH_OBJECTS
        expected_database = "memgraph" if is_memgraph_object else "bittensor_semantic"
        expected_format = "jsonl.gz" if is_memgraph_object else "tsv.gz"
        if entry.get("database") != expected_database:
            fail(f"manifest object {name} must use {expected_database}")
        if entry.get("format") != expected_format:
            fail(f"manifest object {name} must use {expected_format}")
        if entry.get("exported_min") != entry.get("source_min"):
            fail(f"manifest object {name} exported_min must equal source_min")
        if str(entry.get("exported_max", "")) >= "2026-07-03T00:00:00Z":
            fail(f"manifest object {name} exported_max must be before 2026-07-03T00:00:00Z")
        rel_path = entry.get("path", "")
        file_path = DEVKIT_ROOT / "data" / rel_path
        if not file_path.is_file():
            fail(f"manifest object {name} file missing: {rel_path}")
        fail_on_placeholder_file(file_path)
        expected_sha = entry.get("sha256", "")
        actual_sha = sha256(file_path)
        if actual_sha != expected_sha:
            fail(f"manifest object {name} checksum mismatch: {actual_sha} != {expected_sha}")
        if is_memgraph_object:
            opener = gzip.open if file_path.suffix == ".gz" else open
            with opener(file_path, "rt", encoding="utf-8", errors="replace") as handle:
                payload = handle.read()
            for marker in FORBIDDEN_MEMGRAPH_MARKERS:
                if marker in payload:
                    fail(f"manifest object {name} contains forbidden Memgraph marker: {marker}")

    print(f"validated {len(objects)} devkit fixture objects")


if __name__ == "__main__":
    main()
