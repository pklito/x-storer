import { state, SEARCH_TABS_KEY } from './state.js';
import { searchTabsEl, addTabBtn } from './dom.js';
import { updateUI } from './tweets.js';

export function loadSearchTabsState() {
    try {
        const raw = localStorage.getItem(SEARCH_TABS_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            if (Array.isArray(data.tabs) && data.tabs.length) state.searchTabs = data.tabs;
            if (data.activeTabId) state.activeTabId = data.activeTabId;
        }
    } catch (err) {
        console.error('Failed to load search tabs:', err);
    }
    if (!state.searchTabs.some(t => t.id === 'default')) {
        state.searchTabs.unshift({ id: 'default', name: 'All', selectedTags: [], excludedTags: [] });
    }
}

export function saveSearchTabsState() {
    try {
        localStorage.setItem(SEARCH_TABS_KEY, JSON.stringify({ tabs: state.searchTabs, activeTabId: state.activeTabId }));
    } catch (err) {
        console.error('Failed to save search tabs:', err);
    }
}

// Restores the active tab's filters into state WITHOUT re-rendering (tweets
// haven't loaded yet at startup) — the first updateUI() call picks it up.
export function applyActiveTabSilently() {
    const tab = state.searchTabs.find(t => t.id === state.activeTabId) || state.searchTabs[0];
    state.selectedTags = new Set(tab.selectedTags || []);
    state.excludedTags = new Set(tab.excludedTags || []);
    state.activeTabId = tab.id;
}

export function applySearchTab(id) {
    const tab = state.searchTabs.find(t => t.id === id);
    if (!tab) return;
    state.activeTabId = id;
    state.selectedTags = new Set(tab.selectedTags || []);
    state.excludedTags = new Set(tab.excludedTags || []);
    saveSearchTabsState();
    updateUI();
    renderSearchTabs();
}

export function addSearchTab() {
    const name = prompt('Name this search tab:', `Search ${state.searchTabs.length}`);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const tab = {
        id: 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        name: trimmed,
        selectedTags: Array.from(state.selectedTags),
        excludedTags: Array.from(state.excludedTags)
    };
    state.searchTabs.push(tab);
    state.activeTabId = tab.id;
    saveSearchTabsState();
    renderSearchTabs();
}

export function deleteSearchTab(id) {
    if (id === 'default') return;
    state.searchTabs = state.searchTabs.filter(t => t.id !== id);
    if (state.activeTabId === id) {
        state.activeTabId = 'default';
        state.selectedTags = new Set();
        state.excludedTags = new Set();
        updateUI();
    }
    saveSearchTabsState();
    renderSearchTabs();
}

export function renderSearchTabs() {
    if (!searchTabsEl) return;
    searchTabsEl.querySelectorAll('.search-tab').forEach(el => el.remove());

    state.searchTabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.className = 'search-tab' + (tab.id === state.activeTabId ? ' active' : '');

        const label = document.createTextNode(tab.name);
        btn.appendChild(label);

        if (tab.id !== 'default') {
            const closeBtn = document.createElement('span');
            closeBtn.className = 'search-tab-close';
            const icon = document.createElement('i');
            icon.className = 'bi bi-x';
            closeBtn.appendChild(icon);
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteSearchTab(tab.id);
            });
            btn.appendChild(closeBtn);
        }

        btn.addEventListener('click', () => applySearchTab(tab.id));
        searchTabsEl.insertBefore(btn, addTabBtn);
    });
}
