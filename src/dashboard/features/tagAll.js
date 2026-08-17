import { state } from '../state.js';
import { tagAllBtn } from '../dom.js';
// ASSUMPTION: matching the import style of state.js/dom.js — adjust the
// path/export name if db lives elsewhere or isn't a named export "db".
import { db } from '../../utils/db.js';

const overlay = document.getElementById('tag-all-select-modal');
const chipList = document.getElementById('tag-all-chip-list');
const newTagInput = document.getElementById('tag-all-new-input');
const addTagBtnEl = document.getElementById('tag-all-add-btn');
const cancelBtn = document.getElementById('tag-all-cancel-btn');
const startBtn = document.getElementById('tag-all-start-btn');

import { getAllTagNames, updateUI, getTagsByGroup } from './tweets.js';
import { renderTagsSidebar } from './tagsSidebar.js';

import { refreshTweetBadges } from './grid.js';

const pendingNewTags = new Set(); // typed-in tags not yet in getAllTagNames()
const chosen = new Set(); // tags to ADD to every filtered tweet
const excludeChosen = new Set(); // tags to REMOVE from every filtered tweet


export function setupEventHandlersTagAll() {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMassTagSelectModal(); });
    cancelBtn.addEventListener('click', closeMassTagSelectModal);

    addTagBtnEl.addEventListener('click', addNewTag);
    newTagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addNewTag(); }
    });

    tagAllBtn.addEventListener('click', tagAllBtnAction);
    startBtn.addEventListener('click', async () => {
        if (chosen.size === 0 && excludeChosen.size === 0) return;
        const originalLabel = startBtn.textContent;
        startBtn.disabled = true;
        startBtn.textContent = 'Saving…';
        try {
            await applyTagsToAll();
        } finally {
            startBtn.disabled = false;
            startBtn.textContent = originalLabel;
        }
        closeMassTagSelectModal();
    });
}

export function tagAllBtnAction() {
    openTagAllModal();
}

export function openTagAllModal() {
    chosen.clear();
    excludeChosen.clear();
    pendingNewTags.clear();
    refreshChipList();
    refreshStartBtnLabel();
    overlay.classList.add('active');
}

export function closeMassTagSelectModal() {
    chosen.clear();
    excludeChosen.clear();
    pendingNewTags.clear();
    overlay.classList.remove('active');
}

// Plain click toggles the tag into `chosen` (add). Shift-click toggles it
// into `excludeChosen` (remove) instead. A tag can only be in one of the
// two sets at a time — picking one clears it from the other.
function chip(tag, tinted = false) {
    const el = document.createElement('div');
    el.textContent = '#' + tag;
    el.dataset.tag = tag;
    el.className = chipClass(tag, tinted);
    el.addEventListener('click', (e) => {
        if (e.shiftKey) {
            if (excludeChosen.has(tag)) {
                excludeChosen.delete(tag);
            } else {
                excludeChosen.add(tag);
                chosen.delete(tag);
            }
        } else {
            if (chosen.has(tag)) {
                chosen.delete(tag);
            } else {
                chosen.add(tag);
                excludeChosen.delete(tag);
            }
        }
        el.className = chipClass(tag, tinted);
    });
    return el;
}

function chipClass(tag, tinted) {
    let cls = 'xb-tag-select-chip';
    if (chosen.has(tag)) cls += ' chosen';
    else if (excludeChosen.has(tag)) cls += ' excluded';
    if (tinted) cls += ' tinted';
    return cls;
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

function refreshStartBtnLabel() {
    const count = state.currentShownTweets.length;
    startBtn.textContent = `Tag (${count}) tweets`;
}

function addNewTag() {
    const val = newTagInput.value.trim().replace(/^#/, '');
    if (!val) return;
    pendingNewTags.add(val);
    chosen.add(val);
    excludeChosen.delete(val);
    newTagInput.value = '';
    refreshChipList();
}

async function applyTagsToAll() {
    const tweets = state.currentShownTweets;
    const addTags = Array.from(chosen);
    const removeTags = Array.from(excludeChosen);

    const results = await Promise.allSettled(tweets.map(async tweet => {
        const nextTags = Array.from(new Set(tweet.tags));
        addTags.forEach(tag => { if (!nextTags.includes(tag)) nextTags.push(tag); });
        const filtered = nextTags.filter(tag => !removeTags.includes(tag));

        await db.updateTweetTags(tweet.id, filtered);
        tweet.tags = filtered;
        refreshTweetBadges(null, tweet);
    }));

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) {
        console.error(`Failed to save tags for ${failed.length} of ${tweets.length} tweet(s):`, failed.map(f => f.reason));
    }

    renderTagsSidebar();
}