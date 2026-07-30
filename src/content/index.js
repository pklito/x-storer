/**
 * Content Script for XBookmark - RELEASE VERSION (V1.0)
 * Fixes Unbookmark Detection in Feed & Improves ID Parsing
 */


// --- CSS Selectors & Constants ---
const SELECTORS = {
    TWEET: 'article[data-testid="tweet"]',
    USER_NAME: '[data-testid="User-Name"]',
    TWEET_TEXT: '[data-testid="tweetText"]',
    MEDIA_ITEM: '[data-testid="tweetPhoto"]',
    CARD_LINK: '[data-testid="card.layoutLarge.detail"], [data-testid="card.layoutSmall.detail"]',
    ARTICLE_IMAGE: '[data-testid="article-cover-image"] img',
    TIMESTAMP: 'time'
};

/**
 * Walks every media slot in the tweet (photos, videos, gifs) and returns
 * them in DOM order. Kept in sync with src/utils/parseTweet.js's
 * parseMediaItems — this file can't import that module directly (content
 * script context), so the logic is duplicated here on purpose.
 */
function parseMediaItems(article) {
    const items = [];
    const nodes = article.querySelectorAll(SELECTORS.MEDIA_ITEM);

    nodes.forEach(node => {
        // Defensive: skip a tweetPhoto node nested inside another one.
        const parent = node.parentElement ? node.parentElement.closest(SELECTORS.MEDIA_ITEM) : null;
        if (parent) return;

        const video = node.querySelector('video');
        if (video) {
            const isGif = video.hasAttribute('loop') || video.loop === true;
            const source = video.querySelector('source');

            items.push({
                type: isGif ? 'gif' : 'video',
                url: video.getAttribute('poster') || '',
                videoSrc: source ? source.getAttribute('src') : null,
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

let observer = null;
let currentUrl = window.location.href;

// --- Main Loop: Watch URL ---
setInterval(() => {
    if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        handleNavigation();
    }
}, 1000);

handleNavigation();

function handleNavigation() {
    if (window.location.pathname.includes('/i/bookmarks')) {
        startAutoScan();
    } else {
        stopAutoScan();
    }
}

// --- Auto-Scan Logic ---
function startAutoScan() {
    if (observer) return;

    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const article = entry.target;
                if (!article.dataset.xbScanned) {
                    const success = processAndSaveTweet(article, 'auto_scan');
                    if (success) {
                        article.dataset.xbScanned = 'true';
                    }
                }
            }
        });
    }, { threshold: 0.2 });

    attachObserverToTweets();
    window.xbInterval = setInterval(attachObserverToTweets, 1500);
}

function attachObserverToTweets() {
    const tweets = document.querySelectorAll(SELECTORS.TWEET);
    tweets.forEach(t => {
        if (!t.dataset.xbScanned && observer) {
            observer.observe(t);
        }
    });
}

function stopAutoScan() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (window.xbInterval) {
        clearInterval(window.xbInterval);
        window.xbInterval = null;
    }
}

// --- Manual Click Detection (Heuristic) ---
document.addEventListener('click', (event) => {
    let element = event.target;
    let foundRef = null;

    // Go up max 7 parent levels
    for (let i = 0; i < 7; i++) {
        if (!element) break;

        // A. CHeck test-id
        const testId = element.getAttribute ? element.getAttribute('data-testid') : '';
        if (testId === 'bookmark' || testId === 'removeBookmark') {
            foundRef = element;
            break;
        }

        // B. Check aria-label
        const label = element.getAttribute ? element.getAttribute('aria-label') : '';
        if (label && (label.includes('Bookmark') || label.includes('Signet'))) {
            foundRef = element;
            break;
        }

        // C. Check SVG Path
        if (element.tagName === 'path') {
            const d = element.getAttribute('d');
            if (d && d.startsWith('M4 4.5C4')) {
                foundRef = element;
                break;
            }
        }

        element = element.parentElement;
    }

    if (foundRef) {
        // Now determine if it's REMOVE or ADD
        const buttonEl = foundRef.getAttribute('role') === 'button' ? foundRef : foundRef.closest('[role="button"]');

        let isRemoveAction = false;
        if (buttonEl) {
            const label = buttonEl.getAttribute('aria-label') || '';
            const testId = buttonEl.getAttribute('data-testid') || '';

            if (testId === 'removeBookmark') {
                isRemoveAction = true;
            } else if (label.includes('Remove') || label.includes('Supprimer') || label.includes('Retirer')) {
                isRemoveAction = true;
            }
        }

        const tweetArticle = foundRef.closest('article') || foundRef.closest('[data-testid="tweet"]');

        if (tweetArticle) {
            if (isRemoveAction) {
                const data = parseTweet(tweetArticle);
                if (data && data.id) {
                    safelySendMessage({ type: 'REMOVE_TWEET', payload: { id: data.id } });
                    showDebugToast('Tweet Removed 🗑️');
                } else {
                    console.warn('XBookmark: Failed to parse ID for removal');
                }
            } else {
                processAndSaveTweet(tweetArticle, 'manual_click');
            }
        }
    }
}, true); // Capture phase

