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

type Layer struct {
	Enabled bool `json:"enabled"`
}

type NetworkCapabilitiesDocument struct {
	Schema   string              `json:"schema"`
	Networks []NetworkCapability `json:"networks"`
}

func NetworkDocument() NetworkCapabilitiesDocument {
	return NetworkCapabilitiesDocument{
		Schema: "chain-insights.network-capabilities.v1",
		Networks: []NetworkCapability{{
			Network:       "bittensor",
			DisplayName:   "Bittensor",
			Status:        "devkit",
			Default:       true,
			FixtureWindow: "genesis..2025-12-31",
			Layers: map[string]Layer{
				"topology": {Enabled: true},
				"facts":    {Enabled: true},
				"risk":     {Enabled: false},
			},
			Tools: map[string]string{
				"network_capabilities": "available",
				"graph_query":          "available",
				"graph_query_batch":    "available",
			},
		}},
	}
}
