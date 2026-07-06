package cyphersql

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

// mapping.json is a copy of the graph→StarRocks view mapping (formerly
// ops/memgql/chain_insights_starrocks_mapping.json). Embedding it keeps the
// translator's identifier allowlist self-contained after the MemGQL ops
// directory is removed. It is the SINGLE source of truth for which labels,
// relationship types, and properties compile, and to which views/columns.
//
//go:embed mapping.json
var mappingJSON []byte

type nodeMapping struct {
	Label      string            `json:"label"`
	Table      string            `json:"table"`
	IDColumn   string            `json:"id_column"`
	Properties map[string]string `json:"properties"`
}

type edgeMapping struct {
	RelType      string            `json:"rel_type"`
	Table        string            `json:"table"`
	IDColumn     string            `json:"id_column"`
	SourceColumn string            `json:"source_column"`
	TargetColumn string            `json:"target_column"`
	SourceLabel  string            `json:"source_label"`
	TargetLabel  string            `json:"target_label"`
	Properties   map[string]string `json:"properties"`
}

type schemaMapping struct {
	nodes map[string]nodeMapping
	edges map[string]edgeMapping
}

var mapping = mustLoadMapping()

func mustLoadMapping() schemaMapping {
	var raw struct {
		Nodes []nodeMapping `json:"nodes"`
		Edges []edgeMapping `json:"edges"`
	}
	if err := json.Unmarshal(mappingJSON, &raw); err != nil {
		panic(fmt.Sprintf("cyphersql: embedded mapping.json is invalid: %v", err))
	}
	s := schemaMapping{
		nodes: make(map[string]nodeMapping, len(raw.Nodes)),
		edges: make(map[string]edgeMapping, len(raw.Edges)),
	}
	for _, n := range raw.Nodes {
		s.nodes[n.Label] = n
	}
	for _, e := range raw.Edges {
		s.edges[e.RelType] = e
	}
	return s
}

// resolveNode returns the mapping for a node label or an ErrUnknownIdentifier.
func (s schemaMapping) resolveNode(label string, pos int) (nodeMapping, error) {
	n, ok := s.nodes[label]
	if !ok {
		return nodeMapping{}, newErr(ErrUnknownIdentifier, pos, "node label %q is not mapped", label)
	}
	return n, nil
}

// resolveEdge returns the mapping for a relationship type or an error.
func (s schemaMapping) resolveEdge(relType string, pos int) (edgeMapping, error) {
	e, ok := s.edges[relType]
	if !ok {
		return edgeMapping{}, newErr(ErrUnknownIdentifier, pos, "relationship type %q is not mapped", relType)
	}
	return e, nil
}

// column resolves a node property name to its StarRocks column, or errors.
func (n nodeMapping) column(prop string, pos int) (string, error) {
	col, ok := n.Properties[prop]
	if !ok {
		return "", newErr(ErrUnknownIdentifier, pos, "property %q is not mapped on label %q", prop, n.Label)
	}
	return col, nil
}

// column resolves an edge property name to its StarRocks column, or errors.
func (e edgeMapping) column(prop string, pos int) (string, error) {
	col, ok := e.Properties[prop]
	if !ok {
		return "", newErr(ErrUnknownIdentifier, pos, "property %q is not mapped on relationship %q", prop, e.RelType)
	}
	return col, nil
}
