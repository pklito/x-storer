import { state, SEARCH_TABS_KEY } from '../state.js';
import { searchTabsEl, addTabBtn, configureTabBtn } from '../dom.js';

import { updateUI } from './tweets.js';

export function loadSearchTabsState() {
    try {
        const raw = localStorage.getItem(SEARCH_TABS_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            if (Array.isArray(data.tabs) && data.tabs.length) state.searchTabs = data.tabs;
            if (data.defaultTabId) state.defaultTabId = data.defaultTabId;
        }
    } catch (err) {
        console.error('Failed to load search tabs:', err);
    }
    if (!state.searchTabs.some(t => t.id === 'default')) {
        state.searchTabs.unshift({ id: 'default', name: 'All', selectedTags: [], excludedTags: [], hiddenOnly: false });
    }
    // Backfill hiddenOnly for tabs saved before this feature existed.
    state.searchTabs.forEach(t => { if (typeof t.hiddenOnly !== 'boolean') t.hiddenOnly = false; });

    // If the saved default tab no longer exists, fall back to 'default'.
    if (!state.searchTabs.some(t => t.id === state.defaultTabId)) {
        state.defaultTabId = 'default';
    }

    // The dashboard always opens on the configured default tab, regardless
    // of whichever tab was active when the page was last closed.
    state.activeTabId = state.defaultTabId;
}

