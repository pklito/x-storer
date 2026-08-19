import { state } from '../../state.js';
import { groupColorOf } from '../tagGroups.js';

const NEUTRAL_COLOR = '#7c8ba1';

export function buildLegend() {
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
        swatch.style.background = color || NEUTRAL_COLOR;
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(g));
        legend.appendChild(item);
    });

    // Untagged tweets now render too (as plain circles) — call out what
    // the neutral color means so it doesn't look like a missing color.
    const untagged = document.createElement('div');
    untagged.className = 'force-graph-legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'force-graph-legend-swatch';
    swatch.style.background = NEUTRAL_COLOR;
    untagged.appendChild(swatch);
    untagged.appendChild(document.createTextNode('no tags'));
    legend.appendChild(untagged);

    return legend;
}
