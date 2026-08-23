import { config, HULL_PAD } from './config.js';
import { tagGroupOf, groupColorOf } from '../tagGroups.js';

const NEUTRAL_COLOR = '#7c8ba1';

export function circlePathD(cx, cy, r) {
    return `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
}

// A tag's hull is a padded convex hull around all of its tweets. With
// fewer than 3 tweets (or all of them collinear, so no real hull
// exists) it falls back to a simple circle around them instead.
export function hullGeometry(tagNodes, pad = HULL_PAD) {
    const pts = tagNodes.map(n => [n.x, n.y]);
    if (pts.some(p => p[0] == null || p[1] == null)) return null;

    if (pts.length >= 3) {
        const hull = d3.polygonHull(pts);
        if (hull) {
            const centroid = d3.polygonCentroid(hull);
            const padded = hull.map(([x, y]) => {
                const dx = x - centroid[0], dy = y - centroid[1];
                const dist = Math.hypot(dx, dy) || 1;
                const scale = (dist + pad) / dist;
                return [centroid[0] + dx * scale, centroid[1] + dy * scale];
            });
            const top = padded.reduce((a, b) => (b[1] < a[1] ? b : a));
            return { d: 'M' + padded.map(p => p.join(',')).join('L') + 'Z', label: { x: top[0], y: top[1] - 8 } };
        }
    }

    // <3 points, or collinear: a circle around whatever points there are.
    const cx = d3.mean(pts, p => p[0]);
    const cy = d3.mean(pts, p => p[1]);
    const r = Math.max(pad, (d3.max(pts, p => Math.hypot(p[0] - cx, p[1] - cy)) || 0) + pad);
    return { d: circlePathD(cx, cy, r), label: { x: cx, y: cy - r - 8 } };
}

//
let hullSel = null;
let hullGroup = null;

export function setHullGroup(g) {
    hullGroup = g;
}

// Group tweets by tag, then only keep tags whose share of tagged
// tweets clears the configured threshold — that's what decides which
// tags actually get a drawn hull. Operates on whatever node set is
// passed in, so it works the same whether called after a full rebuild
// or from updateHulls() against the live (unchanged) node set.
export function computeHullEntries(nodesArr) {
    const tagToNodes = new Map();
    nodesArr.forEach(n => {
        n.tags.forEach(tag => {
            if (!tagToNodes.has(tag)) tagToNodes.set(tag, []);
            tagToNodes.get(tag).push(n);
        });
    });
    return Array.from(tagToNodes.entries())
        .map(([tag, tagNodes]) => ({ tag, group: tagGroupOf(tag), nodes: tagNodes }))
        .filter(entry => (entry.nodes.length / nodesArr.length) >= config.groupHullThreshold);
}

export function joinHulls(entries) {
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

export function applyHullOpacity() {
    if (!hullGroup) return;
    hullGroup.selectAll('.force-graph-hull-shape').style('fill-opacity', config.hullOpacity);
}

// Positions hull paths/labels immediately from current node.x/y. Needed
// whenever we redraw hulls outside of a tick (e.g. a pure hull-threshold
// change, where the simulation isn't running and no tick will fire).
export function drawHullGeometry(sel) {
    sel.each(function (d) {
        const geo = hullGeometry(d.nodes);
        if (!geo) return;
        const g = d3.select(this);
        g.select('.force-graph-hull-shape').attr('d', geo.d);
        g.select('.force-graph-hull-label').attr('x', geo.label.x).attr('y', geo.label.y);
    });
}

// Redraws the current hull selection's geometry against whatever
// node positions are live right now. Used on every simulation tick.
export function drawHulls() {
    drawHullGeometry(hullSel);
}

// Config-driven visual-only update, for the Group threshold / Hull
// opacity sliders. Deliberately never calls buildGraphData (which is
// non-deterministic — see graphData.js) and never touches nodes, links,
// or the simulation. Just re-filters which tags clear the hull
// threshold and redraws hull geometry/opacity against the current,
// unchanged node positions. Takes the live nodes array as a parameter
// since node state itself lives in index.js, not here.
export function updateHulls(nodesArr) {
    if (!hullGroup || !nodesArr || nodesArr.length === 0) return;
    joinHulls(computeHullEntries(nodesArr));
    drawHullGeometry(hullSel);
    applyHullOpacity();
}