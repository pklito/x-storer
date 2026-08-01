import { state } from '../state.js';
import { tagAllBtn } from '../dom.js';
//, massTagSelectModal as overlay,  massTagChipList as chipList,  massTagNewInput as newTagInput,
//     massTagAddBtn as addTagBtnEl,  massTagCancelBtn as cancelBtn, massTagStartBtn as startBtn,  massTagStatusBar as statusBar,
//     massTagStatusLabel as statusLabel,  massTagStopBtn as stopBtn,
// } from '../dom.js';

const overlay = document.getElementById('tag-all-select-modal');
const chipList = document.getElementById('tag-all-chip-list');
const newTagInput = document.getElementById('tag-all-new-input');
const addTagBtnEl = document.getElementById('tag-all-add-btn');
const cancelBtn = document.getElementById('tag-all-cancel-btn');
const startBtn = document.getElementById('tag-all-start-btn');

import { getAllTagNames, updateUI, getTagsByGroup } from './tweets.js';
import { renderTagsSidebar } from './tagsSidebar.js';

const pendingNewTags = new Set(); // typed-in tags not yet in getAllTagNames()
const chosen = new Set(); // currently checked tag names
const excludeChosen = new Set(); // currently checked tag names


export function setupEventHandlersTagAll() {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMassTagSelectModal(); });
    cancelBtn.addEventListener('click', closeMassTagSelectModal);

    addTagBtnEl.addEventListener('click', addNewTag);
    newTagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addNewTag(); }
    });

    startBtn.addEventListener('click', () => {
        if (chosen.size === 0) return;
        startMassTagMode(Array.from(chosen));
        closeMassTagSelectModal();
    });

    stopBtn.addEventListener('click', endMassTagMode);
}

export function tagAllBtnAction() {
    openTagAllModal();
}

export function openTagAllModal() {
    updateUI(); 
    chosen.clear();
    excludeChosen.clear();
    pendingNewTags.clear();
    refreshChipList();
    overlay.classList.add('active');
}

export function closeMassTagSelectModal() {
    chosen.clear();
    excludeChosen.clear();
    pendingNewTags.clear();
    overlay.classList.remove('active');
}

function chip(tag, tinted = false) {
    const el = document.createElement('div');
    el.textContent = '#' + tag;
    el.dataset.tag = tag;
    el.className = 'xb-tag-select-chip' + (chosen.has(tag) ? ' chosen' : '') + (tinted ? ' tinted' : '');
    el.addEventListener('click', () => {
        if (chosen.has(tag)) chosen.delete(tag); else chosen.add(tag);
        el.classList.toggle('chosen', chosen.has(tag));
    });
    return el;
}

let orderByGroups = true;
function refreshChipList() {
    chipList.replaceChildren();
        let tinted = false;
        if(orderByGroups) {
            getTagsByGroup(false).values().forEach(groupTags => {
                tinted = !tinted; 
                groupTags.forEach(tag => {
                    chipList.appendChild(chip(tag, tinted));
                });
            });
            Array.from(pendingNewTags).sort().forEach(tag => chipList.appendChild(chip(tag, tinted)));
        } else {
            //old code
            const names = new Set([...getAllTagNames(), ...pendingNewTags]);
            Array.from(names).sort().forEach(tag => chipList.appendChild(chip(tag)));
        }
}

function addNewTag() {
    const val = newTagInput.value.trim().replace(/^#/, '');
    if (!val) return;
    pendingNewTags.add(val);
    chosen.add(val);
    newTagInput.value = '';
    refreshChipList();
}

export function startMassTagMode(tags) {
    state.massTagSelectedTags = tags;
    state.massTagModeActive = true;
    statusLabel.textContent =
        `Mass Tagging: ${tags.map(t => '#' + t).join(' ')} — click tweets to toggle`;
    statusBar.classList.add('active');
    if (massTagBtn) massTagBtn.classList.add('active');
    document.body.classList.add('xb-mass-tag-padding'); // room for the fixed status bar
}

export function endMassTagMode() {
    state.massTagModeActive = false;
    state.massTagSelectedTags = [];
    statusBar.classList.remove('active');
    if (massTagBtn) massTagBtn.classList.remove('active');
    document.body.classList.remove('xb-mass-tag-padding');
    renderTagsSidebar(); // tag counts may have drifted while blitzing through tweets
}