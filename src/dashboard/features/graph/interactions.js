import { getTooltip, showTooltip, positionTooltip } from './tooltip.js';

// Hover highlight/tooltip only shows while Shift is held — otherwise a
// dense mesh lights up and re-lights constantly as the cursor passes
// over it. This state (and the window listeners below) live at module
// scope, not per-render, so a single pair of listeners can drive
// whichever render is current rather than piling up a new listener on
// every re-render.
const hover = {
    shiftDown: false,
    hoveredNode: null,
    lastMouseEvent: null,
    nodeSel: null,
    linkSel: null,
    links: [],
};

function refreshHoverVisual() {
    if (!hover.nodeSel || !hover.linkSel) return;
    const tooltip = getTooltip();
    if (hover.shiftDown && hover.hoveredNode) {
        highlightNode(hover.hoveredNode, hover.nodeSel, hover.linkSel);
        if (hover.lastMouseEvent) showTooltip(tooltip, hover.lastMouseEvent, hover.hoveredNode, hover.links);
    } else {
        clearHighlight(hover.nodeSel, hover.linkSel);
        tooltip.style.display = 'none';
    }
}

window.addEventListener('keydown', (e) => {
    if (e.key !== 'Shift' || hover.shiftDown) return;
    hover.shiftDown = true;
    refreshHoverVisual();
});
window.addEventListener('keyup', (e) => {
    if (e.key !== 'Shift') return;
    hover.shiftDown = false;
    refreshHoverVisual();
});
// In case Shift was released while the window didn't have focus (e.g. an
// alt-tab), don't leave the highlight stuck on.
window.addEventListener('blur', () => {
    if (!hover.shiftDown) return;
    hover.shiftDown = false;
    refreshHoverVisual();
});

// Call once per render, after the node/link selections exist, so the
// shared hover state points at the current render's selections.
export function setCurrentSelection(nodeSel, linkSel, links) {
    hover.nodeSel = nodeSel;
    hover.linkSel = linkSel;
    hover.links = links;
}

// Call at the top of a render to clear any highlight left over from
// the previous render (e.g. the mouse was still over a node when a
// filter change triggered a re-render).
export function resetHover() {
    hover.hoveredNode = null;
    getTooltip().style.display = 'none';
}

export function bindHoverHandlers(nodeSel) {
    nodeSel
        .on('mouseenter', (event, d) => {
            hover.hoveredNode = d;
            hover.lastMouseEvent = event;
            refreshHoverVisual();
        })
        .on('mousemove', (event) => {
            hover.lastMouseEvent = event;
            if (hover.shiftDown) positionTooltip(getTooltip(), event);
        })
        .on('mouseleave', () => {
            hover.hoveredNode = null;
            refreshHoverVisual();
        })
        .on('click', (event, d) => {
            if (d._dragged) { d._dragged = false; return; } // suppress click right after a drag
            const url = d.tweet.url || d.tweet.link || d.tweet.permalink;
            if (url) window.open(url, '_blank', 'noopener');
        });
}

export function drag(sim) {
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

export function highlightNode(d, nodeSel, linkSel) {
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

export function clearHighlight(nodeSel, linkSel) {
    nodeSel.classed('is-dimmed', false);
    linkSel.classed('is-dimmed', false).classed('is-highlighted', false);
}
