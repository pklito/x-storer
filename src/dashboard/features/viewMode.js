// viewMode.js — GRID / GRAPH switch in the feed header. Writes straight
// to state.viewMode and re-runs updateUI(), which already branches on it
// (renderForceGraph vs renderGrid) — this file just drives that switch.

import { state } from '../state.js';
import { viewModeSwitch } from '../dom.js';
import { updateUI } from './tweets.js';
import { startGraph, stopGraph } from './graph/index.js';
import { startGrid, stopGrid } from './grid.js';

function applyViewModeUI(mode) {
    if (!viewModeSwitch) return;
    viewModeSwitch.dataset.active = mode;
    viewModeSwitch.querySelectorAll('.view-mode-option').forEach(btn => {
        const isActive = btn.dataset.mode === mode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
    });
}

export function getViewMode() {
    return state.viewMode === 'grid' ? 'grid' : 'graph';
}

export function setViewMode(mode) {
    if (mode !== 'grid' && mode !== 'graph') return;
    state.viewMode = mode;
    applyViewModeUI(mode);
    applyViewModeContainers(mode);
    updateUI();
}

function applyViewModeContainers(mode){
    if (mode === 'grid'){
        stopGraph();
        startGrid();
    }
    else{
        stopGrid();
        startGraph();
    }
}

/** Call once on load — syncs the switch to whatever state.viewMode
 *  already is (default 'graph', per tweets.js) and wires up clicks. */
export function initViewModeSwitch() {
    if (!viewModeSwitch) return;
    applyViewModeUI(getViewMode());
    viewModeSwitch.addEventListener('click', (e) => {
        const btn = e.target.closest('.view-mode-option');
        if (btn) setViewMode(btn.dataset.mode);
    });
}