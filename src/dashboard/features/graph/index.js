import { config, NODE_SIZE_RANGE } from './config.js';
import { buildGraphData, positionCache } from './graphData.js';
import { hullGeometry } from './hulls.js';
import { tagGroupOf, groupColorOf } from '../tagGroups.js';
import { drag, bindHoverHandlers, setCurrentSelection, resetHover } from './interactions.js';
import { buildLegend } from './legend.js';
import { buildToolbar, updateToolbarStats } from './toolbar.js';

const CONTAINER_ID = 'force-graph-container';
const NEUTRAL_COLOR = '#7c8ba1';

let lastTweets = [];
let resizeQueued = false;

// Live render state. These persist across updateGraphData()/updateHulls()
// calls (config-driven updates) and are only torn down and recreated by
// renderForceGraph() itself (new tweet list, or a resize). Keeping them
// module-scoped — rather than local to renderForceGraph — is what lets a
// config change touch just the pieces that actually need to change
// instead of rebuilding the whole graph.
let simulation = null;
let nodes = [];
let links = [];
let nodeSel = null;
let linkSel = null;
let hullSel = null;
let hullGroup = null;
let zoomGroup = null;
let canvasWrap = null;
let width = 900;
let height = 600;
let nodeSize = null;
let nodeRadius = null;
let edgeWidth = null;

function getContainer() {
    return document.getElementById(CONTAINER_ID);
}

// Recomputes the size/width scales used both for drawing and (via the
// nodeRadius/nodeSize closures forces below already reference) for the
// simulation's own force accessors. Forces that cache their per-node
// values at initialize time (collide, x, y) pick these up automatically
// the next time simulation.nodes(...) runs, since those force accessors
// close over these same `let` bindings rather than snapshotting them.
function computeScales(nodesArr, linksArr) {
    const maxWeight = d3.max(linksArr, d => d.weight) || 1;
    edgeWidth = d3.scaleLinear().domain([1, maxWeight]).range([1, 3]).clamp(true);

    const maxTagsPerTweet = d3.max(nodesArr, d => d.tags.length) || 1;
    nodeSize = d3.scaleLinear().domain([1, maxTagsPerTweet]).range(NODE_SIZE_RANGE).clamp(true);
    nodeRadius = d => nodeSize(Math.max(1, d.tags.length)) / 2;
}

// Group tweets by tag, then only keep tags whose share of tagged
// tweets clears the configured threshold — that's what decides which
// tags actually get a drawn hull. Operates on whatever node set is
// passed in, so it works the same whether called after a full rebuild
// or from updateHulls() against the live (unchanged) node set.
function computeHullEntries(nodesArr, taggedCount) {
    const tagToNodes = new Map();
    nodesArr.forEach(n => {
        n.tags.forEach(tag => {
            if (!tagToNodes.has(tag)) tagToNodes.set(tag, []);
            tagToNodes.get(tag).push(n);
        });
    });
    return Array.from(tagToNodes.entries())
        .map(([tag, tagNodes]) => ({ tag, group: tagGroupOf(tag), nodes: tagNodes }))
        .filter(entry => (entry.nodes.length / (taggedCount || 1)) >= config.groupHullThreshold);
}

function joinHulls(entries) {
    hullSel = hullGroup.selectAll('g')
        .data(entries, d => d.tag)
        .join(enter => {
            const g = enter.append('g').attr('class', 'force-graph-hull');
            g.append('path').attr('class', 'force-graph-hull-shape');
            g.append('text').attr('class', 'force-graph-hull-label');
            return g;
        });
    hullSel.select('.force-graph-hull-shape').style('fill', d => groupColorOf(d.group) || NEUTRAL_COLOR);
    hullSel.select('.force-graph-hull-label')
        .style('fill', d => groupColorOf(d.group) || NEUTRAL_COLOR)
        .text(d => `#${d.tag}`);
    return hullSel;
}

function applyHullOpacity() {
    if (!hullGroup) return;
    hullGroup.selectAll('.force-graph-hull-shape').style('fill-opacity', config.hullOpacity);
}

// Positions hull paths/labels immediately from current node.x/y. Needed
// whenever we redraw hulls outside of a tick (e.g. a pure hull-threshold
// change, where the simulation isn't running and no tick will fire).
function drawHullGeometry(sel) {
    sel.each(function (d) {
        const geo = hullGeometry(d.nodes);
        if (!geo) return;
        const g = d3.select(this);
        g.select('.force-graph-hull-shape').attr('d', geo.d);
        g.select('.force-graph-hull-label').attr('x', geo.label.x).attr('y', geo.label.y);
    });
}

