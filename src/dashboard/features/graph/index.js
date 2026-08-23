import { config, NODE_SIZE_RANGE } from './config.js';
import { buildGraphData } from './graphData.js';
import { computeHullEntries, joinHulls, applyHullOpacity, drawHulls, updateHulls, setHullGroup } from './hulls.js';
import { tagGroupOf, groupColorOf } from '../tagGroups.js';
import { drag, bindHoverHandlers, setCurrentSelection, resetHover, enableGraphListeners, disableGraphListeners } from './interactions.js';
import { buildLegend } from './legend.js';
import { buildToolbar, updateToolbarStats } from './toolbar.js';
import { tweetsGraph, forceGraphToolbar, forceGraphEmpty, forceGraphCanvasWrap, forceGraphSvg, forceGraphLegend } from '../../dom.js';

const NEUTRAL_COLOR = '#7c8ba1';

let lastTweets = [];

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
function eraseForceGraph(currNodes){
    positionCache.clear()
    currNodes?.forEach((e) => {
        positionCache.set(e.id,{x:e.x, y:e.y});
    })
    resetHover();

    // Clear the dynamic slots, but leave the persistent skeleton
    // (canvas-wrap/svg/zoom-group) in place — renderForceGraph now
    // reuses it instead of rebuilding it.
    forceGraphToolbar?.replaceChildren();
    forceGraphLegend?.replaceChildren();
    if (zoomGroup) {
        zoomGroup.select('.force-graph-hulls').selectAll('*').remove();
        zoomGroup.select('.force-graph-links-tweet').selectAll('*').remove();
        zoomGroup.select('.force-graph-nodes').selectAll('*').remove();
    }
    simulation?.stop();
}

// Full (re)build: repopulates the pre-existing DOM skeleton (see
// index.html) and recreates the simulation from scratch. Use this when
// the underlying tweet list changes or the panel resizes — never call it
// for a config-slider change, since it restarts the layout instead of
// nudging it.
export function renderForceGraph(tweets, reset = true) {
    lastTweets = tweets;
    eraseForceGraph(nodes);

    const built = buildGraphData(tweets, positionCache);
    nodes = built.nodes;
    links = built.links;
    const shownCount = built.shownCount;

    if (nodes.length === 0) {
        simulation = null;
        forceGraphCanvasWrap.classList.add('hidden');
        forceGraphEmpty.classList.remove('hidden');
        return;
    }
    forceGraphEmpty.classList.add('hidden');
    forceGraphCanvasWrap.classList.remove('hidden');

    //counts
    const untaggedCount = nodes.filter(n => n.tweet.tags.length === 0).length;
    const taggedCount = nodes.length - untaggedCount;

    const toolbarEl = buildToolbar(tweets, shownCount, untaggedCount, links.length, {
        onDataChange: renderForceGraph.bind(null, lastTweets, false),
        onVisualChange: () => updateHulls(nodes),
    });
    forceGraphToolbar.appendChild(toolbarEl);

    canvasWrap = forceGraphCanvasWrap;
    width = canvasWrap.clientWidth || tweetsGraph.clientWidth || 900;
    height = Math.max(400, (tweetsGraph.clientHeight || 700) - 56);

    const svg = d3.select(forceGraphSvg)
        .attr('viewBox', [0, 0, width, height]);

    // Here starts the actual logic
    zoomGroup = svg.select('.zoom-group');

    svg.call(d3.zoom()
        .scaleExtent([0.15, 4])
        .on('zoom', (event) => zoomGroup.attr('transform', event.transform)));

    computeScales(nodes, links);

    simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(15).strength(0.7))
        .force('charge', d3.forceManyBody().strength(-50))
        .force('x', d3.forceX(v => v.tags?.length ? width/2 : -width/4).strength(v => v.tweet.tags?.length ? 0.1 : 0.3))
        .force('y', d3.forceY(height/2).strength(v => v.tweet.tags?.length ? 0.1 : 0.13))
        .force('collide', d3.forceCollide().radius(d => nodeRadius(d)).strength(0.9));

    setHullGroup(zoomGroup.select('.force-graph-hulls'));
    joinHulls(computeHullEntries(nodes, taggedCount));
    applyHullOpacity();

    linkSel = zoomGroup.select('.force-graph-links-tweet')
        .selectAll('line')
        .data(links, d => d.id)
        .join('line')
        .attr('stroke-width', d => edgeWidth(d.weight));

    nodeSel = zoomGroup.select('.force-graph-nodes')
        .selectAll('g')
        .data(nodes, d => d.id)
        .join(enter => enter.append('g').call(drag(simulation)));
    nodeSel.attr('class', d => `force-graph-node force-graph-node-tweet${d.tweet.tags.length === 0 ? ' force-graph-node-untagged' : ''}`);
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

    forceGraphLegend.appendChild(buildLegend());
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
    nodeRadius = d => nodeSize(Math.max(1, d.tweet.tags.length)) / 2;
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
        const size = nodeSize(Math.max(1, d.tweet.tags.length));
        if (wantTag === 'rect') {
            el.attr('x', -size / 2).attr('y', -size / 2).attr('width', size).attr('height', size);
        } else {
            el.attr('r', size / 2);
        }
        el.style('fill', (d.group && groupColorOf(d.group)) || NEUTRAL_COLOR);
    });
}