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
    PHOTO: '[data-testid="tweetPhoto"] img',
    TIMESTAMP: 'time',
    ARTICLE_IMAGE: '[data-testid="article-cover-image"] img',
};

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

    const avatarImg = article.querySelector('[data-testid="Tweet-User-Avatar"] img');
    const authorAvatar = avatarImg ? avatarImg.src : '';

    let mediaUrl = null;
    let cardTitle = null;

    const photo = article.querySelector(SELECTORS.PHOTO);
    if (photo) {
        mediaUrl = photo.src;
    } else {
        const video = article.querySelector('video');
        if (video) mediaUrl = video.poster;
    }

    if (!mediaUrl) {
        const articleImg = article.querySelector(SELECTORS.ARTICLE_IMAGE);
        if (articleImg) {
            mediaUrl = articleImg.src;
            const cardEl = article.querySelector('[data-testid="card.layoutLarge.detail"]');
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
        mediaUrl,
    };
}
