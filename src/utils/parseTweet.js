/**
 * Extracts tweet data from a DOM article element.
 * Extracted from content/index.js for testability.
 *
 * @param {Element} article - The tweet article DOM element
 * @param {object} context - { pathname, href } to decouple from window.location
 * @returns {object|null} Parsed tweet data or null if unparseable
 */

const SELECTORS = {
    USER_NAME: '[data-testid="User-Name"]',
    TWEET_TEXT: '[data-testid="tweetText"]',
    MEDIA_ITEM: '[data-testid="tweetPhoto"]',
    TIMESTAMP: 'time',
    ARTICLE_IMAGE: '[data-testid="article-cover-image"] img',
    AVATAR: '[data-testid="Tweet-User-Avatar"] img',
    CARD_TITLE: '[data-testid="card.layoutLarge.detail"]',
};

/**
 * Walks every media slot in the tweet (photos, videos, gifs) and returns
 * them in DOM order. X renders each attachment - whether photo, video, or
 * gif - inside its own `[data-testid="tweetPhoto"]` wrapper, so we no
 * longer stop after the first match like the old single-mediaUrl approach.
 *
 * Videos/gifs can't have their actual video stream recovered from the DOM
 * (the <source> is normally a page-session-only `blob:` URL), so for those
 * we store the poster frame as the display `url` and mark the item's
 * `type` so the UI can render a play/gif badge instead of silently
 * flattening it into a plain image the way the old parser did.
 */
function parseMediaItems(article) {
    const items = [];
    const nodes = article.querySelectorAll(SELECTORS.MEDIA_ITEM);

    nodes.forEach(node => {
        // Defensive: skip a tweetPhoto node if it's nested inside another
        // one, so a future markup change can't cause double-counting.
        const parent = node.parentElement ? node.parentElement.closest(SELECTORS.MEDIA_ITEM) : null;
        if (parent) return;

        const video = node.querySelector('video');
        if (video) {
            // X doesn't otherwise distinguish gifs from videos in the DOM;
            // this is a best-effort heuristic (gifs are muted/looping video
            // elements). Falls back to 'video' when it can't tell.
            const isGif = video.hasAttribute('loop') || video.loop === true;
            const source = video.querySelector('source');

            items.push({
                type: isGif ? 'gif' : 'video',
                url: video.getAttribute('poster') || '', // thumbnail, used as the display image
                videoSrc: source ? source.getAttribute('src') : null, // usually an ephemeral blob: URL; kept if present but not reliable for persistence
            });
            return;
        }

        const img = node.querySelector('img');
        if (img && img.src) {
            items.push({ type: 'photo', url: img.src });
        }
    });

    return items;
}

export function parseTweet(article, context) {
    const userEl = article.querySelector(SELECTORS.USER_NAME);
    const textEl = article.querySelector(SELECTORS.TWEET_TEXT);
    const timeEl = article.querySelector(SELECTORS.TIMESTAMP);

    if (!userEl) return null;

    const text = textEl ? (textEl.innerText || textEl.textContent || '') : '';
    const timestamp = timeEl ? timeEl.getAttribute('datetime') : new Date().toISOString();

    // --- ROBUST ID PARSING ---
    let tweetId = null;
    let url = context.href;

    // Strategy 1: Permalink page URL
    if (context.pathname.includes('/status/')) {
        const parts = context.pathname.split('/');
        const statusIdx = parts.indexOf('status');
        if (statusIdx !== -1 && parts[statusIdx + 1]) {
            tweetId = parts[statusIdx + 1];
        }
    }

    // Strategy 2: Timestamp link
    if (!tweetId) {
        const timeLink = timeEl?.closest('a') || article.querySelector('a[href*="/status/"][dir="ltr"]');
        if (timeLink) {
            url = timeLink.href;
            const parts = url.split('/');
            const statusIdx = parts.indexOf('status');
            if (statusIdx !== -1 && parts[statusIdx + 1]) {
                tweetId = parts[statusIdx + 1].split('?')[0];
            }
        }
    }

    // Strategy 3: Any status link in the article
    if (!tweetId) {
        const links = article.querySelectorAll('a[href*="/status/"]');
        for (const link of links) {
            const parts = link.href.split('/');
            const statusIdx = parts.indexOf('status');
            if (statusIdx !== -1 && parts[statusIdx + 1]) {
                const candidate = parts[statusIdx + 1].split('?')[0];
                if (/^\d+$/.test(candidate)) {
                    tweetId = candidate;
                    url = link.href;
                    break;
                }
            }
        }
    }

    // Fallback: local ID
    if (!tweetId) {
        tweetId = `local-${Date.now()}`;
    }

    const userLines = (userEl.innerText || userEl.textContent).split('\n').map(s => s.trim()).filter(Boolean);
    const authorName = userLines[0] || 'Unknown';
    const authorHandle = userLines[1] || '@unknown';

    const avatarImg = article.querySelector(SELECTORS.AVATAR);
    const authorAvatar = avatarImg ? avatarImg.src : '';

    // Full ordered list of media attachments: photos, videos, and gifs.
    const media = parseMediaItems(article);
    let cardTitle = null;

    // Article/link-preview card image (e.g. shared blog post) is only used
    // as a fallback when the tweet has no actual photo/video/gif media.
    if (media.length === 0) {
        const articleImg = article.querySelector(SELECTORS.ARTICLE_IMAGE);
        if (articleImg) {
            media.push({ type: 'photo', url: articleImg.src });
            const cardEl = article.querySelector(SELECTORS.CARD_TITLE);
            const cardText = cardEl ? (cardEl.innerText || cardEl.textContent) : null;
            if (cardText) cardTitle = cardText.split('\n')[0];
        }
    }

    return {
        id: tweetId,
        text: cardTitle ? `${text}\n\n[Article: ${cardTitle}]` : text,
        url,
        authorName,
        authorHandle,
        authorAvatar,
        timestamp,
        media, // [{ type: 'photo' | 'video' | 'gif', url, videoSrc? }, ...] in DOM order
        mediaUrl: media[0] ? media[0].url : null, // back-compat: first media item's display url
    };
}