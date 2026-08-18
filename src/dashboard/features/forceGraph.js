// Force-directed mesh of tweets, connected through shared tags.
//
// Every node is a tweet, drawn as a small uniform square. There are no
// separate tag nodes — instead, each tweet is colored by its "dominant"
// tag (the most common tag among its own tags, within the current
// filter), using that tag's group color. So color still reads as
// "topic", it's just carried by the tweet itself instead of a hub node.
//
// Edges are built per shared tag: for every tag a tweet has, it gets
// linked to a handful (2-3) of other random tweets that also have that
// tag — not *all* of them, or tags with many tweets would turn into an
// unreadable clique. A tweet with several tags ends up woven into
// several of these little meshes at once, which is what pulls the
// whole graph into clusters without ever pinning a single hub node in
// the middle of each one.
//
// Click a tweet = open its original link, if it has one.

import { state } from '../state.js';
import { tagGroupOf, groupColorOf } from './tagGroups.js';

const CONTAINER_ID = 'force-graph-container';

// Tunables, adjustable live via the toolbar controls.
let maxTweets = 400;   // cap on nodes shown at once, for perf/legibility
let linksPerTag = 2;   // each tweet links to linksPerTag..linksPerTag+1 random tweets per shared tag

const NODE_SIZE = 8;

// Node positions persist across re-renders (keyed by tweet id) so
// filtering doesn't restart the whole layout from scratch every time.
const positionCache = new Map();

let lastTweets = [];
let tooltipEl = null;
let resizeQueued = false;

function getContainer() {
    return document.getElementById(CONTAINER_ID);
}

// --- Data -------------------------------------------------------------

function tweetNodeId(t, i) {
    return `${t.id ?? t.tweetId ?? `${t.timestamp || 'na'}-${i}`}`;
}

function pickRandom(arr, n) {
    if (arr.length <= n) return arr.slice();
    const pool = arr.slice();
    const picked = [];
    while (picked.length < n && pool.length > 0) {
        const idx = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(idx, 1)[0]);
    }
    return picked;
}

// Builds { nodes, links, shownCount } from a tweet list. Only real
// (user-assigned) tags are considered — built-in computed tags
// (video/gif/text-only/cw) aren't part of this graph. Untagged tweets
// have nothing to connect through, so they're left out entirely.
function buildGraphData(tweets) {
    const capped = tweets.length > maxTweets
        ? [...tweets]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, maxTweets)
        : tweets;

    const tagCounts = new Map();
    const tagToNodeIds = new Map();
    const nodes = [];

    capped.forEach((t, i) => {
        const tags = (t.tags || []).filter(tag => state.showHiddenTags || !state.hiddenTags.has(tag));
        if (tags.length === 0) return;

        const id = tweetNodeId(t, i);
        const cached = positionCache.get(id);
        nodes.push({ id, tweet: t, tags, x: cached?.x, y: cached?.y });

        tags.forEach(tag => {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            if (!tagToNodeIds.has(tag)) tagToNodeIds.set(tag, []);
            tagToNodeIds.get(tag).push(id);
        });
    });

    // Dominant tag = the most common of a tweet's own tags, within the
    // current filter — decides which group color the square gets.
    nodes.forEach(n => {
        n.dominantTag = n.tags.reduce((best, tag) =>
            (tagCounts.get(tag) || 0) > (tagCounts.get(best) || 0) ? tag : best, n.tags[0]);
        n.group = tagGroupOf(n.dominantTag);
    });

    // Per shared tag, link each tweet to a handful of random co-tagged
    // tweets. Links are deduped across tags, accumulating weight/shared
    // tags for edge thickness and tooltips.
    const linkMap = new Map();
    nodes.forEach(n => {
        n.tags.forEach(tag => {
            const others = tagToNodeIds.get(tag).filter(id => id !== n.id);
            const count = linksPerTag + (Math.random() < 0.5 ? 0 : 1);
            pickRandom(others, count).forEach(otherId => {
                const key = n.id < otherId ? `${n.id}|${otherId}` : `${otherId}|${n.id}`;
                if (!linkMap.has(key)) {
                    linkMap.set(key, { source: n.id, target: otherId, weight: 0, tags: new Set() });
                }
                const link = linkMap.get(key);
                link.weight += 1;
                link.tags.add(tag);
            });
        });
    });

    return {
        nodes,
        links: Array.from(linkMap.values()),
        shownCount: nodes.length,
    };
}

// --- Render -------------------------------------------------------------

export function renderForceGraph(tweets) {
    lastTweets = tweets;
    const root = getContainer();
    if (!root) return;

    const { nodes, links, shownCount } = buildGraphData(tweets);
    root.replaceChildren();

    if (nodes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'force-graph-empty';
        empty.textContent = 'No tagged tweets match the current filters.';
        root.appendChild(empty);
        return;
    }

    root.appendChild(buildToolbar(tweets, shownCount, links.length));

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

    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(45).strength(0.35))
        .force('charge', d3.forceManyBody().strength(-40))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collide', d3.forceCollide().radius(NODE_SIZE + 2).strength(0.9));

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
        .attr('class', 'force-graph-node force-graph-node-tweet')
        .call(drag(simulation));

    nodeSel.append('rect')
        .attr('class', 'force-graph-planet')
        .attr('x', -NODE_SIZE / 2)
        .attr('y', -NODE_SIZE / 2)
        .attr('width', NODE_SIZE)
        .attr('height', NODE_SIZE)
        .style('fill', d => groupColorOf(d.group) || '#7c8ba1');

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
            const url = d.tweet.url || d.tweet.link || d.tweet.permalink;
            if (url) window.open(url, '_blank', 'noopener');
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
    const t = d.tweet;
    const who = t.authorHandle ? `@${t.authorHandle}` : (t.authorName || 'unknown');
    const text = (t.text || '').slice(0, 140) + ((t.text || '').length > 140 ? '…' : '');
    const tagList = d.tags.map(tag => tag === d.dominantTag ? `<strong>#${escapeHtml(tag)}</strong>` : `#${escapeHtml(tag)}`).join(' ');
    const linkCount = links.filter(l => l.source.id === d.id || l.target.id === d.id).length;
    el.innerHTML = `
        <div class="force-graph-tooltip-title">${escapeHtml(who)}</div>
        <div class="force-graph-tooltip-count">${escapeHtml(text)}</div>
        <div class="force-graph-tooltip-related">${tagList} &middot; ${linkCount} link${linkCount === 1 ? '' : 's'}</div>
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

    const meta = document.createElement('div');
    meta.className = 'force-graph-legend-item force-graph-legend-meta';
    meta.textContent = '■ tweet, colored by its most common tag';
    legend.appendChild(meta);

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

function buildToolbar(tweets, shownTweetCount, linkCount) {
    const bar = document.createElement('div');
    bar.className = 'force-graph-toolbar';

    const stats = document.createElement('div');
    stats.className = 'force-graph-stats';
    const cappedNote = shownTweetCount < tweets.length ? ` (of ${tweets.length})` : '';
    stats.textContent = `${shownTweetCount} tweets shown${cappedNote} · ${linkCount} links`;
    bar.appendChild(stats);

    const sliderMax = Math.max(50, tweets.length);
    bar.appendChild(buildSlider('Max tweets', Math.min(maxTweets, sliderMax), 20, sliderMax, (v) => {
        maxTweets = v;
        renderForceGraph(lastTweets);
    }));

    bar.appendChild(buildSlider('Links/tag', linksPerTag, 1, 5, (v) => {
        linksPerTag = v;
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