#!/usr/bin/env python3
import hashlib
import gzip
import json
import os
from datetime import datetime, timezone
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEVKIT_ROOT = SCRIPT_DIR.parent
MANIFEST = DEVKIT_ROOT / "data/manifest.json"
# Post MemGQL retirement the graph mapping is sourced from the devkit's own
# vendored translator asset (the old data-pipeline federation mapping is
# deleted). In-container it is bind-mounted at /mapping; on host it is read
# directly.
VENDORED_MAPPING = (
    DEVKIT_ROOT / "chain-insights-graph-devkit/internal/cyphersql/mapping.json"
)
MAPPING_CANDIDATES = [
    Path(os.environ["MEMGQL_STARROCKS_MAPPING_FILE"])
    if os.environ.get("MEMGQL_STARROCKS_MAPPING_FILE")
    else None,
    Path("/mapping/chain_insights_starrocks_mapping.json"),
    VENDORED_MAPPING,
]

REQUIRED_TABLES = {
    "archive_topology_addresses_view",
    "archive_topology_edges_view",
    "archive_topology_snapshot_view",
    "linked_addresses_view",
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


def sha256_paths(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def fixture_part_paths(entry: dict) -> list[Path]:
    parts = entry.get("parts") or []
    if not parts:
        rel_path = entry.get("path", "")
        return [DEVKIT_ROOT / "data" / rel_path]
    paths: list[Path] = []
    for part in parts:
        rel_path = part.get("path", "")
        path = DEVKIT_ROOT / "data" / rel_path
        paths.append(path)
    return paths


def validate_parts(entry: dict) -> None:
    parts = entry.get("parts") or []
    if not parts:
        return
    row_count = 0
    for part in parts:
        rel_path = part.get("path", "")
        relative_path = Path(rel_path)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            fail(f"manifest object {entry.get('name', '')} part path is unsafe: {rel_path}")
        path = DEVKIT_ROOT / "data" / rel_path
        if not path.is_file():
            fail(f"manifest object {entry.get('name', '')} part file missing: {rel_path}")
        fail_on_placeholder_file(path)
        expected_sha = part.get("sha256", "")
        actual_sha = sha256(path)
        if actual_sha != expected_sha:
            fail(f"manifest object {entry.get('name', '')} part checksum mismatch: {actual_sha} != {expected_sha}")
        row_count += int(part.get("row_count", 0))
    if row_count != int(entry.get("row_count", 0)):
        fail(f"manifest object {entry.get('name', '')} part row counts do not sum to row_count")


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


def parse_iso8601(value: object):
    if not value:
        return None
    text = str(value).strip()
    try:
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def main() -> None:
    if not MANIFEST.is_file():
        fail("manifest missing; run bash scripts/devops/chain-insights-devkit/build-fixture.sh from the RBMK root with StarRocks export credentials")
    manifest = read_json(MANIFEST)
    if manifest.get("schema") != "chain-insights.devkit.fixture.v1":
        fail("manifest schema must be chain-insights.devkit.fixture.v1")
    if manifest.get("network") != "bittensor":
        fail("manifest network must be bittensor")
    if manifest.get("database") != "bittensor":
        fail("manifest database must be bittensor")
    # fixture_window.to_exclusive is pinned to a live coverage watermark on
    # every build, not a fixed historical literal, so this validates
    # internal consistency of the manifest's own declared window (a valid,
    # later-than-from timestamp) rather than an exact-match against a
    # stale date -- an exact-match check would reject every fixture built
    # after whatever date it was written against.
    fixture_window = manifest.get("fixture_window", {})
    if fixture_window.get("from") != "2024-01-01T00:00:00Z":
        fail("manifest fixture_window.from must be 2024-01-01T00:00:00Z")
    lower_bound_dt = parse_iso8601(fixture_window.get("from"))
    upper_bound_text = fixture_window.get("to_exclusive")
    upper_bound_dt = parse_iso8601(upper_bound_text)
    if upper_bound_dt is None:
        fail(f"manifest fixture_window.to_exclusive is not a valid ISO-8601 timestamp: {upper_bound_text!r}")
    if upper_bound_dt <= lower_bound_dt:
        fail("manifest fixture_window.to_exclusive must be after fixture_window.from")

    coverage = manifest.get("coverage", {})
    if int(coverage.get("substrate_rows", 0)) <= 0:
        fail("manifest coverage.substrate_rows must be positive")
    if int(coverage.get("evm_pallet_rows", 0)) <= 0:
        fail("manifest coverage.evm_pallet_rows must be positive")
    for key in ("address_count", "linked_pair_count", "flow_edge_count"):
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
        expected_database = "memgraph" if is_memgraph_object else "bittensor"
        expected_format = "jsonl.gz" if is_memgraph_object else "tsv.gz"
        if entry.get("database") != expected_database:
            fail(f"manifest object {name} must use {expected_database}")
        if entry.get("format") != expected_format:
            fail(f"manifest object {name} must use {expected_format}")
        if entry.get("exported_min") != entry.get("source_min"):
            fail(f"manifest object {name} exported_min must equal source_min")
        if str(entry.get("exported_max", "")) >= upper_bound_text:
            fail(f"manifest object {name} exported_max must be before {upper_bound_text} (fixture_window.to_exclusive)")
        paths = fixture_part_paths(entry)
        for file_path in paths:
            if not file_path.is_file():
                fail(f"manifest object {name} file missing: {file_path.relative_to(DEVKIT_ROOT / 'data')}")
        validate_parts(entry)
        if not entry.get("parts"):
            fail_on_placeholder_file(paths[0])
        expected_sha = entry.get("sha256", "")
        actual_sha = sha256_paths(paths) if entry.get("parts") else sha256(paths[0])
        if actual_sha != expected_sha:
            fail(f"manifest object {name} checksum mismatch: {actual_sha} != {expected_sha}")
        if is_memgraph_object:
            opener = gzip.open if paths[0].suffix == ".gz" else open
            with opener(paths[0], "rt", encoding="utf-8", errors="replace") as handle:
                payload = handle.read()
            for marker in FORBIDDEN_MEMGRAPH_MARKERS:
                if marker in payload:
                    fail(f"manifest object {name} contains forbidden Memgraph marker: {marker}")

    object_paths = {entry.get("name", ""): fixture_part_paths(entry) for entry in objects}
    check_memgraph_endpoint_integrity(object_paths)
    check_symmetric_label_parity(object_paths)

    print(f"validated {len(objects)} devkit fixture objects")


def _read_jsonl_gz(paths: list[Path]):
    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    yield json.loads(line)


def _read_tsv_gz(paths: list[Path]):
    import csv

    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
            yield from csv.DictReader(handle, delimiter="\t")


# The AML label taxonomy entries that ARE derivable from
# archive_topology_addresses_view's exported label text (mirrors
# scripts/devops/chain-insights-devkit/export-memgraph-fixture.py's
# LABEL_TEXT_DERIVED_TAXONOMY in the sibling RBMK root repo). Scam, Victim,
# Propagated, Mixer, Bridge, Poisoned are out of scope for this parity
# check -- they derive from address_type/source columns the exported
# addresses view does not carry.
LABEL_TEXT_DERIVED_TAXONOMY = {"Exchange", "Validator", "Miner", "Subnet"}


def check_memgraph_endpoint_integrity(object_paths: dict[str, list[Path]]) -> None:
    node_paths = object_paths.get("memgraph_nodes")
    relationship_paths = object_paths.get("memgraph_relationships")
    if not node_paths or not relationship_paths:
        return
    node_ids = {str(row["id"]) for row in _read_jsonl_gz(node_paths)}
    missing_endpoints = set()
    for row in _read_jsonl_gz(relationship_paths):
        start_id = str(row["start_id"])
        end_id = str(row["end_id"])
        if start_id not in node_ids:
            missing_endpoints.add(start_id)
        if end_id not in node_ids:
            missing_endpoints.add(end_id)
    if missing_endpoints:
        fail(
            "manifest Memgraph fixture is internally inconsistent: "
            f"{len(missing_endpoints)} relationship endpoint id(s) missing from the nodes dump, "
            f"e.g. {sorted(missing_endpoints)[:10]}"
        )


def check_symmetric_label_parity(object_paths: dict[str, list[Path]]) -> None:
    addresses_paths = object_paths.get("archive_topology_addresses_view")
    edges_paths = object_paths.get("archive_topology_edges_view")
    node_paths = object_paths.get("memgraph_nodes")
    if not addresses_paths or not edges_paths or not node_paths:
        return

    archive_labels: dict[str, str] = {}
    for row in _read_tsv_gz(addresses_paths):
        labels_text = (row.get("labels") or "").strip()
        if labels_text:
            archive_labels[row["address"]] = labels_text

    edge_connected: set[str] = set()
    for row in _read_tsv_gz(edges_paths):
        edge_connected.add(row["from_address"])
        edge_connected.add(row["to_address"])

    archive_labeled_and_connected = set(archive_labels) & edge_connected

    memgraph_labeled: dict[str, dict] = {}
    for row in _read_jsonl_gz(node_paths):
        properties = row.get("properties", {})
        address = properties.get("address")
        if address is None:
            continue
        has_label_property = bool(properties.get("labels"))
        taxonomy_labels = set(row.get("labels", [])) & LABEL_TEXT_DERIVED_TAXONOMY
        if has_label_property or taxonomy_labels:
            memgraph_labeled[address] = {
                "has_label_property": has_label_property,
                "taxonomy_labels": taxonomy_labels,
            }

    # Direction 1: every archive-labeled-and-edge-connected address must
    # exist in Memgraph with a non-empty labels property.
    missing_in_memgraph = [
        address
        for address in archive_labeled_and_connected
        if address not in memgraph_labeled or not memgraph_labeled[address]["has_label_property"]
    ]
    if missing_in_memgraph:
        fail(
            "manifest fixture fails cross-tier label parity: "
            f"{len(missing_in_memgraph)} archive-labeled-and-connected addresses missing "
            f"labels in the Memgraph dump, e.g. {sorted(missing_in_memgraph)[:10]}"
        )

    # Direction 2: no Memgraph node's labels property or
    # LABEL_TEXT_DERIVED_TAXONOMY structural label may reference an
    # address absent from the StarRocks-bounded allowlist (a
    # post-watermark leak through the Memgraph export leg).
    leaked = [
        address
        for address, state in memgraph_labeled.items()
        if address not in archive_labels
        and (state["has_label_property"] or state["taxonomy_labels"])
    ]
    if leaked:
        fail(
            "manifest fixture fails cross-tier label parity: "
            f"{len(leaked)} Memgraph addresses carry labels/taxonomy absent from the "
            f"StarRocks-bounded allowlist (post-watermark leak), e.g. {sorted(leaked)[:10]}"
        )


if __name__ == "__main__":
    main()
