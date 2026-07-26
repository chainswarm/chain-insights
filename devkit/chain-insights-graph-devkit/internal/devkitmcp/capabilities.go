package devkitmcp

type NetworkCapability struct {
	Network       string            `json:"network"`
	DisplayName   string            `json:"display_name"`
	Status        string            `json:"status"`
	Default       bool              `json:"default"`
	FixtureWindow string            `json:"fixture_window"`
	Layers        map[string]Layer  `json:"layers"`
	Tools         map[string]string `json:"tools"`
}

// Layer mirrors the production capability shape: the topology layer carries
// live/archive tier sublayers with their timeout ceilings; facts and risk
// stay flat.
type Layer struct {
	Enabled bool       `json:"enabled"`
	Live    *TierLayer `json:"live,omitempty"`
	Archive *TierLayer `json:"archive,omitempty"`
}

type TierLayer struct {
	Enabled        bool `json:"enabled"`
	TimeoutSeconds int  `json:"timeout_seconds"`
}

type NetworkCapabilitiesDocument struct {
	Schema   string              `json:"schema"`
	Networks []NetworkCapability `json:"networks"`
}

func devkitTools() map[string]string {
	return map[string]string{
		"network_capabilities": "available",
		"usage_status":         "available",
		"graph_query":          "available",
		"graph_query_batch":    "available",
	}
}

func NetworkDocument() NetworkCapabilitiesDocument {
	return NetworkCapabilitiesDocument{
		Schema: "chain-insights.network-capabilities.v1",
		Networks: []NetworkCapability{{
			Network:       "bittensor",
			DisplayName:   "Bittensor",
			Status:        "devkit",
			Default:       true,
			FixtureWindow: "2024-01-01..2026-07-02",
			Layers: map[string]Layer{
				"topology": {
					Enabled: true,
					Live:    &TierLayer{Enabled: true, TimeoutSeconds: liveTierTimeoutSeconds},
					Archive: &TierLayer{Enabled: true, TimeoutSeconds: starrocksTierTimeoutSeconds},
				},
				"facts": {Enabled: true},
				"risk":  {Enabled: false},
			},
			Tools: devkitTools(),
		}, {
			// The EVM-pallet view of the SAME address-grain topology graph.
			// It is a distinct network NAME, not a distinct graph: callers
			// select it with an `Address.network` predicate. Facts is off
			// because the devkit warehouse carries only the SS58 database —
			// declaring it enabled would advertise data that is not there.
			Network:       "bittensor_evm",
			DisplayName:   "Bittensor EVM",
			Status:        "devkit",
			Default:       false,
			FixtureWindow: "2024-01-01..2026-07-02",
			Layers: map[string]Layer{
				"topology": {
					Enabled: true,
					Live:    &TierLayer{Enabled: true, TimeoutSeconds: liveTierTimeoutSeconds},
					Archive: &TierLayer{Enabled: true, TimeoutSeconds: starrocksTierTimeoutSeconds},
				},
				"facts": {Enabled: false},
				"risk":  {Enabled: false},
			},
			Tools: devkitTools(),
		}},
	}
}