// Ensures each node's shape element matches d.shape (square/circle) and
// is sized/colored correctly, adding or removing the child element only
// when the shape actually needs to change. Safe to call on a selection
// mixing untouched, updated, and brand-new nodes.
function applyNodeShapes(sel) {
    sel.each(function (d) {
        const g = d3.select(this);
        const wantTag = d.shape === 'square' ? 'rect' : 'circle';
        let el = g.select('.force-graph-planet');
        const currentTag = el.empty() ? null : el.node().tagName.toLowerCase();
        if (currentTag !== wantTag) {
            el.remove();
            el = g.append(wantTag).attr('class', 'force-graph-planet');
        }
        const size = nodeSize(Math.max(1, d.tags.length));
        if (wantTag === 'rect') {
            el.attr('x', -size / 2).attr('y', -size / 2).attr('width', size).attr('height', size);
        } else {
            el.attr('r', size / 2);
        }
        el.style('fill', (d.group && groupColorOf(d.group)) || NEUTRAL_COLOR);
    });
}

// Full (re)build: tears down and recreates the DOM and simulation from
// scratch. Use this when the underlying tweet list changes or the panel
// resizes — never call it for a config-slider change, since it restarts
// the layout instead of nudging it.
export function renderForceGraph(tweets) {
    lastTweets = tweets;
    resetHover();

    const root = getContainer();
    if (!root) return;

    const built = buildGraphData(tweets);
    nodes = built.nodes;
    links = built.links;
    const shownCount = built.shownCount;

    root.replaceChildren();
    simulation?.stop();

    if (nodes.length === 0) {
        simulation = null;
        const empty = document.createElement('div');
        empty.className = 'force-graph-empty';
        empty.textContent = 'No tweets match the current filters.';
        root.appendChild(empty);
        return;
    }

    const untaggedCount = nodes.filter(n => n.tags.length === 0).length;
    const taggedCount = nodes.length - untaggedCount;

    const toolbarEl = buildToolbar(tweets, shownCount, untaggedCount, links.length, {
        onDataChange: updateGraphData,
        onVisualChange: updateHulls,
    });
    root.appendChild(toolbarEl);

    canvasWrap = document.createElement('div');
    canvasWrap.className = 'force-graph-canvas-wrap';
    root.appendChild(canvasWrap);

    width = canvasWrap.clientWidth || root.clientWidth || 900;
    height = Math.max(400, (root.clientHeight || 700) - 56);

    const svg = d3.select(canvasWrap)
        .append('svg')
        .attr('class', 'force-graph-svg')
        .attr('viewBox', [0, 0, width, height]);

    zoomGroup = svg.append('g').attr('class', 'zoom-group');

    svg.call(d3.zoom()
        .scaleExtent([0.15, 4])
        .on('zoom', (event) => zoomGroup.attr('transform', event.transform)));

    computeScales(nodes, links);

    simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(20).strength(0.35))
        .force('charge', d3.forceManyBody().strength(-40))
        .force('x', d3.forceX().strength(v => v.tags?.length ? 0.1 : 0.07))
        .force('y', d3.forceY().strength(v => v.tags?.length ? 0.1 : 0.07))
        .force('collide', d3.forceCollide().radius(d => nodeRadius(d) + 2).strength(0.9));

    hullGroup = zoomGroup.append('g').attr('class', 'force-graph-hulls');
    joinHulls(computeHullEntries(nodes, taggedCount));
    applyHullOpacity();

    linkSel = zoomGroup.append('g')
        .attr('class', 'force-graph-links force-graph-links-tweet')
        .selectAll('line')
        .data(links, d => d.id)
        .join('line')
        .attr('stroke-width', d => edgeWidth(d.weight));

    nodeSel = zoomGroup.append('g')
        .attr('class', 'force-graph-nodes')
        .selectAll('g')
        .data(nodes, d => d.id)
        .join(enter => enter.append('g').call(drag(simulation)));
    nodeSel.attr('class', d => `force-graph-node force-graph-node-tweet${d.tags.length === 0 ? ' force-graph-node-untagged' : ''}`);
    applyNodeShapes(nodeSel);

    setCurrentSelection(nodeSel, linkSel, links);
    bindHoverHandlers(nodeSel);

    simulation.on('tick', () => {
        drawHullGeometry(hullSel);
        linkSel
            .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Cache positions once it settles so the next full render starts
    // from where things already were instead of re-simulating from
    // scratch.
    simulation.on('end', () => {
        nodes.forEach(n => positionCache.set(n.id, { x: n.x, y: n.y }));
    });

    root.appendChild(buildLegend());
}

// Config-driven data update, for the Max tweets / Links per tweet
// sliders — the only two knobs that actually change which tweets or
// links exist. Rebuilds graph data, then merges it onto the *existing*
// node/link objects (by id) so any node present both before and after
// keeps its live x/y/vx/vy/fx/fy — it never jumps or restarts. Only
// nodes/links that are genuinely new or genuinely gone get added or
// removed. The simulation itself is reused; it's just nudged with a
// small alpha bump rather than torn down and rebuilt.
export function updateGraphData() {
    const root = getContainer();
    if (!root || !simulation || !canvasWrap) {
        renderForceGraph(lastTweets);
        return;
    }

    const built = buildGraphData(lastTweets);
    const freshNodes = built.nodes;
    const freshLinks = built.links;

    if (freshNodes.length === 0) {
        renderForceGraph(lastTweets);
        return;
    }

    resetHover();

    // Anything about to drop out gets its last known position cached,
    // same as the simulation's own "end" handler does, so re-adding it
    // later (e.g. the user raises Max tweets back up) restores it near
    // where it was instead of dropping it in fresh.
    const oldById = new Map(nodes.map(n => [n.id, n]));
    const freshIds = new Set(freshNodes.map(n => n.id));
    nodes.forEach(n => {
        if (!freshIds.has(n.id)) positionCache.set(n.id, { x: n.x, y: n.y });
    });

    // Reuse existing node objects (and therefore their live sim state)
    // wherever the id already existed; only genuinely new tweets get a
    // fresh object.
    nodes = freshNodes.map(fn => {
        const old = oldById.get(fn.id);
        if (!old) return fn;
        old.tweet = fn.tweet;
        old.tags = fn.tags;
        old.dominantTag = fn.dominantTag;
        old.group = fn.group;
        old.shape = fn.shape;
        return old;
    });

    const oldLinksByKey = new Map(links.map(l => [l.id, l]));
    links = freshLinks.map(fl => {
        const old = oldLinksByKey.get(fl.id);
        if (!old) return fl;
        old.weight = fl.weight;
        old.tags = fl.tags;
        return old;
    });

    computeScales(nodes, links);

    // Order matters: nodes first, so forceLink's internal id map is
    // rebuilt from the current node set before it resolves any brand-new
    // link's string source/target. Links that already point at live node
    // objects are left alone (d3-force only resolves string ids).
    simulation.nodes(nodes);
    simulation.force('link').links(links);

    linkSel = zoomGroup.select('.force-graph-links-tweet')
        .selectAll('line')
        .data(links, d => d.id)
        .join('line')
        .attr('stroke-width', d => edgeWidth(d.weight));

    nodeSel = zoomGroup.select('.force-graph-nodes')
        .selectAll('g')
        .data(nodes, d => d.id)
        .join(enter => enter.append('g').call(drag(simulation)));
    nodeSel.attr('class', d => `force-graph-node force-graph-node-tweet${d.tags.length === 0 ? ' force-graph-node-untagged' : ''}`);
    applyNodeShapes(nodeSel);

    updateHulls();

    setCurrentSelection(nodeSel, linkSel, links);
    bindHoverHandlers(nodeSel);

    const untaggedCount = nodes.filter(n => n.tags.length === 0).length;
    updateToolbarStats(root, lastTweets, nodes.length, untaggedCount, links.length);

    // A gentle nudge, not a restart from alpha=1 — existing nodes keep
    // their position and drift only as much as the new/changed links
    // pull them.
    simulation.alpha(Math.max(simulation.alpha(), 0.3)).restart();
}

// Config-driven visual-only update, for the Group threshold / Hull
// opacity sliders. Deliberately never calls buildGraphData (which is
// non-deterministic — see graphData.js) and never touches nodes, links,
// or the simulation. Just re-filters which tags clear the hull
// threshold and redraws hull geometry/opacity against the current,
// unchanged node positions.
export function updateHulls() {
    if (!hullGroup || nodes.length === 0) return;
    const untaggedCount = nodes.filter(n => n.tags.length === 0).length;
    const taggedCount = nodes.length - untaggedCount;
    joinHulls(computeHullEntries(nodes, taggedCount));
    drawHullGeometry(hullSel);
    applyHullOpacity();
}

// Re-render on resize (debounced) so the SVG viewBox tracks the panel
// size. This stays a full rebuild — the canvas dimensions themselves
// changed, not just a config value.
window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    setTimeout(() => {
        resizeQueued = false;
        if (lastTweets.length) renderForceGraph(lastTweets);
    }, 250);
});