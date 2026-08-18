// Force-directed mesh of tweets, connected through shared tags.
//
// Every node is a tweet, drawn as a small uniform square. There are no
// separate tag nodes — instead, each tweet is colored by its "dominant"
// tag (the most common tag among its own tags, within the current
// filter), using that tag's group color. So color still reads as
// "topic", it's just carried by the tweet itself instead of a hub node.
//
// Edges are built per shared tag, but each tweet has one total link
// budget (2-3), not one budget per tag — otherwise a tweet with several
// tags gets a separate connectivity pass per tag, and two clusters that
// happen to share multiple tags end up with several independent link
// attempts between them, over-connecting fast. A tweet with several
// tags still ends up woven into more than one little mesh, it just
// doesn't get a fresh quota for each one.
//
// Click a tweet = open its original link, if it has one.

import { state } from '../state.js';
import { tagGroupOf, groupColorOf } from './tagGroups.js';

const CONTAINER_ID = 'force-graph-container';

// Tunables, adjustable live via the toolbar controls.
let maxTweets = 400;    // cap on nodes shown at once, for perf/legibility
let linksPerTweet = 2;  // each tweet's total link budget is linksPerTweet..linksPerTweet+1, spread across its tags
let hoverEnabled = true; // highlight + tooltip on hover; toggleable since it can get noisy in a dense mesh

const NODE_SIZE_RANGE = [7, 11]; // subtle: bigger tag count = slightly bigger square

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

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
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

    // Each tweet gets a total link budget, decided once up front — not
    // a budget per tag. Without that, a tweet with 3 tags gets 3
    // separate connectivity passes (one per tag), each handing out its
    // own 2-3 links, so two clusters sharing several tags end up with
    // several independent link attempts between them and everything
    // over-connects. Here, once a tweet has spent its budget, later
    // tags it belongs to are skipped entirely — so its total degree
    // stays close to the target regardless of how many tags it has.
    //
    // Picks are still biased toward whichever candidates currently have
    // the fewest links, so a popular tag's tweets don't just keep
    // re-selecting each other and snowballing into tight cliques.
    // Links are deduped across tags, accumulating weight/shared tags
    // for edge thickness and tooltips.
    const budget = new Map(nodes.map(n => [n.id, linksPerTweet + (Math.random() < 0.5 ? 0 : 1)]));
    const degree = new Map(nodes.map(n => [n.id, 0]));
    const linkMap = new Map();

    shuffle(Array.from(tagToNodeIds.keys())).forEach(tag => {
        const idsInTag = tagToNodeIds.get(tag);
        shuffle(idsInTag).forEach(id => {
            const remaining = budget.get(id) - degree.get(id);
            if (remaining <= 0) return; // budget already spent via an earlier shared tag

            const others = idsInTag.filter(oid => oid !== id);
            if (others.length === 0) return;

            const count = Math.min(others.length, remaining);
            const lowestDegreeFirst = shuffle(others).sort((a, b) => degree.get(a) - degree.get(b));
            const pool = lowestDegreeFirst.slice(0, Math.min(others.length, count + 3));

            pickRandom(pool, count).forEach(otherId => {
                const key = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
                let link = linkMap.get(key);
                if (!link) {
                    link = { source: id, target: otherId, weight: 0, tags: new Set() };
                    linkMap.set(key, link);
                    degree.set(id, degree.get(id) + 1);
                    degree.set(otherId, degree.get(otherId) + 1);
                }
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

    const toolbarEl = buildToolbar(tweets, shownCount, links.length);
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
    const nodeRadius = d => nodeSize(d.tags.length) / 2;

    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(45).strength(0.35))
        .force('charge', d3.forceManyBody().strength(-40))
        .force('x', d3.forceX())
        .force('y', d3.forceY())
        .force('collide', d3.forceCollide().radius(d => nodeRadius(d) + 2).strength(0.9));

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
        .attr('x', d => -nodeSize(d.tags.length) / 2)
        .attr('y', d => -nodeSize(d.tags.length) / 2)
        .attr('width', d => nodeSize(d.tags.length))
        .attr('height', d => nodeSize(d.tags.length))
        .style('fill', d => groupColorOf(d.group) || '#7c8ba1');

    const tooltip = getTooltip();

    // Placed at the front of the toolbar since it's the control most
    // worth reaching for first in a dense mesh (hover gets noisy fast).
    toolbarEl.insertBefore(buildToggle('Hover', hoverEnabled, (v) => {
        hoverEnabled = v;
        if (!v) {
            clearHighlight(nodeSel, linkSel);
            tooltip.style.display = 'none';
        }
    }), toolbarEl.firstChild);

    nodeSel
        .on('mouseenter', (event, d) => {
            if (!hoverEnabled) return;
            highlightNode(d, nodeSel, linkSel);
            showTooltip(tooltip, event, d, links);
        })
        .on('mousemove', (event) => {
            if (hoverEnabled) positionTooltip(tooltip, event);
        })
        .on('mouseleave', () => {
            if (!hoverEnabled) return;
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

    bar.appendChild(buildSlider('Links/tweet', linksPerTweet, 1, 5, (v) => {
        linksPerTweet = v;
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

function buildToggle(label, checked, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'force-graph-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(input);
    wrap.appendChild(span);
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