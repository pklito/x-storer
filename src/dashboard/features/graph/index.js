import { config, NODE_SIZE_RANGE } from './config.js';
import { buildGraphData, positionCache } from './graphData.js';
import { hullGeometry } from './hulls.js';
import { tagGroupOf, groupColorOf } from '../tagGroups.js';
import { drag, bindHoverHandlers, setCurrentSelection, resetHover } from './interactions.js';
import { buildLegend } from './legend.js';
import { buildToolbar } from './toolbar.js';

const CONTAINER_ID = 'force-graph-container';
const NEUTRAL_COLOR = '#7c8ba1';

let lastTweets = [];
let resizeQueued = false;

function getContainer() {
    return document.getElementById(CONTAINER_ID);
}

export function renderForceGraph(tweets) {
    lastTweets = tweets;
    resetHover();

    const root = getContainer();
    if (!root) return;

    const { nodes, links, shownCount } = buildGraphData(tweets);
    root.replaceChildren();

    if (nodes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'force-graph-empty';
        empty.textContent = 'No tweets match the current filters.';
        root.appendChild(empty);
        return;
    }

    const untaggedCount = nodes.filter(n => n.tags.length === 0).length;
    const taggedCount = nodes.length - untaggedCount;

    const toolbarEl = buildToolbar(tweets, shownCount, untaggedCount, links.length, () => renderForceGraph(lastTweets));
    root.appendChild(toolbarEl);

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

    const maxWeight = d3.max(links, d => d.weight) || 1;
    const edgeWidth = d3.scaleLinear().domain([1, maxWeight]).range([1, 3]).clamp(true);

    const maxTagsPerTweet = d3.max(nodes, d => d.tags.length) || 1;
    const nodeSize = d3.scaleLinear().domain([1, maxTagsPerTweet]).range(NODE_SIZE_RANGE).clamp(true);
    const nodeRadius = d => nodeSize(Math.max(1, d.tags.length)) / 2;

    // Group tweets by tag, then only keep tags whose share of tagged
    // tweets clears the configured threshold — that's what decides
    // which tags actually get a drawn hull.
    const tagToNodes = new Map();
    nodes.forEach(n => {
        n.tags.forEach(tag => {
            if (!tagToNodes.has(tag)) tagToNodes.set(tag, []);
            tagToNodes.get(tag).push(n);
        });
    });
    const hullEntries = Array.from(tagToNodes.entries())
        .map(([tag, tagNodes]) => ({ tag, group: tagGroupOf(tag), nodes: tagNodes }))
        .filter(entry => (entry.nodes.length / (taggedCount || 1)) >= config.groupHullThreshold);

    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(45).strength(0.35))
        .force('charge', d3.forceManyBody().strength(-40))
        .force('x', d3.forceX())
        .force('y', d3.forceY())
        .force('collide', d3.forceCollide().radius(d => nodeRadius(d) + 2).strength(0.9));

    const hullGroup = zoomGroup.append('g').attr('class', 'force-graph-hulls');
    const hullSel = hullGroup.selectAll('g')
        .data(hullEntries, d => d.tag)
        .join(enter => {
            const g = enter.append('g').attr('class', 'force-graph-hull');
            g.append('path')
                .attr('class', 'force-graph-hull-shape')
                .style('fill', d => groupColorOf(d.group) || NEUTRAL_COLOR)
                .style('fill-opacity', config.hullOpacity);
            g.append('text')
                .attr('class', 'force-graph-hull-label')
                .style('fill', d => groupColorOf(d.group) || NEUTRAL_COLOR)
                .text(d => `#${d.tag}`);
            return g;
        });

    const linkSel = zoomGroup.append('g')
        .attr('class', 'force-graph-links force-graph-links-tweet')
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke-width', d => edgeWidth(d.weight));

    const nodeSel = zoomGroup.append('g')
        .attr('class', 'force-graph-nodes')
        .selectAll('g')
        .data(nodes, d => d.id)
        .join('g')
        .attr('class', d => `force-graph-node force-graph-node-tweet${d.tags.length === 0 ? ' force-graph-node-untagged' : ''}`)
        .call(drag(simulation));

    nodeSel.filter(d => d.shape === 'square')
        .append('rect')
        .attr('class', 'force-graph-planet')
        .attr('x', d => -nodeSize(Math.max(1, d.tags.length)) / 2)
        .attr('y', d => -nodeSize(Math.max(1, d.tags.length)) / 2)
        .attr('width', d => nodeSize(Math.max(1, d.tags.length)))
        .attr('height', d => nodeSize(Math.max(1, d.tags.length)))
        .style('fill', d => groupColorOf(d.group) || NEUTRAL_COLOR);

    nodeSel.filter(d => d.shape === 'circle')
        .append('circle')
        .attr('class', 'force-graph-planet')
        .attr('r', d => nodeRadius(d))
        .style('fill', d => groupColorOf(d.group) || NEUTRAL_COLOR);

    setCurrentSelection(nodeSel, linkSel, links);
    bindHoverHandlers(nodeSel);

    simulation.on('tick', () => {
        hullSel.each(function (d) {
            const geo = hullGeometry(d.nodes);
            if (!geo) return;
            const g = d3.select(this);
            g.select('.force-graph-hull-shape').attr('d', geo.d);
            g.select('.force-graph-hull-label').attr('x', geo.label.x).attr('y', geo.label.y);
        });
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

// Re-render on resize (debounced) so the SVG viewBox tracks the panel size.
window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    setTimeout(() => {
        resizeQueued = false;
        if (lastTweets.length) renderForceGraph(lastTweets);
    }, 250);
});
