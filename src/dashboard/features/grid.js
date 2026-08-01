import { db } from '../../utils/db.js';
import { state, RENDER_BATCH_SIZE } from '../state.js';
import { tweetsGrid, totalCount } from '../dom.js';

import { openLightbox } from './lightbox.js';
import { openTagModal } from './tagModal.js';
import { exportTweets } from './importExport.js';
import { resolveLocalMediaFile, resolveLocalVideoFile } from './mediaFolder.js';
import { updateUI, getBuiltInTagsForTweet } from './tweets.js';

export function renderGrid(tweets) {
    state.renderToken++; // invalidate any batch loop still running from a previous render
    const myToken = state.renderToken;

    // Object URLs from the previous render's local media are no longer referenced
    state.activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
    state.activeObjectUrls = [];

    tweetsGrid.replaceChildren();
    state.filteredTweetsCache = tweets;
    state.renderedCount = 0;

    if (tweets.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'xb-empty-state';
        const icon = document.createElement('i');
        icon.className = 'bi bi-inbox';
        empty.appendChild(icon);
        empty.appendChild(document.createElement('br'));
        empty.appendChild(document.createTextNode('No bookmarks found.'));
        tweetsGrid.appendChild(empty);
        updateRenderProgressUI();
        return;
    }

    const w = window.innerWidth;
    const colCount = w <= 700 ? 1 : w <= 1100 ? 2 : w <= 1500 ? 3 : w <= 1900 ? 4 : 5;
    state.masonryColumns = Array.from({ length: colCount }, () => {
        const col = document.createElement('div');
        col.className = 'masonry-column';
        tweetsGrid.appendChild(col);
        return col;
    });

    renderNextBatch(myToken);
}

// Renders one batch, then schedules the next batch on a fresh animation frame
// instead of doing all 5000 in one go. This keeps the tab responsive (input,
// scrolling, painting all still happen between batches) without skipping any
// tweets the way the scroll-based version did.
function renderNextBatch(token) {
    // A newer renderGrid() call superseded this one (e.g. user kept typing in
    // search) — stop working on stale data.
    if (token !== state.renderToken) return;

    const batch = state.filteredTweetsCache.slice(state.renderedCount, state.renderedCount + RENDER_BATCH_SIZE);

    batch.forEach((tweet) => {
        const card = createTweetCard(tweet);

        // Balanced masonry: drop into whichever column is currently shortest
        let shortest = 0;
        for (let c = 1; c < state.masonryColumns.length; c++) {
            if (state.masonryColumns[c].offsetHeight < state.masonryColumns[shortest].offsetHeight) shortest = c;
        }
        state.masonryColumns[shortest].appendChild(card);
    });

    state.renderedCount += batch.length;
    updateRenderProgressUI();

    if (state.renderedCount < state.filteredTweetsCache.length) {
        requestAnimationFrame(() => renderNextBatch(token));
    }
}

// Query how much of the current filtered set has been rendered so far.
// Useful for a progress indicator ("3400 of 5200 tweets done").
export function getRenderProgress() {
    return { rendered: state.renderedCount, total: state.filteredTweetsCache.length };
}

export function updateRenderProgressUI() {
    const { rendered, total } = getRenderProgress();
    totalCount.textContent = rendered < total
        ? `${rendered} of ${total} items…`
        : `${total} items`;
}

export async function deleteTweet(id) {
    if (!confirm('Remove this bookmark permanently from Local Collection?')) return;
    try {
        await db.deleteTweet(id, true); // true = Permanent (Blacklist)
        state.allTweets = state.allTweets.filter(t => t.id !== id);
        updateUI();
    } catch (err) {
        console.error(err);
    }
}

// Renders a tweet's tag badges (stored tags + dashed built-in tags) into
// an existing container. Shared by initial card creation and the mass-tag
// live update below, so both stay in sync.
function renderTweetTagBadges(tagsDiv, tweet) {
    tagsDiv.replaceChildren();
    (tweet.tags || []).forEach(tag => {
        const tagBadge = document.createElement('span');
        tagBadge.className = 'tweet-tag-badge';
        tagBadge.textContent = '#' + tag;
        tagsDiv.appendChild(tagBadge);
    });
    getBuiltInTagsForTweet(tweet).forEach(tag => {
        const tagBadge = document.createElement('span');
        tagBadge.className = 'tweet-tag-badge tweet-tag-badge-builtin';
        tagBadge.textContent = '#' + tag;
        tagsDiv.appendChild(tagBadge);
    });
}

