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

# facts_neuron_endpoints_view, facts_neuron_hotkeys_view, and
# facts_neuron_ip_addresses_view retired 2026-07-21 (rbmk migration 0031):
# neuron identity, hotkey/coldkey pairing, and IP/axon-port observation now
# live on the topology :Neuron node and MINES/VALIDATES/HOTKEY_OF/COLDKEY_OF
# edges (rbmk#447 P4'-lite). The rbmk exporter no longer emits them and the
# vendored cyphersql mapping no longer maps them (mirrors data-pipeline
# 75ce9c96), so their tsv.gz fixtures are dead weight the devkit can never
# serve -- dropped from the manifest and REQUIRED_TABLES together with this
# retirement.
#
# facts_address_features_view retired 2026-08-28 (rbmk migration 0033): the
# view was dropped in production and the vendored cyphersql mapping no longer
# maps AddressFeature / HAS_FEATURE (Address stays a TRANSFER endpoint only),
# so its tsv.gz fixture is dead weight too -- dropped from the manifest and
# REQUIRED_TABLES together with the mapping alignment (facts partition-pruning
# wave, plan 2026-08-28-facts-serving-partition-pruning Task 5).
#
# facts_transfers_view (rbmk#447 P5) shipped its capped, address-scoped
# TSV export (rbmk export-starrocks-fixture.sh) -- it is now a normal
# REQUIRED_TABLES entry like every other mapped table.
REQUIRED_TABLES = {
    "facts_transfers_view",
}

# A mapped table whose fixture export legitimately lags its mapping landing
# (mirrors facts_transfers_view's own now-closed gap).
#
# facts_assets_view: the Asset label is part of the production serving contract
# the devkit tracks (the fake-token recipe reads it), so it is mapped and its
# empty facade table is created; the asset-registry fixture export is a
# follow-up. Queries return zero rows instead of failing on an unmapped label.
ALLOWED_UNEXPORTED_TABLES: set[str] = {
    "facts_assets_view",
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

    # StarRocks-derived coverage keys (substrate_rows, evm_pallet_rows,
    # address_count, linked_pair_count, flow_edge_count) retired 2026-07-21
    # with the legacy archive-tier topology and facts_address_labels_view exports (rbmk#447
    # P2b'/P4'-lite; rbmk export-starrocks-fixture.sh no longer emits them).
    # Memgraph-side coverage keys remain asserted below where present; the
    # coverage object itself is optional pass-through now.

    if "uat" in manifest:
        fail("manifest must not contain UAT-only metadata")

    objects = manifest.get("objects", [])
    names = {entry.get("name", "") for entry in objects}
    allowed = mapped_facade_tables()
    starrocks_names = names - MEMGRAPH_OBJECTS
    missing_required = REQUIRED_TABLES - starrocks_names
    missing_mapped = allowed - starrocks_names - ALLOWED_UNEXPORTED_TABLES
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
        # Scan every part, not just paths[0]: once an object splits across
        # multiple .part-NNN.gz files (address-grain revert edge-count
        # growth made this routine for both TSV and, now, JSONL exports),
        # a placeholder/forbidden marker landing in part 001+ must still
        # fail the check -- restricting either scan to the single- or
        # first-part case would silently stop covering split fixtures.
        for part_path in paths:
            fail_on_placeholder_file(part_path)
        expected_sha = entry.get("sha256", "")
        actual_sha = sha256_paths(paths) if entry.get("parts") else sha256(paths[0])
        if actual_sha != expected_sha:
            fail(f"manifest object {name} checksum mismatch: {actual_sha} != {expected_sha}")
        if is_memgraph_object:
            for part_path in paths:
                opener = gzip.open if part_path.suffix == ".gz" else open
                with opener(part_path, "rt", encoding="utf-8", errors="replace") as handle:
                    payload = handle.read()
                for marker in FORBIDDEN_MEMGRAPH_MARKERS:
                    if marker in payload:
                        fail(f"manifest object {name} contains forbidden Memgraph marker: {marker}")

    object_paths = {entry.get("name", ""): fixture_part_paths(entry) for entry in objects}
    check_memgraph_endpoint_integrity(object_paths)

    print(f"validated {len(objects)} devkit fixture objects")


def _read_jsonl_gz(paths: list[Path]):
    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    yield json.loads(line)


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


if __name__ == "__main__":
    main()
