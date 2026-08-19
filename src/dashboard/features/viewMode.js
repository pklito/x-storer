// viewMode.js — GRID / GRAPH switch in the feed header.
// Persists the choice in localStorage and toggles #tweets-grid /
// #force-graph-container via a class, so it doesn't fight with whatever
// display value the grid/graph rendering code sets on its own.

import {state} from '../state.js';
import {updateUI} from './tweets.js'
const STORAGE_KEY = 'xb-view-mode';

const switchEl = document.getElementById('view-mode-switch');
const gridEl = document.getElementById('tweets-grid');
const graphEl = document.getElementById('force-graph-container');

function applyViewMode(mode) {
    if (!switchEl) return;

    switchEl.dataset.active = mode;
    switchEl.querySelectorAll('.view-mode-option').forEach(btn => {
        const isActive = btn.dataset.mode === mode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
    });

    gridEl?.classList.toggle('view-hidden', mode !== 'grid');
    graphEl?.classList.toggle('view-hidden', mode !== 'graph');

    state.viewMode = mode
    document.dispatchEvent(new CustomEvent('viewmodechange', { detail: { mode } }));
}

/** Returns the current mode: 'grid' or 'graph'. */
export function getViewMode() {
    return switchEl?.dataset.active === 'graph' ? 'graph' : 'grid';
}

/** Sets the mode programmatically (e.g. from a saved tab config). */
export function setViewMode(mode) {
    if (mode !== 'grid' && mode !== 'graph') return;
    localStorage.setItem(STORAGE_KEY, mode);
    applyViewMode(mode);
    updateUI();
}

/** Call once on load to wire up clicks and restore the last-used mode. */
export function initViewModeSwitch() {
    if (!switchEl) return;

    const saved = localStorage.getItem(STORAGE_KEY);
    applyViewMode(saved === 'graph' ? 'graph' : 'grid');

    switchEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.view-mode-option');
        if (btn) setViewMode(btn.dataset.mode);
    });
}