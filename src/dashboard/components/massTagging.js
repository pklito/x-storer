// Pick a set of tags once in a small selection window, then click tweets
// (anywhere on the card) to toggle that whole tag set on/off for each one,
// without opening the per-tweet tag editor each time.

import { state } from './state.js';
import { massTagBtn } from './dom.js';
import { getAllTagNames } from './tweets.js';
import { renderTagsSidebar } from './tagsSidebar.js';

let massTagStatusBar = null;
let massTagSelectModal = null; // built lazily on first open

// Builds (once) and shows the tag-selection window used to choose which
// tags mass tagging mode will apply.
export function openMassTagSelectModal() {
    if (!massTagSelectModal) {
        massTagSelectModal = buildMassTagSelectModal();
        document.body.appendChild(massTagSelectModal.overlay);
    }
    massTagSelectModal.refresh();
    massTagSelectModal.overlay.classList.add('active');
}

export function closeMassTagSelectModal() {
    if (massTagSelectModal) massTagSelectModal.overlay.classList.remove('active');
}

function buildMassTagSelectModal() {
    const overlay = document.createElement('div');
    overlay.className = 'xb-modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMassTagSelectModal(); });

    const box = document.createElement('div');
    box.className = 'xb-modal-box w-340';
    overlay.appendChild(box);

    const title = document.createElement('div');
    title.textContent = 'Mass Tagging — choose tags';
    title.className = 'xb-modal-title';
    box.appendChild(title);

    const hint = document.createElement('div');
    hint.textContent = 'Select existing tags and/or add new ones, then start tagging. Click any tweet to apply all of them; click it again to remove them.';
    hint.className = 'xb-modal-hint';
    box.appendChild(hint);

    const list = document.createElement('div');
    list.className = 'xb-mass-tag-chip-list';
    box.appendChild(list);

    const newTagRow = document.createElement('div');
    newTagRow.className = 'xb-mass-tag-new-row';
    const newTagInput = document.createElement('input');
    newTagInput.type = 'text';
    newTagInput.placeholder = 'Add a new tag…';
    newTagInput.className = 'xb-input xb-flex-1';
    const addTagBtnEl = document.createElement('button');
    addTagBtnEl.textContent = 'Add';
    addTagBtnEl.className = 'xb-btn-secondary';
    newTagRow.appendChild(newTagInput);
    newTagRow.appendChild(addTagBtnEl);
    box.appendChild(newTagRow);

    const pendingNewTags = new Set(); // typed-in tags not yet in getAllTagNames()
    const chosen = new Set(); // currently checked tag names

    function chip(tag) {
        const el = document.createElement('div');
        el.textContent = '#' + tag;
        el.dataset.tag = tag;
        el.className = 'xb-tag-select-chip' + (chosen.has(tag) ? ' chosen' : '');
        el.addEventListener('click', () => {
            if (chosen.has(tag)) chosen.delete(tag); else chosen.add(tag);
            el.classList.toggle('chosen', chosen.has(tag));
        });
        return el;
    }

    function refresh() {
        list.replaceChildren();
        const names = new Set([...getAllTagNames(), ...pendingNewTags]);
        Array.from(names).sort().forEach(tag => list.appendChild(chip(tag)));
    }

    function addNewTag() {
        const val = newTagInput.value.trim().replace(/^#/, '');
        if (!val) return;
        pendingNewTags.add(val);
        chosen.add(val);
        newTagInput.value = '';
        refresh();
    }
    addTagBtnEl.addEventListener('click', addNewTag);
    newTagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addNewTag(); }
    });

    const footer = document.createElement('div');
    footer.className = 'xb-modal-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'xb-btn-secondary';
    cancelBtn.addEventListener('click', closeMassTagSelectModal);
    const startBtn = document.createElement('button');
    startBtn.textContent = 'Start Tagging';
    startBtn.className = 'xb-btn-primary';
    startBtn.addEventListener('click', () => {
        if (chosen.size === 0) return;
        startMassTagMode(Array.from(chosen));
        closeMassTagSelectModal();
    });
    footer.appendChild(cancelBtn);
    footer.appendChild(startBtn);
    box.appendChild(footer);

    return { overlay, refresh: () => { chosen.clear(); pendingNewTags.clear(); refresh(); } };
}

function createMassTagStatusBar() {
    if (massTagStatusBar) return;
    massTagStatusBar = document.createElement('div');
    massTagStatusBar.className = 'xb-status-bar';

    const label = document.createElement('span');
    label.id = 'mass-tag-status-label';
    massTagStatusBar.appendChild(label);

    const stopBtn = document.createElement('button');
    stopBtn.textContent = 'Stop Mass Tagging';
    stopBtn.className = 'xb-status-bar-stop-btn';
    stopBtn.addEventListener('click', endMassTagMode);
    massTagStatusBar.appendChild(stopBtn);

    document.body.appendChild(massTagStatusBar);
}

export function startMassTagMode(tags) {
    state.massTagSelectedTags = tags;
    state.massTagModeActive = true;
    createMassTagStatusBar();
    document.getElementById('mass-tag-status-label').textContent =
        `Mass Tagging: ${tags.map(t => '#' + t).join(' ')} — click tweets to toggle`;
    massTagStatusBar.classList.add('active');
    if (massTagBtn) massTagBtn.classList.add('active');
    document.body.classList.add('xb-mass-tag-padding'); // room for the fixed status bar
}

export function endMassTagMode() {
    state.massTagModeActive = false;
    state.massTagSelectedTags = [];
    if (massTagStatusBar) massTagStatusBar.classList.remove('active');
    if (massTagBtn) massTagBtn.classList.remove('active');
    document.body.classList.remove('xb-mass-tag-padding');
    renderTagsSidebar(); // tag counts may have drifted while blitzing through tweets
}
