import { HULL_PAD } from './config.js';

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
