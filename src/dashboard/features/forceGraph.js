// Force-directed graph of tweets and tags: a little galaxy.
//
// Tags = stars. Bigger star = more of the currently-filtered tweets
// have that tag. Colored by the tag's group (same colors as the
// sidebar), so group doubles as "constellation" color for free.
//
// Tweets = planets. All the same size, one per filtered tweet, each
// linked to every tag it carries — so a tweet with 3 tags sits pulled
// between 3 stars, landing wherever those pulls balance out.
//
// Tags in the same group also get a very soft link to each other —
// weak enough that it doesn't fight the tweet/tag links, but enough to
// nudge same-group stars into loose neighborhoods instead of scattering
// uniformly.
//
// Click a tag = toggle tag selection (same as clicking a sidebar
// chip). Shift-click a tag = toggle exclusion. Click a tweet = open its
// original link, if it has one. Both funnel through updateUI() so the
// grid/sidebar/graph all stay in sync with the rest of the app.

import { state } from '../state.js';
import { tagGroupOf, groupColorOf } from './tagGroups.js';
import { updateUI } from './tweets.js';

const CONTAINER_ID = 'force-graph-container';

// Tunables, adjustable live via the toolbar controls.
let maxTweets = 400;       // cap on planets shown at once, for perf/legibility
let showGroupLinks = true; // soft tag-tag links within a group

const TWEET_RADIUS = 4;
const TAG_RADIUS_RANGE = [16, 64];

// Node positions persist across re-renders (keyed by "type:id") so
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
    return `t:${t.id ?? t.tweetId ?? `${t.timestamp || 'na'}-${i}`}`;
}

// Builds { nodes, tweetLinks, groupLinks, shownCount } from a tweet
// list. Only real (user-assigned) tags are considered — built-in
// computed tags (video/gif/text-only/cw) aren't part of this graph,
// they're a different kind of thing. Untagged tweets have nothing to
// orbit, so they're left out entirely.
function buildGraphData(tweets) {
    const capped = tweets.length > maxTweets
        ? [...tweets]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, maxTweets)
        : tweets;

    const tagCounts = new Map();
    const tweetNodes = [];
    const tweetLinks = [];

    capped.forEach((t, i) => {
        const tags = (t.tags || []).filter(tag => state.showHiddenTags || !state.hiddenTags.has(tag));
        if (tags.length === 0) return;

        const id = tweetNodeId(t, i);
        const cached = positionCache.get(`tweet:${id}`);
        tweetNodes.push({ id, type: 'tweet', tweet: t, tags, x: cached?.x, y: cached?.y });

        tags.forEach(tag => {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            tweetLinks.push({ source: id, target: tag });
        });
    });

    const tagNodes = Array.from(tagCounts.entries()).map(([tag, count]) => {
        const cached = positionCache.get(`tag:${tag}`);
        return { id: tag, type: 'tag', count, group: tagGroupOf(tag), x: cached?.x, y: cached?.y };
    });

    // Soft same-group tag-tag links (a loose clique per group).
    const groupLinks = [];
    if (showGroupLinks) {
        const byGroup = new Map();
        tagNodes.forEach(n => {
            if (!byGroup.has(n.group)) byGroup.set(n.group, []);
            byGroup.get(n.group).push(n.id);
        });
        byGroup.forEach(tagsInGroup => {
            for (let i = 0; i < tagsInGroup.length; i++) {
                for (let j = i + 1; j < tagsInGroup.length; j++) {
                    groupLinks.push({ source: tagsInGroup[i], target: tagsInGroup[j] });
                }
            }
        });
    }

    return {
        nodes: [...tagNodes, ...tweetNodes],
        tweetLinks,
        groupLinks,
        shownCount: tweetNodes.length,
    };
}

// --- Render -------------------------------------------------------------