function createTweetCard(tweet) {
    const card = document.createElement('article');
    card.className = 'tweet-card tweet-card-perf animate-in';
    card.addEventListener('animationend', () => card.classList.remove('animate-in'), { once: true });

    // Shown when at least one of this tweet's media items successfully
    // loaded from the local media folder instead of the network.
    const localMediaBadge = document.createElement('div');
    localMediaBadge.className = 'xb-local-media-badge';
    localMediaBadge.title = 'Loaded from your local media folder';
    const localMediaBadgeIcon = document.createElement('i');
    localMediaBadgeIcon.className = 'bi bi-hdd-fill';
    localMediaBadge.appendChild(localMediaBadgeIcon);
    card.appendChild(localMediaBadge);
    const showLocalMediaBadge = () => { localMediaBadge.classList.add('visible'); };

    // Header
    const header = document.createElement('div');
    header.className = 'tweet-header';

    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.src = tweet.authorAvatar || '';
    avatar.referrerPolicy = 'no-referrer';
    avatar.draggable = false;
    avatar.addEventListener('error', function () { this.style.backgroundColor = '#333'; });
    header.appendChild(avatar);

    const userInfo = document.createElement('div');
    userInfo.className = 'user-info';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'display-name';
    nameSpan.textContent = tweet.authorName;
    userInfo.appendChild(nameSpan);

    const handleSpan = document.createElement('span');
    handleSpan.className = 'handle';
    handleSpan.textContent = tweet.authorHandle;
    userInfo.appendChild(handleSpan);

    header.appendChild(userInfo);
    card.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'tweet-content';
    appendLinkifiedText(content, tweet.text);
    card.appendChild(content);

    // Media gallery (photos, videos, gifs). Falls back to the legacy
    // single-mediaUrl shape for tweets saved before multi-media support.
    const mediaItems = (tweet.media && tweet.media.length)
        ? tweet.media
        : (tweet.mediaUrl ? [{ type: 'photo', url: tweet.mediaUrl }] : []);

    if (mediaItems.length) {
        const mediaDiv = document.createElement('div');
        mediaDiv.className = 'tweet-media';
        if (mediaItems.length > 1) {
            mediaDiv.classList.add('tweet-media-grid');
        }

        mediaItems.forEach(item => {
            const itemWrap = document.createElement('div');
            itemWrap.className = 'tweet-media-item';

            const img = document.createElement('img');
            img.src = item.url; // remote URL (or poster, for video/gif) as the immediate default
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.draggable = false;
            img.addEventListener('error', function () { this.parentElement.style.display = 'none'; });
            itemWrap.appendChild(img);

            if (item.type === 'video' || item.type === 'gif') {
                // Overlay badge sitting ON TOP of the thumbnail.
                const badge = document.createElement('div');
                badge.className = 'xb-media-type-badge';
                const icon = document.createElement('i');
                icon.className = item.type === 'gif' ? 'bi bi-filetype-gif' : 'bi bi-play-circle-fill';
                badge.appendChild(icon);
                itemWrap.appendChild(badge);

                // We can't recover the real video stream from the DOM
                // (see parseTweet.js), so by default a video/gif item is
                // just a poster — make it clickable so it's not a dead
                // end, opening the original tweet to actually watch it.
                itemWrap.classList.add('clickable-watch');
                itemWrap.title = 'Click to watch on X';
                const openOnX = () => window.open(tweet.url, '_blank', 'noopener,noreferrer');
                itemWrap.addEventListener('click', openOnX);

                // Best-effort: if a matching local video file exists,
                // replace the static poster with an actual playable
                // <video>, so it becomes watchable in place.
                if (state.mediaRootHandle) {
                    resolveLocalVideoFile(tweet, item.url).then(videoFile => {
                        if (!videoFile) return; // no local match — keep the click-to-watch poster
                        const videoEl = document.createElement('video');
                        videoEl.controls = true;
                        videoEl.preload = 'metadata';
                        videoEl.poster = item.url;
                        videoEl.draggable = false;
                        const objectUrl = URL.createObjectURL(videoFile);
                        state.activeObjectUrls.push(objectUrl);
                        videoEl.src = objectUrl;

                        itemWrap.replaceChild(videoEl, img);
                        badge.classList.add('hidden'); // it's genuinely playable now, badge no longer needed
                        itemWrap.classList.remove('clickable-watch');
                        itemWrap.classList.add('playable');
                        itemWrap.removeEventListener('click', openOnX);
                        showLocalMediaBadge();
                    });
                }
            } else {
                // Photo item: click to enlarge in a lightbox.
                itemWrap.classList.add('clickable-zoom');
                itemWrap.addEventListener('click', () => openLightbox(img.src, tweet.text || ''));

                if (state.mediaRootHandle) {
                    // Swap in the local copy once it resolves — openLightbox
                    // reads img.src live at click time, so it'll pick up
                    // this swap automatically if it happens before the click.
                    resolveLocalMediaFile(tweet, item.url).then(file => {
                        if (!file) return; // not found locally, keep the remote URL
                        const objectUrl = URL.createObjectURL(file);
                        state.activeObjectUrls.push(objectUrl);
                        img.src = objectUrl;
                        img.draggable = false;
                        showLocalMediaBadge();
                    });
                }
            }

            mediaDiv.appendChild(itemWrap);
        });

        card.appendChild(mediaDiv);
    }

    // Meta
    const meta = document.createElement('div');
    meta.className = 'tweet-meta';

    const dateSpan = document.createElement('span');
    dateSpan.textContent = new Date(tweet.timestamp).toLocaleDateString();
    meta.appendChild(dateSpan);

    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'tweet-tags';
    renderTweetTagBadges(tagsDiv, tweet);
    meta.appendChild(tagsDiv);
    card.appendChild(meta);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const mkBtn = (icon, title, cb) => {
        const btn = document.createElement('button');
        btn.className = 'icon-btn';
        btn.title = title;
        const i = document.createElement('i');
        i.className = icon;
        btn.appendChild(i);
        btn.addEventListener('click', cb);
        return btn;
    };

    const editBtn = mkBtn('bi bi-tag', 'Edit Tags', () => openTagModal(tweet.id));
    editBtn.classList.add('edit-tags-btn');
    actions.appendChild(editBtn);

    const exportBtn = mkBtn('bi bi-download', 'Export Markdown', () => exportTweets([tweet]));
    actions.appendChild(exportBtn);

    const linkBtn = document.createElement('a');
    linkBtn.className = 'icon-btn';
    linkBtn.href = tweet.url;
    linkBtn.target = '_blank';
    linkBtn.rel = 'noopener noreferrer';
    linkBtn.title = 'Open on X';
    const linkIcon = document.createElement('i');
    linkIcon.className = 'bi bi-box-arrow-up-right';
    linkBtn.appendChild(linkIcon);
    actions.appendChild(linkBtn);

    const spacer = document.createElement('div');
    spacer.className = 'xb-flex-1';
    actions.appendChild(spacer);

    const deleteBtn = mkBtn('bi bi-trash3', 'Delete & Unbookmark', () => deleteTweet(tweet.id));
    deleteBtn.classList.add('danger', 'delete-btn');
    actions.appendChild(deleteBtn);

    card.appendChild(actions);

    // Mass tagging mode: when active, a click anywhere on the card
    // toggles the whole selected tag set on this tweet instead of
    // triggering the normal buttons/links underneath. Capture phase so
    // it runs before — and can suppress — those other click handlers.
    card.addEventListener('click', async (e) => {
        if (!state.massTagModeActive || state.massTagSelectedTags.length === 0) return;

        // Don't mass-tag if a button, link, input, etc. was clicked.
        if (e.target.closest('button, a, input, textarea, select, .delete-btn')) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const currentTags = new Set(tweet.tags || []);
        const hasAll = state.massTagSelectedTags.every(t => currentTags.has(t));
        if (hasAll) {
            state.massTagSelectedTags.forEach(t => currentTags.delete(t));
        } else {
            state.massTagSelectedTags.forEach(t => currentTags.add(t));
        }
        const newTags = Array.from(currentTags);
        tweet.tags = newTags; // optimistic local update

        // Refresh just this card's tag badges — avoid a full grid
        // re-render so scroll position holds while blitzing through tweets.
        renderTweetTagBadges(tagsDiv, tweet);

        // Brief flash so it's obvious the click registered: green for
        // "tagged", red for "untagged".
        card.classList.add(hasAll ? 'xb-flash-untagged' : 'xb-flash-tagged');
        setTimeout(() => { card.classList.remove('xb-flash-tagged', 'xb-flash-untagged'); }, 250);

        try {
            await db.updateTweetTags(tweet.id, newTags);
        } catch (err) {
            console.error('Mass tag update failed:', err);
        }
    }, true); // capture phase

    return card;
}

function appendLinkifiedText(element, text) {
    if (!text) return;
    const regex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            element.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        const a = document.createElement('a');
        a.href = match[0];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = match[0];
        a.className = 'linkified-url';
        element.appendChild(a);

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        element.appendChild(document.createTextNode(text.substring(lastIndex)));
    }
}