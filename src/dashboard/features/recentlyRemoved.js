// The content script's "did they unbookmark this on X?" detection is a DOM
// heuristic, not a real signal — it has misfired before and wiped tweets
// from the local collection (see index.js's click-detection fix). The
// background script now stashes a tweet's full data, tags included, before
// deleting it in response to a REMOVE_TWEET message. This panel lists those
// stashes and lets you restore any of them with one click.

import { db } from '../../utils/db.js';
import { RECENTLY_REMOVED_KEY } from '../state.js';
import { totalCount } from '../dom.js';
import { loadData } from './tweets.js';

let recentlyRemovedBtn = null;
let recentlyRemovedModalEls = null; // built lazily on first use

export function createRecentlyRemovedButton() {
    if (!totalCount.parentElement || document.getElementById('recently-removed-btn')) return;
    if (!(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)) return; // needs the storage permission

    recentlyRemovedBtn = document.createElement('button');
    recentlyRemovedBtn.id = 'recently-removed-btn';
    recentlyRemovedBtn.className = 'icon-btn';
    recentlyRemovedBtn.title = 'Undo tweets removed by the unbookmark detection on X';
    const icon = document.createElement('i');
    icon.className = 'bi bi-arrow-counterclockwise';
    recentlyRemovedBtn.appendChild(icon);
    recentlyRemovedBtn.appendChild(document.createTextNode(' Recently Removed'));
    recentlyRemovedBtn.addEventListener('click', openRecentlyRemovedModal);
    totalCount.parentElement.appendChild(recentlyRemovedBtn);
}

async function getRecentlyRemoved() {
    const result = await chrome.storage.local.get(RECENTLY_REMOVED_KEY);
    return result[RECENTLY_REMOVED_KEY] || [];
}

async function setRecentlyRemoved(list) {
    await chrome.storage.local.set({ [RECENTLY_REMOVED_KEY]: list });
}

async function openRecentlyRemovedModal() {
    if (!recentlyRemovedModalEls) recentlyRemovedModalEls = buildRecentlyRemovedModal();
    await recentlyRemovedModalEls.refresh();
    recentlyRemovedModalEls.overlay.classList.add('active');
}

function closeRecentlyRemovedModal() {
    if (recentlyRemovedModalEls) recentlyRemovedModalEls.overlay.classList.remove('active');
}

function buildRecentlyRemovedModal() {
    const overlay = document.createElement('div');
    overlay.className = 'xb-modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeRecentlyRemovedModal(); });

    const box = document.createElement('div');
    box.className = 'xb-modal-box w-420';
    overlay.appendChild(box);

    const title = document.createElement('div');
    title.textContent = 'Recently Removed';
    title.className = 'xb-modal-title';
    box.appendChild(title);

    const hint = document.createElement('div');
    hint.textContent = 'Tweets removed via the unbookmark detection on X, most recent first. Undo restores the tweet with its original tags.';
    hint.className = 'xb-modal-hint';
    box.appendChild(hint);

    const list = document.createElement('div');
    list.className = 'xb-rr-list';
    box.appendChild(list);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'xb-btn-secondary xb-align-self-end';
    closeBtn.addEventListener('click', closeRecentlyRemovedModal);
    box.appendChild(closeBtn);

    document.body.appendChild(overlay);

    async function refresh() {
        const entries = await getRecentlyRemoved();
        list.replaceChildren();

        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'Nothing removed recently.';
            empty.className = 'xb-rr-empty';
            list.appendChild(empty);
            return;
        }

        entries.forEach((entry, idx) => {
            const row = document.createElement('div');
            row.className = 'xb-rr-row';

            const info = document.createElement('div');
            info.className = 'xb-rr-info';
            const authorLine = document.createElement('div');
            authorLine.className = 'xb-rr-author';
            authorLine.textContent = entry.tweet.authorName || entry.tweet.authorHandle || 'Unknown';
            const textLine = document.createElement('div');
            textLine.className = 'xb-rr-text';
            textLine.textContent = (entry.tweet.text || '').slice(0, 80);
            const timeLine = document.createElement('div');
            timeLine.className = 'xb-rr-time';
            timeLine.textContent = new Date(entry.removedAt).toLocaleString();
            info.appendChild(authorLine);
            info.appendChild(textLine);
            info.appendChild(timeLine);
            row.appendChild(info);

            const undoBtn = document.createElement('button');
            undoBtn.textContent = 'Undo';
            undoBtn.className = 'xb-rr-undo-btn';
            undoBtn.addEventListener('click', async () => {
                undoBtn.disabled = true;
                try {
                    await db.addTweet(entry.tweet);
                    const remaining = (await getRecentlyRemoved()).filter((_, i) => i !== idx);
                    await setRecentlyRemoved(remaining);
                    await loadData();
                    await refresh();
                } catch (err) {
                    console.error('Undo failed:', err);
                    undoBtn.disabled = false;
                }
            });
            row.appendChild(undoBtn);

            list.appendChild(row);
        });
    }

    return { overlay, refresh };
}