export function renderForceGraph(tweets) {
    lastTweets = tweets;
    const root = getContainer();
    if (!root) return;

    const { nodes, tweetLinks, groupLinks, shownCount } = buildGraphData(tweets);
    root.replaceChildren();

    if (nodes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'force-graph-empty';
        empty.textContent = 'No tagged tweets match the current filters.';
        root.appendChild(empty);
        return;
    }

    const tagNodeCount = nodes.filter(n => n.type === 'tag').length;
    root.appendChild(buildToolbar(tweets, tagNodeCount, shownCount, tweetLinks.length));

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

    const maxTagCount = d3.max(nodes.filter(n => n.type === 'tag'), d => d.count) || 1;
    const tagRadius = d3.scaleSqrt().domain([1, maxTagCount]).range(TAG_RADIUS_RANGE);
    const radius = d => d.type === 'tag' ? tagRadius(d.count) : TWEET_RADIUS;

    const simulation = d3.forceSimulation(nodes)
        .force('tweetTag', d3.forceLink(tweetLinks).id(d => d.id).distance(50).strength(0.7))
        .force('group', d3.forceLink(groupLinks).id(d => d.id).distance(240).strength(0.025))
        .force('charge', d3.forceManyBody().strength(d => d.type === 'tag' ? -320 : -16))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collide', d3.forceCollide().radius(d => radius(d) + (d.type === 'tag' ? 6 : 2)).strength(0.9));

    const tweetLinkSel = zoomGroup.append('g')
        .attr('class', 'force-graph-links force-graph-links-tweet')
        .selectAll('line')
        .data(tweetLinks)
        .join('line');

    const groupLinkSel = zoomGroup.append('g')
        .attr('class', 'force-graph-links force-graph-links-group')
        .selectAll('line')
        .data(groupLinks)
        .join('line');

    const nodeSel = zoomGroup.append('g')
        .attr('class', 'force-graph-nodes')
        .selectAll('g')
        .data(nodes, d => d.id)
        .join('g')
        .attr('class', d => `force-graph-node force-graph-node-${d.type} ${d.type === 'tag' ? nodeStateClass(d.id) : ''}`)
        .call(drag(simulation));

    // Stars: a spiky shape with a soft glow, colored by tag group.
    nodeSel.filter(d => d.type === 'tag')
        .append('path')
        .attr('class', 'force-graph-star')
        .attr('d', d => starPath(radius(d)))
        .attr('fill', d => groupColorOf(d.group) || '#7c8ba1')
        .style('filter', d => `drop-shadow(0 0 6px ${groupColorOf(d.group) || '#7c8ba1'})`);

    // Planets: plain small uniform circles, deliberately neutral so the
    // star colors read as the graph's "constellations".
    nodeSel.filter(d => d.type === 'tweet')
        .append('circle')
        .attr('class', 'force-graph-planet')
        .attr('r', TWEET_RADIUS);

    nodeSel.filter(d => d.type === 'tag')
        .append('text')
        .attr('class', 'force-graph-label')
        .attr('dy', d => radius(d) + 14)
        .attr('text-anchor', 'middle')
        .text(d => `#${d.id}`);

    const tooltip = getTooltip();

    nodeSel
        .on('mouseenter', (event, d) => {
            highlightNode(d, nodeSel, tweetLinkSel, groupLinkSel);
            showTooltip(tooltip, event, d, tweetLinks);
        })
        .on('mousemove', (event) => positionTooltip(tooltip, event))
        .on('mouseleave', () => {
            clearHighlight(nodeSel, tweetLinkSel, groupLinkSel);
            tooltip.style.display = 'none';
        })
        .on('click', (event, d) => {
            if (d._dragged) { d._dragged = false; return; } // suppress click right after a drag

            if (d.type === 'tag') {
                if (event.shiftKey) {
                    if (state.excludedTags.has(d.id)) state.excludedTags.delete(d.id);
                    else { state.excludedTags.add(d.id); state.selectedTags.delete(d.id); }
                } else {
                    if (state.selectedTags.has(d.id)) state.selectedTags.delete(d.id);
                    else if (state.excludedTags.has(d.id)) state.excludedTags.delete(d.id);
                    else { state.selectedTags.add(d.id); state.excludedTags.delete(d.id); }
                }
                updateUI();
            } else {
                const url = d.tweet.url || d.tweet.link || d.tweet.permalink;
                if (url) window.open(url, '_blank', 'noopener');
            }
        });

    simulation.on('tick', () => {
        tweetLinkSel
            .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        groupLinkSel
            .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Cache positions once it settles so the next render (e.g. after a
    // filter change) starts from where things already were instead of
    // re-simulating from scratch.
    simulation.on('end', () => {
        nodes.forEach(n => positionCache.set(`${n.type}:${n.id}`, { x: n.x, y: n.y }));
    });

    root.appendChild(buildLegend());
}

// A simple 5-pointed star path, centered on (0,0), sized to outerR.
function starPath(outerR, points = 5, innerRatio = 0.45) {
    const innerR = outerR * innerRatio;
    let d = '';
    for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI / points) * i - Math.PI / 2;
        const x = (r * Math.cos(angle)).toFixed(2);
        const y = (r * Math.sin(angle)).toFixed(2);
        d += (i === 0 ? 'M' : 'L') + x + ',' + y + ' ';
    }
    return d + 'Z';
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

function highlightNode(d, nodeSel, tweetLinkSel, groupLinkSel) {
    const neighbors = new Set([d.id]);
    tweetLinkSel.each(function (l) {
        if (l.source.id === d.id) neighbors.add(l.target.id);
        if (l.target.id === d.id) neighbors.add(l.source.id);
    });
    if (d.type === 'tag') {
        groupLinkSel.each(function (l) {
            if (l.source.id === d.id) neighbors.add(l.target.id);
            if (l.target.id === d.id) neighbors.add(l.source.id);
        });
    }
    nodeSel.classed('is-dimmed', n => !neighbors.has(n.id));
    tweetLinkSel
        .classed('is-dimmed', l => l.source.id !== d.id && l.target.id !== d.id)
        .classed('is-highlighted', l => l.source.id === d.id || l.target.id === d.id);
    groupLinkSel
        .classed('is-dimmed', l => !(d.type === 'tag' && (l.source.id === d.id || l.target.id === d.id)))
        .classed('is-highlighted', l => d.type === 'tag' && (l.source.id === d.id || l.target.id === d.id));
}

function clearHighlight(nodeSel, tweetLinkSel, groupLinkSel) {
    nodeSel.classed('is-dimmed', false);
    tweetLinkSel.classed('is-dimmed', false).classed('is-highlighted', false);
    groupLinkSel.classed('is-dimmed', false).classed('is-highlighted', false);
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

function showTooltip(el, event, d, tweetLinks) {
    if (d.type === 'tag') {
        const related = tweetLinks
            .filter(l => l.source.id === d.id || l.target.id === d.id)
            .length;
        el.innerHTML = `
            <div class="force-graph-tooltip-title">★ #${escapeHtml(d.id)}</div>
            <div class="force-graph-tooltip-count">${d.count} tweet${d.count === 1 ? '' : 's'} &middot; ${escapeHtml(d.group)}</div>
        `;
    } else {
        const t = d.tweet;
        const who = t.authorHandle ? `@${t.authorHandle}` : (t.authorName || 'unknown');
        const text = (t.text || '').slice(0, 140) + ((t.text || '').length > 140 ? '…' : '');
        const tagList = d.tags.map(tag => `#${tag}`).join(' ');
        el.innerHTML = `
            <div class="force-graph-tooltip-title">${escapeHtml(who)}</div>
            <div class="force-graph-tooltip-count">${escapeHtml(text)}</div>
            ${tagList ? `<div class="force-graph-tooltip-related">${escapeHtml(tagList)}</div>` : ''}
        `;
    }
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
    meta.textContent = '★ tag   ● tweet';
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

function buildToolbar(tweets, tagCount, shownTweetCount, linkCount) {
    const bar = document.createElement('div');
    bar.className = 'force-graph-toolbar';

    const stats = document.createElement('div');
    stats.className = 'force-graph-stats';
    const cappedNote = shownTweetCount < tweets.length ? ` (of ${tweets.length})` : '';
    stats.textContent = `${tagCount} tags · ${shownTweetCount} tweets shown${cappedNote} · ${linkCount} links`;
    bar.appendChild(stats);

    const sliderMax = Math.max(50, tweets.length);
    bar.appendChild(buildSlider('Max tweets', Math.min(maxTweets, sliderMax), 20, sliderMax, (v) => {
        maxTweets = v;
        renderForceGraph(lastTweets);
    }));

    bar.appendChild(buildToggle('Group links', showGroupLinks, (v) => {
        showGroupLinks = v;
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