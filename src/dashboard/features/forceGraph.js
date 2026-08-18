// Force-directed graph of tag overlap/quantity.
//
// Nodes = tags. Node radius = how many of the currently-filtered tweets
// have that tag. Edges = co-occurrence between two tags (tweets that
// have BOTH), edge thickness = how many. Node color = the tag's group
// color (same colors as the sidebar), so the group system doubles as
// the graph's "community" coloring for free.
//
// With ~100 tags and up to 15 tags/tweet, drawing every co-occurrence
// edge would be an unreadable hairball, so edges are pruned to (a) a
// minimum co-occurrence count and (b) each node's top-K strongest
// edges. Both are adjustable live via the toolbar sliders.
//
// Click a node = toggle tag selection (same as clicking a sidebar
// chip). Shift-click = toggle exclusion. Both funnel through updateUI()
// so the grid/sidebar/graph all stay in sync with the rest of the app.

import { state } from '../state.js';
import { tagGroupOf, groupColorOf } from './tagGroups.js';
import { updateUI } from './tweets.js';

const CONTAINER_ID = 'force-graph-container';

// Tunables, adjustable live via the toolbar sliders.
let minEdgeCount = 3;     // hide co-occurrence edges weaker than this
let maxEdgesPerNode = 6;  // on top of the threshold, keep only each node's N strongest edges

// Node positions persist across re-renders (keyed by tag) so filtering
// doesn't restart the whole layout from scratch every time.
const positionCache = new Map();

let lastTweets = [];
let tooltipEl = null;
let resizeQueued = false;

function getContainer() {
    return document.getElementById(CONTAINER_ID);
}

// --- Data -------------------------------------------------------------

// Builds { nodes, links } from a tweet list. Only real (user-assigned)
// tags are considered — built-in computed tags (video/gif/text-only/cw)
// aren't part of the overlap graph, they're a different kind of thing.
function buildGraphData(tweets) {
    const counts = new Map();
    const coCounts = new Map(); // "tagA|tagB" (A<B) -> count
    
    tweets.forEach(t => {
        const tags = (t.tags || []).filter(tag => state.showHiddenTags || !state.hiddenTags.has(tag));
        tags.forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1));
        for (let i = 0; i < tags.length; i++) {
            for (let j = i + 1; j < tags.length; j++) {
                const key = tags[i] < tags[j] ? `${tags[i]}|${tags[j]}` : `${tags[j]}|${tags[i]}`;
                coCounts.set(key, (coCounts.get(key) || 0) + 1);
            }
        }
    });

    const nodes = Array.from(counts.entries()).map(([tag, count]) => {
        const cached = positionCache.get(tag);
        return { id: tag, count, group: tagGroupOf(tag), x: cached?.x, y: cached?.y };
    });

    const allLinks = Array.from(coCounts.entries())
        .map(([key, count]) => {
            const [source, target] = key.split('|');
            return { source, target, count };
        })
        .filter(l => l.count >= minEdgeCount);

    // Keep each node's strongest edges even if a globally-sorted top-N
    // would've dropped them — otherwise sparsely-connected tags end up
    // with zero edges just because other tags have louder neighbors.
    const byNode = new Map();
    allLinks.forEach(l => {
        [l.source, l.target].forEach(id => {
            if (!byNode.has(id)) byNode.set(id, []);
            byNode.get(id).push(l);
        });
    });
    const keptKeys = new Set();
    byNode.forEach(nodeLinks => {
        nodeLinks
            .sort((a, b) => b.count - a.count)
            .slice(0, maxEdgesPerNode)
            .forEach(l => keptKeys.add(`${l.source}|${l.target}`));
    });

    const links = allLinks.filter(l => keptKeys.has(`${l.source}|${l.target}`));

    return { nodes, links };
}

// --- Render -------------------------------------------------------------

