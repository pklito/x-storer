import { config, NODE_SIZE_RANGE } from './config.js';
import { buildGraphData } from './graphData.js';
import { computeHullEntries, joinHulls, applyHullOpacity, drawHulls, updateHulls, setHullGroup } from './hulls.js';
import { tagGroupOf, groupColorOf } from '../tagGroups.js';
import { drag, bindHoverHandlers, setCurrentSelection, resetHover, enableGraphListeners, disableGraphListeners } from './interactions.js';
import { buildLegend } from './legend.js';
import { buildToolbar, updateToolbarStats } from './toolbar.js';
import { tweetsGraph } from '../../dom.js';

const NEUTRAL_COLOR = '#7c8ba1';

let lastTweets = [];

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
let zoomGroup = null;
let canvasWrap = null;
let width = 900;
let height = 600;
let nodeSize = null;
let nodeRadius = null;
let edgeWidth = null;


export function stopGraph(){
    disableGraphListeners();
    eraseForceGraph();
    tweetsGraph.classList.add('hidden');
}

export function startGraph(tweets = null){
    enableGraphListeners();
    tweetsGraph.classList.remove('hidden');
    if (tweets)
        renderForceGraph(tweets);
}

const positionCache = new Map()
function eraseForceGraph(){
    positionCache.clear()
    nodes.forEach((e) => {
        positionCache[e.id] = {x:e.x, y:e.y}
    })
    resetHover();
    tweetsGraph?.replaceChildren();
    simulation?.stop();
}

// Full (re)build: tears down and recreates the DOM and simulation from
// scratch. Use this when the underlying tweet list changes or the panel
// resizes — never call it for a config-slider change, since it restarts
// the layout instead of nudging it.
export function renderForceGraph(tweets, reset = true) {
    lastTweets = tweets;
    eraseForceGraph();

    const built = buildGraphData(tweets, positionCache);
    nodes = built.nodes;
    links = built.links;
    const shownCount = built.shownCount;

    if (nodes.length === 0) {
        simulation = null;
        const empty = document.createElement('div');
        empty.className = 'force-graph-empty';
        empty.textContent = 'No tweets match the current filters.';
        tweetsGraph.appendChild(empty);
        return;
    }

    //counts
    const untaggedCount = nodes.filter(n => n.tags.length === 0).length;
    const taggedCount = nodes.length - untaggedCount;

    const toolbarEl = buildToolbar(tweets, shownCount, untaggedCount, links.length, {
        onDataChange: updateGraphData,
        onVisualChange: () => updateHulls(nodes),
    });
    tweetsGraph.appendChild(toolbarEl);

    canvasWrap = document.createElement('div');
    canvasWrap.className = 'force-graph-canvas-wrap';
    tweetsGraph.appendChild(canvasWrap);

    width = canvasWrap.clientWidth || tweetsGraph.clientWidth || 900;
    height = Math.max(400, (tweetsGraph.clientHeight || 700) - 56);

    const svg = d3.select(canvasWrap)
      .append('svg')
        .attr('class', 'force-graph-svg')
        .attr('viewBox', [0, 0, width, height]);

    // Here starts the actual logic
    zoomGroup = svg.append('g').attr('class', 'zoom-group');

    svg.call(d3.zoom()
        .scaleExtent([0.15, 4])
        .on('zoom', (event) => zoomGroup.attr('transform', event.transform)));

    computeScales(nodes, links);

    simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(15).strength(0.7))
        .force('charge', d3.forceManyBody().strength(-50))
        .force('x', d3.forceX(v => v.tags?.length ? width/2 : -width/4).strength(v => v.tags?.length ? 0.1 : 0.3))
        .force('y', d3.forceY(height/2).strength(v => v.tags?.length ? 0.1 : 0.13))
        .force('collide', d3.forceCollide().radius(d => nodeRadius(d)).strength(0.9));

    setHullGroup(zoomGroup.append('g').attr('class', 'force-graph-hulls'));
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
        drawHulls();
        linkSel
            .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    tweetsGraph.appendChild(buildLegend());
}

export function updateGraphData() {
    const built = buildGraphData(lastTweets, positionCache);
    const freshNodes = built.nodes;
    const freshLinks = built.links;

    // if (freshNodes.length === 0) {
    //     renderForceGraph(lastTweets);
    //     return;
    // }

    resetHover();

    // Anything about to drop out gets its last known position cached,
    // same as the simulation's own "end" handler does, so re-adding it
    // later (e.g. the user raises Max tweets back up) restores it near
    // where it was instead of dropping it in fresh.
    const oldById = new Map(nodes.map(n => [n.id, n]));
    const freshIds = new Set(freshNodes.map(n => n.id));

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

    updateHulls(nodes);

    setCurrentSelection(nodeSel, linkSel, links);
    bindHoverHandlers(nodeSel);

    const untaggedCount = nodes.filter(n => n.tags.length === 0).length;
    updateToolbarStats(tweetsGraph, lastTweets, nodes.length, untaggedCount, links.length);

    // A gentle nudge, not a restart from alpha=1 — existing nodes keep
    // their position and drift only as much as the new/changed links
    // pull them.
    simulation.alpha(Math.max(simulation.alpha(), 0.3)).restart();
}

// ------
// MISC
// ------
// Recomputes the size/width scales used both for drawing and (via the
// nodeRadius/nodeSize closures forces below already reference) for the
// simulation's own force accessors. Forces that cache their per-node
// values at initialize time (collide, x, y) pick these up automatically
// the next time simulation.nodes(...) runs, since those force accessors
// close over these same `let` bindings rather than snapshotting them.
function computeScales(nodesArr, linksArr) {
    edgeWidth = d3.scaleLinear().domain([1, 3]).range([1, 3]).clamp(true);
    nodeSize = d3.scaleLinear().domain([1, 5]).range(NODE_SIZE_RANGE).clamp(true);
    nodeRadius = d => nodeSize(Math.max(1, d.tags.length)) / 2;
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