// --- Safer Messaging Helper ---
function safelySendMessage(message) {
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) { }
            });
        } catch (e) { }
    }
}

// --- Core Processing Logic ---
function processAndSaveTweet(article, source) {
    try {
        const data = parseTweet(article);
        if (!data) return false;

        data.source = source;
        safelySendMessage({ type: 'SAVE_TWEET', payload: data });
        if (source === 'manual_click') showDebugToast('Tweet Saved! 📥');
        return true;
    } catch (e) {
        console.error('XBookmark: Error processing tweet', e);
        return false;
    }
}

function parseTweet(article) {
    // Delegate to shared utility with current window context
    // Note: imported inline to avoid module issues in content script context
    const userEl = article.querySelector(SELECTORS.USER_NAME);
    const textEl = article.querySelector(SELECTORS.TWEET_TEXT);
    const timeEl = article.querySelector(SELECTORS.TIMESTAMP);

    if (!userEl) return null;

    const text = textEl ? textEl.innerText : '';
    const timestamp = timeEl ? timeEl.getAttribute('datetime') : new Date().toISOString();

    let tweetId = null;
    let url = window.location.href;

    if (window.location.pathname.includes('/status/')) {
        const parts = window.location.pathname.split('/');
        const statusIdx = parts.indexOf('status');
        if (statusIdx !== -1 && parts[statusIdx + 1]) {
            tweetId = parts[statusIdx + 1];
        }
    }

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

    if (!tweetId) {
        console.warn('XBookmark: Could not find Tweet ID, using local fallback.');
        tweetId = `local-${Date.now()}`;
    }

    const [nameLine, handleLine] = userEl.innerText.split('\n');
    const authorName = nameLine || 'Unknown';
    const authorHandle = handleLine || '@unknown';

    const avatarImg = article.querySelector('[data-testid="Tweet-User-Avatar"] img');
    const authorAvatar = avatarImg ? avatarImg.src : '';

    // Full ordered list of media attachments: photos, videos, and gifs.
    const media = parseMediaItems(article);
    let cardTitle = null;

    // Article/link-preview card image is only used as a fallback when the
    // tweet has no actual photo/video/gif media.
    if (media.length === 0) {
        const articleImg = article.querySelector(SELECTORS.ARTICLE_IMAGE);
        if (articleImg) {
            media.push({ type: 'photo', url: articleImg.src });
            const cardText = article.querySelector('[data-testid="card.layoutLarge.detail"]')?.innerText;
            if (cardText) cardTitle = cardText.split('\n')[0];
        }
    }

    const isSensitive = Array.from(article.querySelectorAll("button"))
    .some(button => {
        const text = button.textContent.trim();
        return text === "Show" || text === "Hide";
    });

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
        isSensitive,
    };
}

function showDebugToast(msg) {
    const div = document.createElement('div');
    div.textContent = msg;
    div.style.position = 'fixed';
    div.style.bottom = '20px';
    div.style.left = '20px';
    div.style.background = '#000';
    div.style.color = '#fff';
    div.style.padding = '8px 12px';
    div.style.borderRadius = '4px';
    div.style.zIndex = '99999';
    div.style.fontSize = '12px';
    div.style.border = '1px solid #333';
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 2500);
}