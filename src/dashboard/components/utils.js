import { tagList } from './dom.js';

// Best-effort layout fix for the sidebar's dead space: I don't have your
// CSS/HTML file, so this can't target a specific selector. Instead it
// walks up from the tag list at runtime looking for either (a) a CSS Grid
// ancestor whose first (sidebar) column track is a fixed px width, or
// (b) an ancestor that itself has a fixed px width in the typical sidebar
// range (~120–480px), and widens whichever it finds by ~18%. If this
// doesn't hit the right element, share style.css / index.html and I can
// target it precisely instead.
export function widenSidebarIfPossible() {
    let el = tagList.parentElement;
    let hops = 0;
    while (el && el !== document.body && hops < 8) {
        const parent = el.parentElement;
        if (parent) {
            const pcs = getComputedStyle(parent);
            if (pcs.display === 'grid' && pcs.gridTemplateColumns) {
                const cols = pcs.gridTemplateColumns.trim().split(/\s+/);
                if (cols.length >= 2 && /^[\d.]+px$/.test(cols[0])) {
                    cols[0] = (parseFloat(cols[0]) * 1.18).toFixed(0) + 'px';
                    parent.style.gridTemplateColumns = cols.join(' ');
                    return;
                }
            }
        }
        const cs = getComputedStyle(el);
        if (/^[\d.]+px$/.test(cs.width) && parseFloat(cs.width) > 120 && parseFloat(cs.width) < 480) {
            const widened = (parseFloat(cs.width) * 1.18).toFixed(0) + 'px';
            el.style.width = widened;
            if (cs.flexBasis && cs.flexBasis !== 'auto') el.style.flexBasis = widened;
            return;
        }
        el = parent;
        hops++;
    }
}