export function renderForceGraph(tweets) {
    lastTweets = tweets;
    const root = getContainer();
    if (!root) return;

    const { nodes, links } = buildGraphData(tweets);
    root.replaceChildren();

    if (nodes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'force-graph-empty';
        empty.textContent = 'No tagged tweets match the current filters.';
        root.appendChild(empty);
        return;
    }

    root.appendChild(buildToolbar(tweets, links.length, nodes.length));

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'force-graph-canvas-wrap';
    root.appendChild(canvasWrap);

    const width = canvasWrap.clientWidth || root.clientWidth || 900;
    const height = Math.max(400, (root.clientHeight || 700) - 56);

    const svg = d3.select(canvasWrap)
        .append('svg')
        .attr('class', 'force-graph-svg')
        .attr('viewBox', [0, 0, width, height]);

    const zoomGroup = svg.append('g').attr('class', 'zoom-group');

    svg.call(d3.zoom()
        .scaleExtent([0.15, 4])
        .on('zoom', (event) => zoomGroup.attr('transform', event.transform)));

    const maxCount = d3.max(nodes, d => d.count) || 1;
    const radius = d3.scaleSqrt().domain([1, maxCount]).range([6, 42]);

    const maxEdge = d3.max(links, d => d.count) || minEdgeCount;
    const edgeWidth = d3.scaleLinear().domain([minEdgeCount, maxEdge]).range([1, 7]).clamp(true);

    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id)
            .distance(l => 220 - Math.min(180, l.count * 10))
            .strength(0.25))
        .force('charge', d3.forceManyBody().strength(-190))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collide', d3.forceCollide().radius(d => radius(d.count) + 4));

    const linkSel = zoomGroup.append('g')
        .attr('class', 'force-graph-links')
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke-width', d => edgeWidth(d.count));

    const nodeSel = zoomGroup.append('g')
        .attr('class', 'force-graph-nodes')
        .selectAll('g')
        .data(nodes, d => d.id)
        .join('g')
        .attr('class', d => `force-graph-node ${nodeStateClass(d.id)}`)
        .call(drag(simulation));

    nodeSel.append('circle')
        .attr('r', d => radius(d.count))
        .attr('fill', d => groupColorOf(d.group) || '#7c8ba1');

    nodeSel.append('text')
        .attr('class', 'force-graph-label')
        .attr('dy', d => radius(d.count) + 14)
        .attr('text-anchor', 'middle')
        .text(d => `#${d.id}`);

    const tooltip = getTooltip();

    nodeSel
        .on('mouseenter', (event, d) => {
            highlightNode(d, nodeSel, linkSel);
            showTooltip(tooltip, event, d, links);
        })
        .on('mousemove', (event) => positionTooltip(tooltip, event))
        .on('mouseleave', () => {
            clearHighlight(nodeSel, linkSel);
            tooltip.style.display = 'none';
        })
        .on('click', (event, d) => {
            if (d._dragged) { d._dragged = false; return; } // suppress click right after a drag
            if (event.shiftKey) {
                if (state.excludedTags.has(d.id)) state.excludedTags.delete(d.id);
                else { state.excludedTags.add(d.id); state.selectedTags.delete(d.id); }
            } else {
                if (state.selectedTags.has(d.id)) state.selectedTags.delete(d.id);
                else if (state.excludedTags.has(d.id)) state.excludedTags.delete(d.id);
                else { state.selectedTags.add(d.id); state.excludedTags.delete(d.id); }
            }
            updateUI();
        });

    simulation.on('tick', () => {
        linkSel
            .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Cache positions once it settles so the next render (e.g. after a
    // filter change) starts from where things already were instead of
    // re-simulating from scratch.
    simulation.on('end', () => {
        nodes.forEach(n => positionCache.set(n.id, { x: n.x, y: n.y }));
    });

    root.appendChild(buildLegend());
}

function nodeStateClass(tag) {
    if (state.selectedTags.has(tag)) return 'is-selected';
    if (state.excludedTags.has(tag)) return 'is-excluded';
    return '';
}

function drag(sim) {
    return d3.drag()
        .on('start', (event, d) => {
            if (!event.active) sim.alphaTarget(0.15).restart();
            d.fx = d.x; d.fy = d.y;
            d._dragStart = { x: event.x, y: event.y };
            d._dragged = false;
        })
        .on('drag', (event, d) => {
            d.fx = event.x; d.fy = event.y;
            if (Math.hypot(event.x - d._dragStart.x, event.y - d._dragStart.y) > 4) d._dragged = true;
        })
        .on('end', (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            d.fx = null; d.fy = null;
        });
}

function highlightNode(d, nodeSel, linkSel) {
    const neighbors = new Set([d.id]);
    linkSel.each(function (l) {
        if (l.source.id === d.id) neighbors.add(l.target.id);
        if (l.target.id === d.id) neighbors.add(l.source.id);
    });
    nodeSel.classed('is-dimmed', n => !neighbors.has(n.id));
    linkSel
        .classed('is-dimmed', l => l.source.id !== d.id && l.target.id !== d.id)
        .classed('is-highlighted', l => l.source.id === d.id || l.target.id === d.id);
}

function clearHighlight(nodeSel, linkSel) {
    nodeSel.classed('is-dimmed', false);
    linkSel.classed('is-dimmed', false).classed('is-highlighted', false);
}

// --- Tooltip -------------------------------------------------------------

function getTooltip() {
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'force-graph-tooltip';
        document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
}

function positionTooltip(el, event) {
    el.style.left = `${event.clientX + 14}px`;
    el.style.top = `${event.clientY + 14}px`;
}

function showTooltip(el, event, d, links) {
    const related = links
        .filter(l => l.source.id === d.id || l.target.id === d.id)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(l => {
            const other = l.source.id === d.id ? l.target.id : l.source.id;
            return `<div class="force-graph-tooltip-row"><span>#${escapeHtml(other)}</span><span>${l.count}</span></div>`;
        })
        .join('');

    el.innerHTML = `
        <div class="force-graph-tooltip-title">#${escapeHtml(d.id)}</div>
        <div class="force-graph-tooltip-count">${d.count} tweet${d.count === 1 ? '' : 's'} &middot; ${escapeHtml(d.group)}</div>
        ${related ? `<div class="force-graph-tooltip-related">${related}</div>` : ''}
    `;
    el.style.display = 'block';
    positionTooltip(el, event);
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Legend & toolbar -----------------------------------------------------

function buildLegend() {
    const legend = document.createElement('div');
    legend.className = 'force-graph-legend';
    state.tagGroups.forEach(g => {
        const color = groupColorOf(g);
        const item = document.createElement('div');
        item.className = 'force-graph-legend-item';
        const swatch = document.createElement('span');
        swatch.className = 'force-graph-legend-swatch';
        swatch.style.background = color || '#7c8ba1';
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(g));
        legend.appendChild(item);
    });
    return legend;
}

function buildToolbar(tweets, linkCount, nodeCount) {
    const bar = document.createElement('div');
    bar.className = 'force-graph-toolbar';

    const stats = document.createElement('div');
    stats.className = 'force-graph-stats';
    stats.textContent = `${nodeCount} tags · ${linkCount} links shown · ${tweets.length} tweets`;
    bar.appendChild(stats);

    bar.appendChild(buildSlider('Min overlap', minEdgeCount, 1, 20, (v) => {
        minEdgeCount = v;
        renderForceGraph(lastTweets);
    }));
    bar.appendChild(buildSlider('Links/tag', maxEdgesPerNode, 1, 15, (v) => {
        maxEdgesPerNode = v;
        renderForceGraph(lastTweets);
    }));

    return bar;
}

function buildSlider(label, value, min, max, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'force-graph-slider';
    const span = document.createElement('span');
    span.textContent = `${label}: ${value}`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.addEventListener('input', () => { span.textContent = `${label}: ${input.value}`; });
    input.addEventListener('change', () => onChange(Number(input.value)));
    wrap.appendChild(span);
    wrap.appendChild(input);
    return wrap;
}

// Re-render on resize (debounced) so the SVG viewBox tracks the panel size.
window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    setTimeout(() => {
        resizeQueued = false;
        if (lastTweets.length) renderForceGraph(lastTweets);
    }, 250);
});