export function saveSearchTabsState() {
    try {
        localStorage.setItem(SEARCH_TABS_KEY, JSON.stringify({
            tabs: state.searchTabs,
            activeTabId: state.activeTabId,
            defaultTabId: state.defaultTabId
        }));
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
        excludedTags: Array.from(state.excludedTags),
        hiddenOnly: false
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
    if (state.defaultTabId === id) {
        state.defaultTabId = 'default';
    }
    saveSearchTabsState();
    renderSearchTabs();
}

// A tab is visible in the tab strip unless it's marked hidden-tags-only and
// hidden-tags mode is currently off.
function isTabVisible(tab) {
    return !tab.hiddenOnly || state.showHiddenTags;
}

export function renderSearchTabs() {
    if (!searchTabsEl) return;
    searchTabsEl.querySelectorAll('.search-tab').forEach(el => el.remove());

    // If the currently active tab just became invisible (e.g. hidden-tags
    // mode was turned off while a hidden-only tab was selected), fall back
    // to the default tab so the UI isn't stuck on a tab the user can't see.
    const activeTab = state.searchTabs.find(t => t.id === state.activeTabId);
    if (activeTab && !isTabVisible(activeTab)) {
        applySearchTab(state.defaultTabId);
        return; // applySearchTab() re-invokes renderSearchTabs()
    }

    state.searchTabs.filter(isTabVisible).forEach(tab => {
        const btn = document.createElement('button');
        btn.className = 'search-tab' + (tab.id === state.activeTabId ? ' active' : '');

        const label = document.createTextNode(tab.name);
        btn.appendChild(label);

        btn.addEventListener('click', () => applySearchTab(tab.id));
        searchTabsEl.insertBefore(btn, addTabBtn);
    });
}

// ---------------------------------------------------------------------------
// Configure Tabs modal
// ---------------------------------------------------------------------------
// Built entirely in JS (no extra markup needed in index.html) so it works
// with just the `configureTabBtn` element already wired up in dom.js.

let configModalEl = null;
let configListEl = null;
let draggedTabId = null;

function closeConfigureTabsModal() {
    if (configModalEl) {
        configModalEl.remove();
        configModalEl = null;
        configListEl = null;
        draggedTabId = null;
    }
}

// Moves `draggedId` in state.searchTabs to just before/after `targetId`.
function reorderSearchTabs(draggedId, targetId, insertAfter) {
    if (draggedId === targetId) return;
    const fromIndex = state.searchTabs.findIndex(t => t.id === draggedId);
    if (fromIndex === -1) return;
    const [moved] = state.searchTabs.splice(fromIndex, 1);
    let toIndex = state.searchTabs.findIndex(t => t.id === targetId);
    if (toIndex === -1) {
        state.searchTabs.push(moved);
        return;
    }
    if (insertAfter) toIndex++;
    state.searchTabs.splice(toIndex, 0, moved);
}

function refreshConfigList() {
    if (!configListEl) return;
    configListEl.innerHTML = '';
    state.searchTabs.forEach((tab) => {
        if (!isTabVisible(tab)) return;
        configListEl.appendChild(buildConfigRow(tab))
    });
}

function buildConfigRow(tab) {
    const row = document.createElement('div');
    row.className = 'search-tab-config-row';
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.08);';

    // Drag handle — only this element initiates the drag, so grabbing the
    // name field still just lets you select/edit text.
    const grip = document.createElement('i');
    grip.className = 'bi bi-grip-vertical';
    grip.title = 'Drag to reorder';
    grip.style.cssText = 'cursor:grab;opacity:0.6;';
    grip.draggable = true;
    grip.addEventListener('dragstart', (e) => {
        draggedTabId = tab.id;
        e.dataTransfer.effectAllowed = 'move';
        row.style.opacity = '0.4';
    });
    grip.addEventListener('dragend', () => {
        draggedTabId = null;
        row.style.opacity = '';
        row.style.borderTop = '';
        row.style.borderBottom = '';
    });
    row.appendChild(grip);

    row.addEventListener('dragover', (e) => {
        if (!draggedTabId || draggedTabId === tab.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const insertAfter = (e.clientY - rect.top) > rect.height / 2;
        row.style.borderTop = insertAfter ? '' : '2px solid #3b82f6';
        row.style.borderBottom = insertAfter ? '2px solid #3b82f6' : '';
    });
    row.addEventListener('dragleave', () => {
        row.style.borderTop = '';
        row.style.borderBottom = '';
    });
    row.addEventListener('drop', (e) => {
        if (!draggedTabId || draggedTabId === tab.id) return;
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const insertAfter = (e.clientY - rect.top) > rect.height / 2;
        reorderSearchTabs(draggedTabId, tab.id, insertAfter);
        draggedTabId = null;
        saveSearchTabsState();
        refreshConfigList();
        renderSearchTabs();
    });

    // Set-as-default radio
    const defaultRadio = document.createElement('input');
    defaultRadio.type = 'radio';
    defaultRadio.name = 'search-tab-default';
    defaultRadio.checked = tab.id === state.defaultTabId;
    defaultRadio.title = 'Open this tab by default';
    defaultRadio.addEventListener('change', () => {
        if (defaultRadio.checked) {
            state.defaultTabId = tab.id;
            saveSearchTabsState();
        }
    });
    row.appendChild(defaultRadio);

    // Name (editable)
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = tab.name;
    nameInput.disabled = tab.id === 'default';
    nameInput.style.cssText = 'flex:1;min-width:0;background:transparent;color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:4px;padding:4px 6px;';
    nameInput.addEventListener('change', () => {
        const trimmed = nameInput.value.trim();
        if (trimmed) {
            tab.name = trimmed;
            saveSearchTabsState();
            renderSearchTabs();
        } else {
            nameInput.value = tab.name;
        }
    });
    row.appendChild(nameInput);

    // Included/excluded tag counts for this tab's saved filters
    const countsSpan = document.createElement('span');
    countsSpan.className = 'search-tab-config-counts';
    countsSpan.style.cssText = 'font-size:0.8em;opacity:0.7;white-space:nowrap;';
    const refreshCounts = () => {
        countsSpan.textContent = `${(tab.selectedTags || []).length} in · ${(tab.excludedTags || []).length} out`;
    };
    refreshCounts();
    row.appendChild(countsSpan);

    // Update this tab's saved filters to whatever is currently included/excluded
    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.title = 'Save the currently included/excluded tags to this tab';
    updateBtn.style.cssText = 'background:none;border:none;color:inherit;opacity:0.7;cursor:pointer;padding:4px;';
    updateBtn.disabled = tab.id === 'default';
    if (tab.id === 'default') updateBtn.style.visibility = 'hidden';
    const updateIcon = document.createElement('i');
    updateIcon.className = 'bi bi-arrow-repeat';
    updateBtn.appendChild(updateIcon);
    updateBtn.addEventListener('click', () => {
        tab.selectedTags = Array.from(state.selectedTags);
        tab.excludedTags = Array.from(state.excludedTags);
        refreshCounts();
        saveSearchTabsState();
    });
    row.appendChild(updateBtn);

    if(state.showHiddenTags) {
        // Hidden-tags-only checkbox
        const hiddenLabel = document.createElement('label');
        hiddenLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:0.85em;white-space:nowrap;cursor:pointer;';
        const hiddenCheckbox = document.createElement('input');
        hiddenCheckbox.type = 'checkbox';
        hiddenCheckbox.checked = !!tab.hiddenOnly;
        hiddenCheckbox.addEventListener('change', () => {
            tab.hiddenOnly = hiddenCheckbox.checked;
            // A tab that's no longer visible can't stay the default.
            if (tab.hiddenOnly && !state.showHiddenTags && state.defaultTabId === tab.id) {
                state.defaultTabId = 'default';
                const fallbackRadio = configModalEl.querySelector(`input[name="search-tab-default"][data-tab-id="default"]`);
                if (fallbackRadio) fallbackRadio.checked = true;
            }
            saveSearchTabsState();
            renderSearchTabs();
        });
        hiddenLabel.appendChild(hiddenCheckbox);
        hiddenLabel.appendChild(document.createTextNode('Hidden-tags only'));
        row.appendChild(hiddenLabel);
    }

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.title = 'Delete tab';
    deleteBtn.style.cssText = 'background:none;border:none;color:inherit;opacity:0.7;cursor:pointer;padding:4px;';
    deleteBtn.disabled = tab.id === 'default';
    if (tab.id === 'default') deleteBtn.style.visibility = 'hidden';
    const deleteIcon = document.createElement('i');
    deleteIcon.className = 'bi bi-trash';
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.addEventListener('click', () => {
        deleteSearchTab(tab.id);
        row.remove();
    });
    row.appendChild(deleteBtn);

    // tag the default radio so the fallback lookup above can find it
    defaultRadio.dataset.tabId = tab.id;

    return row;
}

export function openConfigureTabsModal() {
    closeConfigureTabsModal();

    const overlay = document.createElement('div');
    overlay.className = 'search-tab-config-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeConfigureTabsModal();
    });

    const panel = document.createElement('div');
    panel.className = 'search-tab-config-panel';
    panel.style.cssText = 'background:#1e1e1e;color:#eee;border-radius:8px;padding:16px 20px;width:min(480px,90vw);max-height:80vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.4);';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
    const title = document.createElement('h3');
    title.textContent = 'Configure Search Tabs';
    title.style.cssText = 'margin:0;font-size:1.1em;';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.innerHTML = '<i class="bi bi-x-lg"></i>';
    closeX.style.cssText = 'background:none;border:none;color:inherit;cursor:pointer;font-size:1em;';
    closeX.addEventListener('click', closeConfigureTabsModal);
    header.appendChild(closeX);
    panel.appendChild(header);

    const hint = document.createElement('p');
    hint.textContent = 'Drag the grip to reorder tabs, pick which one opens by default, rename tabs, or restrict a tab to only show while hidden-tags mode is on.';
    hint.style.cssText = 'font-size:0.85em;opacity:0.75;margin:0 0 10px;';
    panel.appendChild(hint);

    const list = document.createElement('div');
    configListEl = list;
    refreshConfigList();
    panel.appendChild(list);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;margin-top:14px;';
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.textContent = 'Done';
    doneBtn.style.cssText = 'padding:6px 16px;border-radius:4px;border:none;background:#3b82f6;color:#fff;cursor:pointer;';
    doneBtn.addEventListener('click', closeConfigureTabsModal);
    footer.appendChild(doneBtn);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    configModalEl = overlay;
}

if (configureTabBtn) {
    configureTabBtn.addEventListener('click', openConfigureTabsModal);
}