export function buildCssVariables(): string {
  return `:root {
  --surface-primary: #0f1117;
  --surface-secondary: #1a1d27;
  --surface-border: #334155;
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --entity-eoa: #6366f1;
  --entity-contract: #8b5cf6;
  --entity-exchange: #06b6d4;
  --entity-mixer: #f43f5e;
  --risk-low: #22c55e;
  --risk-medium: #eab308;
  --risk-high: #f97316;
  --risk-critical: #ef4444;
  --risk-unknown: #6b7280;
  --edge-default: #475569;
  --edge-hover: #e2e8f0;
  --font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-size-label: 11px;
  --font-size-body: 13px;
  --font-size-heading: 16px;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
}`
}

export function buildLayoutCss(): string {
  return `
body {
  margin: 0;
  background: var(--surface-primary);
  font-family: var(--font-family);
  color: var(--text-primary);
  overflow: hidden;
}
#viz-root {
  position: relative;
  width: 100vw;
  height: 100vh;
}
#graph {
  width: 100%;
  height: 100%;
  display: block;
}
#control-bar {
  position: absolute;
  top: 16px;
  left: 16px;
  background: var(--surface-secondary);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  gap: 8px;
  z-index: 10;
}
.layout-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-body);
  font-weight: 600;
  transition: background 0.15s;
}
.layout-btn.active {
  background: var(--accent);
  color: white;
}
.layout-btn:not(.active) {
  background: var(--surface-secondary);
  color: var(--text-secondary);
}
.layout-btn:not(.active):hover {
  background: var(--surface-border);
}
#zoom-reset {
  width: 32px;
  height: 32px;
  background: var(--surface-secondary);
  border: 1px solid var(--surface-border);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
#zoom-reset:hover {
  background: var(--surface-border);
}
#zoom-reset svg {
  width: 16px;
  height: 16px;
  fill: var(--text-secondary);
}
#legend-panel {
  position: absolute;
  bottom: 16px;
  right: 16px;
  background: var(--surface-secondary);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  z-index: 10;
  max-width: 240px;
  transition: all 0.2s;
}
#legend-panel.collapsed {
  padding: 0;
}
#legend-panel.expanded {
  padding: 24px;
}
#legend-toggle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--surface-secondary);
  border: 1px solid var(--surface-border);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
#legend-content {
  display: none;
}
#legend-panel.expanded #legend-content {
  display: block;
}
.legend-title {
  font-size: var(--font-size-heading);
  font-weight: 600;
  margin: 0 0 12px;
}
.legend-section {
  margin-bottom: 12px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-body);
  margin-bottom: 4px;
}
#tooltip {
  position: absolute;
  display: none;
  background: var(--surface-secondary);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  padding: 16px;
  max-width: 320px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  z-index: 20;
  pointer-events: none;
}
.tooltip-header {
  font-size: var(--font-size-heading);
  font-weight: 600;
  margin-bottom: 8px;
}
.tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: var(--font-size-body);
  margin-bottom: 4px;
}
.tooltip-label {
  color: var(--text-secondary);
}
.tooltip-value {
  color: var(--text-primary);
  font-weight: 500;
}
.tooltip-divider {
  border-top: 1px solid var(--surface-border);
  margin: 8px 0;
}
.risk-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: var(--font-size-label);
  font-weight: 600;
}
#truncation-banner {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 36px;
  background: #1e293b;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  z-index: 10;
}
#truncation-banner:empty {
  display: none;
}
*:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0.01ms;
  }
}
.node-group {
  cursor: grab;
}
.node-group:active {
  cursor: grabbing;
}`
}

export const ENTITY_COLORS: Record<string, string> = {
  eoa: '#6366f1',
  contract: '#8b5cf6',
  exchange: '#06b6d4',
  mixer: '#f43f5e',
  unknown: '#6b7280',
}

export const RISK_COLORS: Record<string, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
  unknown: '#6b7280',
}
