// Lets you add tweets yourself to the DB

import { db } from '../../utils/db.js';
import { fakeTweetBtn } from '../dom.js';
import { loadData } from './tweets.js';

let fakeTweetModalEls = null; // built lazily on first use

export function createFakeTweetButton() {
    fakeTweetBtn.addEventListener('click', openFakeTweetModal);
}

function openFakeTweetModal() {
    if (!fakeTweetModalEls) fakeTweetModalEls = buildFakeTweetModal();
    fakeTweetModalEls.reset();
    fakeTweetModalEls.overlay.classList.add('active');
}

function closeFakeTweetModal() {
    if (fakeTweetModalEls) fakeTweetModalEls.overlay.classList.remove('active');
}

function buildFakeTweetModal() {
    const overlay = document.createElement('div');
    overlay.className = 'xb-modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFakeTweetModal(); });

    const box = document.createElement('div');
    box.className = 'xb-modal-box w-360';
    overlay.appendChild(box);

    const title = document.createElement('div');
    title.textContent = 'Create Fake Tweet';
    title.className = 'xb-modal-title';
    box.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'xb-modal-hint';
    hint.textContent = 'Stores an image (uploaded or linked) plus a note, tagged and searchable like any other bookmark.';
    box.appendChild(hint);

    // Author name (purely cosmetic — shows in the card header)
    const nameLabel = document.createElement('label');
    nameLabel.className = 'form-label';
    nameLabel.textContent = 'Label (optional)';
    box.appendChild(nameLabel);
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'text-input';
    nameInput.placeholder = 'Local Upload';
    nameInput.autocomplete = 'off';
    box.appendChild(nameInput);

    // Text / caption
    const textLabel = document.createElement('label');
    textLabel.className = 'form-label top-margin';
    textLabel.textContent = 'Text';
    box.appendChild(textLabel);
    const textArea = document.createElement('textarea');
    textArea.className = 'text-input';
    textArea.rows = 3;
    textArea.placeholder = 'A note to go with the image…';
    box.appendChild(textArea);

    // Image: upload a file...
    const fileLabel = document.createElement('label');
    fileLabel.className = 'form-label top-margin';
    fileLabel.textContent = 'Image file';
    box.appendChild(fileLabel);
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    box.appendChild(fileInput);

    // ...or paste a link instead — image, YouTube, or Reddit post
    const urlLabel = document.createElement('label');
    urlLabel.className = 'form-label top-margin';
    urlLabel.textContent = 'or paste a link (image / YouTube / Reddit post)';
    box.appendChild(urlLabel);
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'text-input';
    urlInput.placeholder = 'https://…';
    urlInput.autocomplete = 'off';
    box.appendChild(urlInput);

    // Selecting a file clears the URL field and vice versa, so there's
    // never ambiguity about which one wins at submit time.
    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) urlInput.value = '';
    });
    urlInput.addEventListener('input', () => {
        if (urlInput.value.trim()) fileInput.value = '';
    });

    const statusEl = document.createElement('div');
    statusEl.className = 'xb-import-status';
    box.appendChild(statusEl);

    const footer = document.createElement('div');
    footer.className = 'xb-modal-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'xb-btn-secondary';
    cancelBtn.addEventListener('click', closeFakeTweetModal);

    const createBtn = document.createElement('button');
    createBtn.textContent = 'Create';
    createBtn.className = 'xb-btn-primary';
    createBtn.addEventListener('click', async () => {
        const text = textArea.value.trim();
        const file = fileInput.files && fileInput.files[0];
        const pastedUrl = urlInput.value.trim();

        if (!text && !file && !pastedUrl) {
            statusEl.textContent = 'Add some text and/or an image first.';
            return;
        }

        createBtn.disabled = true;
        cancelBtn.disabled = true;
        statusEl.textContent = 'Creating…';

        try {
            let media = [];
            let tweetUrl = '';

            if (file) {
                const dataUrl = await fileToDataURL(file);
                media = [{ type: 'photo', url: dataUrl }];
            } else if (pastedUrl) {
                statusEl.textContent = 'Resolving link…';
                const resolved = await resolveUrlToMedia(pastedUrl);
                media = [{ type: resolved.type, url: resolved.posterUrl }];
                tweetUrl = resolved.linkUrl;
                statusEl.textContent = 'Creating…';
            }

            const tweet = {
                id: `local-${crypto.randomUUID()}`,
                authorName: nameInput.value.trim() || 'Local Upload',
                authorHandle: '@local',
                authorAvatar: '',
                text,
                url: tweetUrl, // real link when resolved from YouTube/Reddit, '' otherwise — see grid.js's "Open on X" button
                timestamp: new Date().toISOString(),
                media,
                tags: [],
                source: 'manual_local',
            };

            await db.addTweet(tweet);
            await loadData();
            statusEl.textContent = 'Created.';
            setTimeout(closeFakeTweetModal, 800);
        } catch (err) {
            console.error('Failed to create fake tweet:', err);
            statusEl.textContent = err.message || 'Something went wrong — see console for details.';
        } finally {
            createBtn.disabled = false;
            cancelBtn.disabled = false;
        }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(createBtn);
    box.appendChild(footer);

    document.body.appendChild(overlay);

    return {
        overlay,
        reset: () => {
            nameInput.value = '';
            textArea.value = '';
            fileInput.value = '';
            urlInput.value = '';
            statusEl.textContent = '';
        }
    };
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

// Figures out what kind of link was pasted and returns
// { type: 'photo' | 'video', posterUrl, linkUrl } — posterUrl is what goes
// in media[].url (an actual image), linkUrl is what tweet.url gets set to
// (empty for a plain direct image link, since there's no separate "page"
// to open; the original link for YouTube/Reddit, so "Open on X" makes sense).
async function resolveUrlToMedia(rawUrl) {
    const youTubeId = extractYouTubeId(rawUrl);
    if (youTubeId) {
        return {
            type: 'video',
            posterUrl: `https://img.youtube.com/vi/${youTubeId}/hqdefault.jpg`,
            linkUrl: rawUrl,
        };
    }

    if (isRedditPermalink(rawUrl)) {
        const imageUrl = await resolveRedditImage(rawUrl);
        if (!imageUrl) throw new Error('Could not find an image on that Reddit post.');
        return { type: 'photo', posterUrl: imageUrl, linkUrl: rawUrl };
    }

    // Assumed to already be a direct image link (Discord CDN, i.redd.it,
    // imgur, etc.) — used as-is, no page to link back to.
    return { type: 'photo', posterUrl: rawUrl, linkUrl: '' };
}

function extractYouTubeId(rawUrl) {
    let u;
    try {
        u = new URL(rawUrl);
    } catch {
        return null;
    }
    if (u.hostname.includes('youtu.be')) {
        return u.pathname.slice(1).split('/')[0] || null;
    }
    if (u.hostname.includes('youtube.com')) {
        if (u.pathname === '/watch') return u.searchParams.get('v');
        const embedMatch = u.pathname.match(/\/embed\/([^/]+)/);
        if (embedMatch) return embedMatch[1];
        const shortsMatch = u.pathname.match(/\/shorts\/([^/]+)/);
        if (shortsMatch) return shortsMatch[1];
    }
    return null;
}

// A post permalink like reddit.com/r/xyz/comments/abc123/title/ is an HTML
// page, not an image — distinct from direct-CDN links (i.redd.it,
// preview.redd.it) which are handled by the direct-image fallback instead.
function isRedditPermalink(rawUrl) {
    let u;
    try {
        u = new URL(rawUrl);
    } catch {
        return false;
    }
    return u.hostname.endsWith('reddit.com') && u.pathname.includes('/comments/');
}

async function resolveRedditImage(permalinkUrl) {
    const jsonUrl = permalinkUrl.replace(/\/?(\?.*)?$/, '/') + '.json';
    const res = await fetch(jsonUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Reddit fetch failed (${res.status}).`);
    const data = await res.json();
    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!post) return null;

    // Direct-link post: url_overridden_by_dest points straight at an image.
    if (post.url_overridden_by_dest && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(post.url_overridden_by_dest)) {
        return post.url_overridden_by_dest;
    }
    // Gallery post: grab the first image.
    if (post.is_gallery && post.media_metadata) {
        const first = Object.values(post.media_metadata)[0];
        if (first?.s?.u) return decodeRedditUrl(first.s.u);
    }
    // Fallback: the preview image Reddit auto-generates for the post.
    if (post.preview?.images?.[0]?.source?.url) {
        return decodeRedditUrl(post.preview.images[0].source.url);
    }
    return null;
}

// Reddit's JSON API HTML-escapes URLs inside JSON string values (e.g. `&`
// as `&amp;`) — decode before using as an actual src.
function decodeRedditUrl(url) {
    return url.replace(/&amp;/g, '&');
}