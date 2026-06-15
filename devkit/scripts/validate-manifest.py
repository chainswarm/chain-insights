#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEVKIT_ROOT = SCRIPT_DIR.parent
REPO_ROOT = SCRIPT_DIR.parents[4]
MANIFEST = DEVKIT_ROOT / "data/manifest.json"
MAPPING = REPO_ROOT / "repos/ml/data-pipeline/ops/memgql/chain_insights_starrocks_mapping.json"

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

OPTIONAL_EXPOSURE_TABLES = {
    "archive_exposure_nodes_view",
    "archive_exposure_instruments_view",
    "archive_exposure_edges_has_exposure_view",
    "archive_exposure_edges_targets_instrument_view",
    "archive_exposure_edges_owns_exposure_view",
    "archive_exposure_edges_has_counterparty_view",
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


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def mapped_facade_tables() -> set[str]:
    mapping = read_json(MAPPING)
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


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    manifest = read_json(MANIFEST)
    if manifest.get("schema") != "chain-insights.devkit.fixture.v1":
        fail("manifest schema must be chain-insights.devkit.fixture.v1")
    if manifest.get("network") != "bittensor":
        fail("manifest network must be bittensor")
    if manifest.get("semantic_database") != "bittensor_semantic":
        fail("manifest semantic_database must be bittensor_semantic")
    if manifest.get("fixture_window", {}).get("from") != "source-min":
        fail("manifest fixture_window.from must be source-min")
    if manifest.get("fixture_window", {}).get("to_exclusive") != "2026-01-01T00:00:00Z":
        fail("manifest fixture_window.to_exclusive must be 2026-01-01T00:00:00Z")

    coverage = manifest.get("coverage", {})
    if int(coverage.get("substrate_rows", 0)) <= 0:
        fail("manifest coverage.substrate_rows must be positive")
    if int(coverage.get("evm_pallet_rows", 0)) <= 0:
        fail("manifest coverage.evm_pallet_rows must be positive")

    objects = manifest.get("objects", [])
    names = {entry.get("name", "") for entry in objects}
    allowed = mapped_facade_tables() | OPTIONAL_EXPOSURE_TABLES
    missing_required = REQUIRED_TABLES - names
    unknown = names - allowed
    if missing_required:
        fail(f"manifest missing required tables: {sorted(missing_required)}")
    if unknown:
        fail(f"manifest contains non-mapped tables: {sorted(unknown)}")

    for entry in objects:
        name = entry.get("name", "")
        lowered = name.lower()
        for forbidden in DENYLIST:
            if forbidden in lowered:
                fail(f"manifest object {name} contains denylisted term {forbidden}")
        if entry.get("database") != "bittensor_semantic":
            fail(f"manifest object {name} must use bittensor_semantic")
        if entry.get("exported_min") != entry.get("source_min"):
            fail(f"manifest object {name} exported_min must equal source_min")
        if str(entry.get("exported_max", "")) >= "2026-01-01T00:00:00Z":
            fail(f"manifest object {name} exported_max must be before 2026-01-01T00:00:00Z")
        rel_path = entry.get("path", "")
        file_path = DEVKIT_ROOT / "data" / rel_path
        if not file_path.is_file():
            fail(f"manifest object {name} file missing: {rel_path}")
        expected_sha = entry.get("sha256", "")
        actual_sha = sha256(file_path)
        if actual_sha != expected_sha:
            fail(f"manifest object {name} checksum mismatch: {actual_sha} != {expected_sha}")

    print(f"validated {len(objects)} devkit fixture objects")


if __name__ == "__main__":
    main()
