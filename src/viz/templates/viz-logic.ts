export function buildVizLogic(): string {
  return `(function() {
  // ============================================================
  // Chain Insights Money Flow Visualization
  // ============================================================

  const ENTITY_COLORS = {
    eoa: '#6366f1',
    contract: '#8b5cf6',
    exchange: '#06b6d4',
    mixer: '#f43f5e',
    unknown: '#6b7280',
  };

  const RISK_COLORS = {
    low: '#22c55e',
    medium: '#eab308',
    high: '#f97316',
    critical: '#ef4444',
    unknown: '#6b7280',
  };

  // ---- Utility functions ----

  function truncAddr(addr) {
    if (!addr || addr.length <= 12) return addr;
    return addr.slice(0, 6) + '...' + addr.slice(-4);
  }

  function nodeRadius(volume, medianVolume) {
    if (medianVolume === 0) return 20;
    const ratio = volume / medianVolume;
    if (ratio <= 0) return 16;
    const scaled = 20 + Math.log2(ratio) * 4;
    return Math.max(16, Math.min(36, scaled));
  }

  function edgeWidth(value, minVal, maxVal) {
    if (minVal === maxVal) return 2;
    return 1 + ((value - minVal) / (maxVal - minVal)) * 5;
  }

  function entityShape(type, radius) {
    switch (type) {
      case 'contract':
        return 'M0,-' + radius + ' ' + radius + ',0 0,' + radius + ' -' + radius + ',0Z';
      case 'exchange': {
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          pts.push(radius * Math.cos(angle) + ',' + radius * Math.sin(angle));
        }
        return 'M' + pts.join(' L') + 'Z';
      }
      case 'mixer': {
        const h = radius * 0.866;
        return 'M0,-' + radius + ' ' + h + ',' + (radius * 0.5) + ' -' + h + ',' + (radius * 0.5) + 'Z';
      }
      default:
        return null; // circle
    }
  }

  // ---- Setup ----

  const graphData = GRAPH_DATA;
  const nodes = graphData.nodes.map(d => Object.assign({}, d));
  const links = graphData.edges.map(d => Object.assign({}, d));
  const meta = graphData.metadata;

  // Title
  if (meta.caseId) {
    document.title = meta.caseId + ' - Money Flow';
  } else {
    document.title = 'Ad-hoc Visualization';
  }

  // Truncation banner
  const banner = document.getElementById('truncation-banner');
  if (meta.truncated && meta.totalNodes && meta.hiddenNodes) {
    banner.textContent = 'Showing top 100 of ' + meta.totalNodes + ' entities. ' + meta.hiddenNodes + ' entities hidden.';
  }

  // Empty state
  const svg = d3.select('#graph');
  const width = window.innerWidth;
  const height = window.innerHeight;

  if (nodes.length === 0) {
    svg.append('foreignObject')
      .attr('x', width / 2 - 200)
      .attr('y', height / 2 - 60)
      .attr('width', 400)
      .attr('height', 120)
      .append('xhtml:div')
      .style('text-align', 'center')
      .style('color', '#e2e8f0')
      .html('<h2 style="margin:0 0 8px;font-size:16px;font-weight:600">No Transaction Data</h2><p style="margin:0;font-size:13px;color:#94a3b8">This case has no evidence with transaction data. Add evidence using <code>chain-insights evidence add</code> or provide a JSON file with <code>chain-insights viz --data &lt;file.json&gt;</code>.</p>');
    return;
  }

  // ---- Compute medians and edge values ----

  const volumes = nodes.map(n => (n.totalIn || 0) + (n.totalOut || 0));
  const sortedVols = volumes.slice().sort((a, b) => a - b);
  const medianVolume = sortedVols[Math.floor(sortedVols.length / 2)] || 1;

  const edgeValues = links.map(e => e.value || 0);
  const minEdgeVal = edgeValues.length ? Math.min(...edgeValues) : 0;
  const maxEdgeVal = edgeValues.length ? Math.max(...edgeValues) : 1;

  // Assign radius to each node
  nodes.forEach(n => {
    n.radius = nodeRadius((n.totalIn || 0) + (n.totalOut || 0), medianVolume);
  });

  // ---- SVG setup ----

  svg.attr('width', width).attr('height', height);

  // Defs for arrow markers
  const defs = svg.append('defs');

  function makeMarker(id, color) {
    defs.append('marker')
      .attr('id', id)
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 8)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4Z')
      .attr('fill', color);
  }

  makeMarker('arrow-default', '#475569');
  makeMarker('arrow-hover', '#e2e8f0');

  const container = svg.append('g').attr('class', 'container');

  // ---- Zoom ----

  let currentTransform = d3.zoomIdentity;

  const zoom = d3.zoom()
    .scaleExtent([0.1, 8])
    .on('zoom', (event) => {
      currentTransform = event.transform;
      container.attr('transform', event.transform.toString());
    });

  svg.call(zoom);

  function fitToView() {
    // Get bounding box of all nodes
    if (nodes.length === 0) return;
    const xs = nodes.map(n => n.x || 0);
    const ys = nodes.map(n => n.y || 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 32;
    const bWidth = maxX - minX + pad * 2;
    const bHeight = maxY - minY + pad * 2;
    const scale = Math.min(width / bWidth, height / bHeight, 8);
    const tx = width / 2 - scale * (minX + maxX) / 2;
    const ty = height / 2 - scale * (minY + maxY) / 2;
    svg.transition().duration(250).call(
      zoom.transform,
      d3.zoomIdentity.translate(tx, ty).scale(scale)
    );
  }

  document.getElementById('zoom-reset').addEventListener('click', fitToView);

  // ---- Force simulation ----

  let currentLayout = 'force';
  let simulation;

  // Edge groups
  const linkGroup = container.append('g').attr('class', 'links');
  const nodeGroup = container.append('g').attr('class', 'nodes');

  // Create node id map
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // ---- Render links ----

  // Count edges between pairs to handle multi-edges
  const edgePairCount = new Map();
  const edgePairIndex = new Map();
  links.forEach(e => {
    const key = [e.source, e.target].sort().join('||');
    edgePairCount.set(key, (edgePairCount.get(key) || 0) + 1);
  });
  links.forEach(e => {
    const key = [e.source, e.target].sort().join('||');
    const idx = edgePairIndex.get(key) || 0;
    e._pairIndex = idx;
    e._pairCount = edgePairCount.get(key);
    edgePairIndex.set(key, idx + 1);
  });

  let linkEls = linkGroup.selectAll('line.link')
    .data(links)
    .join('line')
    .attr('class', 'link')
    .attr('stroke', '#475569')
    .attr('stroke-width', d => edgeWidth(d.value || 0, minEdgeVal, maxEdgeVal))
    .attr('marker-end', 'url(#arrow-default)')
    .style('cursor', 'pointer');

  // ---- Render nodes ----

  const nodeEls = nodeGroup.selectAll('g.node-group')
    .data(nodes, d => d.id)
    .join('g')
    .attr('class', 'node-group');

  nodeEls.each(function(d) {
    const g = d3.select(this);
    const r = d.radius || 20;
    const fill = ENTITY_COLORS[d.entityType] || '#6b7280';
    const stroke = RISK_COLORS[d.riskLevel] || '#6b7280';

    g.append('title').text(d.entityType + ': ' + (d.label || truncAddr(d.id)));

    const shapePath = entityShape(d.entityType, r);
    if (shapePath) {
      g.append('path')
        .attr('d', shapePath)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', 3);
    } else {
      g.append('circle')
        .attr('r', r)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', 3);
    }

    g.append('text')
      .attr('dy', r + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('fill', '#94a3b8')
      .text(truncAddr(d.label || d.id));
  });

  // ---- Tooltip ----

  const tooltip = document.getElementById('tooltip');
  let tooltipTimeout;

  function showTooltip(event, html) {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => {
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';
      positionTooltip(event);
    }, 200);
  }

  function hideTooltip() {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => {
      tooltip.style.display = 'none';
    }, 150);
  }

  function positionTooltip(event) {
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    let x = event.pageX + 12;
    let y = event.pageY + 12;
    if (x + tw > window.innerWidth - 16) x = event.pageX - tw - 12;
    if (y + th > window.innerHeight - 16) y = event.pageY - th - 12;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  function nodeTooltipHtml(d) {
    const riskColor = RISK_COLORS[d.riskLevel] || '#6b7280';
    return '<div class="tooltip-header">' + truncAddr(d.label || d.id) + '</div>' +
      '<div class="tooltip-divider"></div>' +
      '<div class="tooltip-row"><span class="tooltip-label">Type</span><span class="tooltip-value">' + (d.entityType || 'unknown') + '</span></div>' +
      '<div class="tooltip-row"><span class="tooltip-label">Risk</span><span class="tooltip-value"><span class="risk-badge" style="background:' + riskColor + '22;color:' + riskColor + '">' + (d.riskLevel || 'unknown') + '</span></span></div>' +
      '<div class="tooltip-row"><span class="tooltip-label">Total In</span><span class="tooltip-value">' + (d.totalIn || 0) + '</span></div>' +
      '<div class="tooltip-row"><span class="tooltip-label">Total Out</span><span class="tooltip-value">' + (d.totalOut || 0) + '</span></div>' +
      '<div class="tooltip-row"><span class="tooltip-label">Tx Count</span><span class="tooltip-value">' + (d.txCount || 0) + '</span></div>' +
      (d.firstSeen ? '<div class="tooltip-row"><span class="tooltip-label">First Seen</span><span class="tooltip-value">' + d.firstSeen.slice(0, 10) + '</span></div>' : '') +
      (d.lastSeen ? '<div class="tooltip-row"><span class="tooltip-label">Last Seen</span><span class="tooltip-value">' + d.lastSeen.slice(0, 10) + '</span></div>' : '');
  }

  function edgeTooltipHtml(d) {
    return '<div class="tooltip-header">Transaction</div>' +
      '<div class="tooltip-divider"></div>' +
      '<div class="tooltip-row"><span class="tooltip-label">From</span><span class="tooltip-value">' + truncAddr(d.source.id || d.source) + '</span></div>' +
      '<div class="tooltip-row"><span class="tooltip-label">To</span><span class="tooltip-value">' + truncAddr(d.target.id || d.target) + '</span></div>' +
      '<div class="tooltip-row"><span class="tooltip-label">Amount</span><span class="tooltip-value">' + (d.value || 0) + '</span></div>' +
      (d.txHash ? '<div class="tooltip-row"><span class="tooltip-label">Hash</span><span class="tooltip-value">' + truncAddr(d.txHash) + '</span></div>' : '') +
      (d.blockNumber ? '<div class="tooltip-row"><span class="tooltip-label">Block</span><span class="tooltip-value">' + d.blockNumber.toLocaleString() + '</span></div>' : '') +
      (d.timestamp ? '<div class="tooltip-row"><span class="tooltip-label">Time</span><span class="tooltip-value">' + d.timestamp.slice(0, 16).replace('T', ' ') + ' UTC</span></div>' : '');
  }

  nodeEls
    .on('mouseover', function(event, d) {
      showTooltip(event, nodeTooltipHtml(d));
    })
    .on('mousemove', function(event) {
      if (tooltip.style.display === 'block') positionTooltip(event);
    })
    .on('mouseout', hideTooltip);

  linkEls
    .on('mouseover', function(event, d) {
      d3.select(this).attr('stroke', '#e2e8f0').attr('marker-end', 'url(#arrow-hover)');
      showTooltip(event, edgeTooltipHtml(d));
    })
    .on('mousemove', function(event) {
      if (tooltip.style.display === 'block') positionTooltip(event);
    })
    .on('mouseout', function() {
      d3.select(this).attr('stroke', '#475569').attr('marker-end', 'url(#arrow-default)');
      hideTooltip();
    });

  // ---- Force simulation ----

  function startForceSimulation() {
    simulation = d3.forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(-300))
      .force('link', d3.forceLink(links).id(d => d.id).distance(120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => (d.radius || 20) + 8))
      .alphaDecay(0.02)
      .velocityDecay(0.4)
      .on('tick', () => {
        linkEls
          .attr('x1', d => d.source.x || 0)
          .attr('y1', d => d.source.y || 0)
          .attr('x2', d => d.target.x || 0)
          .attr('y2', d => d.target.y || 0);
        nodeEls.attr('transform', d => 'translate(' + (d.x || 0) + ',' + (d.y || 0) + ')');
      });

    // Drag behavior
    const drag = d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeEls.call(drag);
  }

  // ---- Tree layout ----

  function switchToTree() {
    if (simulation) {
      simulation.stop();
    }
    // Store current force positions
    nodes.forEach(n => {
      n.forceX = n.x;
      n.forceY = n.y;
    });

    // Build hierarchy — find source nodes (no incoming edges)
    const targetIds = new Set(links.map(e => e.target.id || e.target));
    const sourceNodes = nodes.filter(n => !targetIds.has(n.id));

    // Virtual root to connect all source nodes
    const virtualRoot = { id: '__root__', children: sourceNodes };
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Build adjacency for hierarchy
    const adj = new Map(nodes.map(n => [n.id, []]));
    links.forEach(e => {
      const srcId = e.source.id || e.source;
      const tgtId = e.target.id || e.target;
      if (adj.has(srcId)) adj.get(srcId).push(tgtId);
    });

    // DFS to build tree structure, detect cycles
    const visited = new Set();
    function buildChildren(nodeId) {
      if (visited.has(nodeId)) {
        console.warn('Cycle detected at node:', nodeId);
        return [];
      }
      visited.add(nodeId);
      const children = (adj.get(nodeId) || [])
        .map(childId => ({
          id: childId,
          data: nodeMap.get(childId),
          children: buildChildren(childId),
        }))
        .filter(c => c.data);
      return children;
    }

    const treeData = {
      id: '__root__',
      children: (sourceNodes.length > 0 ? sourceNodes : nodes.slice(0, 1)).map(n => ({
        id: n.id,
        data: n,
        children: buildChildren(n.id),
      })),
    };

    const hierarchy = d3.hierarchy(treeData);
    const treeLayout = d3.tree().size([width - 100, height - 100]).separation(() => 1.5);
    treeLayout(hierarchy);

    // Map tree positions to nodes
    const posById = new Map();
    hierarchy.descendants().forEach(d => {
      if (d.data.id !== '__root__') {
        posById.set(d.data.id, { x: d.x + 50, y: d.y + 50 });
      }
    });

    // Remove drag on nodes
    nodeEls.on('.drag', null);

    // Animate nodes to tree positions
    nodeEls.transition().duration(500)
      .attr('transform', d => {
        const pos = posById.get(d.id);
        if (pos) { d.x = pos.x; d.y = pos.y; }
        return 'translate(' + (d.x || 0) + ',' + (d.y || 0) + ')';
      });

    // Redraw links as paths
    linkEls.remove();
    linkEls = linkGroup.selectAll('path.link')
      .data(links)
      .join('path')
      .attr('class', 'link')
      .attr('fill', 'none')
      .attr('stroke', '#475569')
      .attr('stroke-width', d => edgeWidth(d.value || 0, minEdgeVal, maxEdgeVal))
      .attr('marker-end', 'url(#arrow-default)')
      .style('cursor', 'pointer')
      .attr('d', d => {
        const sx = d.source.x || 0;
        const sy = d.source.y || 0;
        const tx = d.target.x || 0;
        const ty = d.target.y || 0;
        return 'M' + sx + ',' + sy + ' C' + sx + ',' + (sy + ty) / 2 + ' ' + tx + ',' + (sy + ty) / 2 + ' ' + tx + ',' + ty;
      });

    linkEls
      .on('mouseover', function(event, d) {
        d3.select(this).attr('stroke', '#e2e8f0').attr('marker-end', 'url(#arrow-hover)');
        showTooltip(event, edgeTooltipHtml(d));
      })
      .on('mousemove', function(event) {
        if (tooltip.style.display === 'block') positionTooltip(event);
      })
      .on('mouseout', function() {
        d3.select(this).attr('stroke', '#475569').attr('marker-end', 'url(#arrow-default)');
        hideTooltip();
      });
  }

  function switchToForce() {
    // Remove tree paths, re-add lines
    linkEls.remove();
    linkEls = linkGroup.selectAll('line.link')
      .data(links)
      .join('line')
      .attr('class', 'link')
      .attr('stroke', '#475569')
      .attr('stroke-width', d => edgeWidth(d.value || 0, minEdgeVal, maxEdgeVal))
      .attr('marker-end', 'url(#arrow-default)')
      .style('cursor', 'pointer');

    linkEls
      .on('mouseover', function(event, d) {
        d3.select(this).attr('stroke', '#e2e8f0').attr('marker-end', 'url(#arrow-hover)');
        showTooltip(event, edgeTooltipHtml(d));
      })
      .on('mousemove', function(event) {
        if (tooltip.style.display === 'block') positionTooltip(event);
      })
      .on('mouseout', function() {
        d3.select(this).attr('stroke', '#475569').attr('marker-end', 'url(#arrow-default)');
        hideTooltip();
      });

    // Restore force positions
    nodes.forEach(n => {
      if (n.forceX !== undefined) { n.x = n.forceX; n.y = n.forceY; }
    });

    startForceSimulation();
  }

  // ---- Layout toggle ----

  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const layout = this.dataset.layout;
      if (layout === currentLayout) return;
      document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      currentLayout = layout;
      if (layout === 'tree') {
        switchToTree();
      } else {
        switchToForce();
      }
    });
  });

  // ---- Legend panel ----

  const legendPanel = document.getElementById('legend-panel');
  const legendToggle = document.getElementById('legend-toggle');

  legendToggle.addEventListener('click', () => {
    if (legendPanel.classList.contains('expanded')) {
      legendPanel.classList.remove('expanded');
      legendPanel.classList.add('collapsed');
    } else {
      legendPanel.classList.remove('collapsed');
      legendPanel.classList.add('expanded');
    }
  });

  // Populate legend content
  const legendContent = document.getElementById('legend-content');
  legendContent.innerHTML = '<p class="legend-title">Legend</p>' +
    '<div class="legend-section">' +
    '<p style="font-size:11px;font-weight:600;color:#94a3b8;margin:0 0 6px">ENTITIES</p>' +
    '<div class="legend-item"><svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" fill="#6366f1" stroke="#6b7280" stroke-width="2"/></svg> EOA (Wallet)</div>' +
    '<div class="legend-item"><svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"><polygon points="8,1 15,8 8,15 1,8" fill="#8b5cf6" stroke="#6b7280" stroke-width="2"/></svg> Contract</div>' +
    '<div class="legend-item"><svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"><polygon points="8,1 14,4 14,12 8,15 2,12 2,4" fill="#06b6d4" stroke="#6b7280" stroke-width="2"/></svg> Exchange</div>' +
    '<div class="legend-item"><svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"><polygon points="8,1 15,15 1,15" fill="#f43f5e" stroke="#6b7280" stroke-width="2"/></svg> Mixer</div>' +
    '</div>' +
    '<div class="legend-section">' +
    '<p style="font-size:11px;font-weight:600;color:#94a3b8;margin:0 0 6px">RISK LEVELS</p>' +
    '<div class="legend-item"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#22c55e;margin-right:4px"></span> Low</div>' +
    '<div class="legend-item"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#eab308;margin-right:4px"></span> Medium</div>' +
    '<div class="legend-item"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#f97316;margin-right:4px"></span> High</div>' +
    '<div class="legend-item"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#ef4444;margin-right:4px"></span> Critical</div>' +
    '</div>' +
    '<div class="legend-section">' +
    '<p style="font-size:11px;font-weight:600;color:#94a3b8;margin:0 0 6px">EDGE THICKNESS</p>' +
    '<div class="legend-item"><svg width="40" height="8" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="4" x2="40" y2="4" stroke="#475569" stroke-width="1"/></svg> Low value</div>' +
    '<div class="legend-item"><svg width="40" height="8" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="4" x2="40" y2="4" stroke="#475569" stroke-width="5"/></svg> High value</div>' +
    '</div>';

  // ---- Start force layout ----
  startForceSimulation();

  // Auto-fit after simulation settles
  setTimeout(fitToView, 1500);

})();`
}
