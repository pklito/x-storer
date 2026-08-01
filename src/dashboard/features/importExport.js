// Import a previously exported JSON file (see exportJSON — tags are always
// included there now). Two modes: 'append' upserts into the current
// collection (existing ids are updated, new ones added, nothing else is
// touched); 'replace' wipes the current collection first. Replace shows an
// extra native confirm() on top of the inline warning before it runs.

import { db } from '../../utils/db.js';
import { state } from '../state.js';
import { totalCount } from '../dom.js';

import { loadData } from './tweets.js';

let importFileInput = null;
let importModalEls = null; // built lazily on first use
let pendingImportTweets = null;

export function createImportButton() {
    if (!totalCount.parentElement || document.getElementById('import-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'import-btn';
    btn.className = 'icon-btn';
    btn.title = 'Import a previously exported JSON file';
    const icon = document.createElement('i');
    icon.className = 'bi bi-upload';
    btn.appendChild(icon);
    btn.appendChild(document.createTextNode(' Import'));
    btn.addEventListener('click', () => {
        if (!importFileInput) {
            importFileInput = document.createElement('input');
            importFileInput.type = 'file';
            importFileInput.accept = 'application/json,.json';
            importFileInput.style.display = 'none';
            importFileInput.addEventListener('change', handleImportFileSelected);
            document.body.appendChild(importFileInput);
        }
        importFileInput.value = ''; // so re-selecting the same file still fires 'change'
        importFileInput.click();
    });
    totalCount.parentElement.appendChild(btn);
}

async function handleImportFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    let data;
    try {
        data = JSON.parse(await file.text());
    } catch (err) {
        alert('Could not read that file as JSON: ' + err.message);
        return;
    }

    if (!Array.isArray(data)) {
        alert('Expected a JSON array of tweets (the format produced by "Export JSON").');
        return;
    }
    const valid = data.filter(t => t && typeof t === 'object' && t.id);
    if (valid.length === 0) {
        alert('No valid tweets found in that file (each entry needs at least an "id").');
        return;
    }

    pendingImportTweets = valid;
    openImportModal(valid.length, data.length - valid.length);
}

function openImportModal(validCount, skippedCount) {
    if (!importModalEls) importModalEls = buildImportModal();
    importModalEls.reset(validCount, skippedCount);
    importModalEls.overlay.classList.add('active');
}

function closeImportModal() {
    if (importModalEls) importModalEls.overlay.classList.remove('active');
    pendingImportTweets = null;
}

function buildImportModal() {
    const overlay = document.createElement('div');
    overlay.className = 'xb-modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeImportModal(); });

    const box = document.createElement('div');
    box.className = 'xb-modal-box w-360';
    overlay.appendChild(box);

    const title = document.createElement('div');
    title.textContent = 'Import Bookmarks';
    title.className = 'xb-modal-title';
    box.appendChild(title);

    const summary = document.createElement('div');
    summary.className = 'xb-modal-hint';
    box.appendChild(summary);

    let importMode = 'append';
    const modeRow = document.createElement('div');
    modeRow.className = 'xb-import-mode-row';

    function radioOption(value, labelText) {
        const label = document.createElement('label');
        label.className = 'xb-import-mode-label';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'import-mode';
        radio.value = value;
        radio.checked = value === 'append';
        radio.addEventListener('change', () => {
            importMode = value;
            warningEl.classList.toggle('visible', importMode === 'replace');
        });
        label.appendChild(radio);
        label.appendChild(document.createTextNode(labelText));
        return label;
    }
    modeRow.appendChild(radioOption('append', 'Append (add/update)'));
    modeRow.appendChild(radioOption('replace', 'Replace (wipe first)'));
    box.appendChild(modeRow);

    const warningEl = document.createElement('div');
    warningEl.textContent = '⚠ This will permanently delete your entire current bookmark collection before importing.';
    warningEl.className = 'xb-warning-box';
    box.appendChild(warningEl);

    const statusEl = document.createElement('div');
    statusEl.className = 'xb-import-status';
    box.appendChild(statusEl);

    const footer = document.createElement('div');
    footer.className = 'xb-modal-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'xb-btn-secondary';
    cancelBtn.addEventListener('click', closeImportModal);

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Import';
    confirmBtn.className = 'xb-btn-primary';
    confirmBtn.addEventListener('click', async () => {
        if (!pendingImportTweets) return;

        // Extra explicit warning specifically for replace, on top of the
        // inline banner, since it's destructive and irreversible.
        if (importMode === 'replace') {
            const ok = confirm(
                `This will permanently delete all ${state.allTweets.length} bookmark(s) currently in your collection ` +
                `and replace them with the ${pendingImportTweets.length} tweet(s) from this file. This cannot be undone. Continue?`
            );
            if (!ok) return;
        }

        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        statusEl.textContent = 'Importing…';

        try {
            const result = await runImport(pendingImportTweets, importMode);
            statusEl.textContent = `Done — ${result.added} added, ${result.updated} updated` +
                (importMode === 'replace' ? `, ${result.deleted} removed` : '') +
                (result.skipped > 0 ? `, ${result.skipped} skipped (previously deleted permanently)` : '') + '.';
            await loadData();
            setTimeout(closeImportModal, 1200);
        } catch (err) {
            console.error('Import failed:', err);
            statusEl.textContent = 'Import failed — see console for details.';
        } finally {
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
        }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    box.appendChild(footer);

    document.body.appendChild(overlay);

    return {
        overlay,
        reset: (validCount, skippedCount) => {
            summary.textContent = `Found ${validCount} tweet(s) in this file` +
                (skippedCount > 0 ? ` (${skippedCount} entr${skippedCount === 1 ? 'y' : 'ies'} skipped — missing an id).` : '.');
            statusEl.textContent = '';
            importMode = 'append';
            box.querySelector('input[value="append"]').checked = true;
            warningEl.classList.remove('visible');
        }
    };
}

// Writes imported tweets into the DB using db.js's real API.
//
// Two things to know about db.js's addTweet() that this works around:
// 1. For a tweet that already exists, addTweet() *keeps the old tags* and
//    ignores whatever tags are on the object you pass it (it's built for
//    the content script refreshing a tweet's content, not for importing
//    tag data). So for updates we call addTweet() first for the content,
//    then updateTweetTags() to force the tags to the imported value.
// 2. addTweet() checks the permanent-delete blacklist (deleted_tweets) and
//    silently no-ops (returns null) for a blacklisted id unless the
//    incoming tweet's `source` is 'manual_click'. That's respected here —
//    if you'd previously hit "Delete & Unbookmark" on a tweet, importing
//    it again won't quietly resurrect it, and gets reported as skipped.
//
// For 'replace' mode, the existing collection is cleared with
// deleteTweet(id, false) — a plain removal, NOT permanent=true. Permanent
// delete blacklists the id, which would immediately block the very
// tweets we're about to reimport (and any future auto-scan of them too).
async function runImport(tweets, mode) {
    let deleted = 0;
    if (mode === 'replace') {
        for (const existing of state.allTweets) {
            await db.deleteTweet(existing.id, false);
            deleted++;
        }
    }

    const existingIds = new Set(mode === 'replace' ? [] : state.allTweets.map(t => t.id));
    let added = 0, updated = 0, skipped = 0;

    for (const raw of tweets) {
        const tweet = { ...raw, tags: raw.tags || [] };
        const isUpdate = existingIds.has(tweet.id);

        const result = await db.addTweet(tweet);
        if (result === null) {
            skipped++; // previously deleted permanently — addTweet declined to resurrect it
            continue;
        }

        if (isUpdate) {
            // Force the tags to the imported value (addTweet kept the old ones above).
            await db.updateTweetTags(tweet.id, tweet.tags);
            updated++;
        } else {
            added++;
        }
    }

    return { added, updated, deleted, skipped };
}

// --- Export ---

export function exportTweets(tweets) {
    let content = "";
    tweets.forEach(tweet => {
        content += `---\nid: "${tweet.id}"\nauthor: "${tweet.authorName}"\nurl: "${tweet.url}"\ntags: [${(tweet.tags || []).join(', ')}]\n---\n\n${tweet.text}\n\n`;

        const mediaItems = (tweet.media && tweet.media.length)
            ? tweet.media
            : (tweet.mediaUrl ? [{ type: 'photo', url: tweet.mediaUrl }] : []);
        mediaItems.forEach((item, i) => {
            const label = item.type === 'video' ? `video ${i + 1} (thumbnail)`
                : item.type === 'gif' ? `gif ${i + 1} (thumbnail)`
                : `media ${i + 1}`;
            content += `![${label}](${item.url})\n\n`;
        });

        content += `___\n\n`;
    });

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = tweets.length === 1 ? `tweet-${tweets[0].id}.md` : `bookmarks-export.md`;
    a.click();
    URL.revokeObjectURL(url);
}

export function exportJSON(tweets) {
    // Guarantee `tags` is always present (even if empty) so a re-import
    // never has to guess — built-in tags (video/gif/text-only) are
    // intentionally NOT included since they're computed, not stored.
    const exportData = tweets.map(t => ({ ...t, tags: t.tags || [] }));
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bookmarks-export.json';
    a.click();
    URL.revokeObjectURL(url);
}
