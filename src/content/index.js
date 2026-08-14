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
let scanActive = false;

// --- Bookmarks Tab Detection ---
// X now also exposes Bookmarks as a selectable tab under /i/history,
// alongside sibling tabs (e.g. /i/history/likes) that live under the same
// URL prefix. Matching on visible tab text breaks on non-English UIs, so
// this matches on the tab's href instead:
//   Bookmarks tab: <a href="/i/history" role="tab" aria-selected="true">
//   Likes tab:     <a href="/i/history/likes" role="tab" ...>
// aria-selected can flip between tabs without the URL changing (SPA tab
// switch), so this has to be polled independently of the URL watcher. Only
// checked once we're already somewhere under /i/history, since the href
// alone ('/i/history') isn't a distinguishing signal anywhere else on site.
function isBookmarksTabActive() {
    if (!window.location.pathname.includes('/i/history')) return false;

    const tabs = document.querySelectorAll('a[role="tab"][aria-selected="true"]');
    for (const tab of tabs) {
        if (tab.getAttribute('href') === '/i/history') {
            return true;
        }
    }
    return false;
}

// --- Main Loop: Watch URL + Bookmarks tab state ---
setInterval(() => {
    if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
    }
    handleNavigation();
}, 1000);

handleNavigation();

function handleNavigation() {
    const shouldScan =
        window.location.pathname.includes('/i/bookmarks') ||
        isBookmarksTabActive();

    if (shouldScan === scanActive) return; // no state change, skip

    scanActive = shouldScan;
    if (shouldScan) {
        startAutoScan();
    } else {
        stopAutoScan();
    }
}

// --- Auto-Scan Logic ---
function startAutoScan() {
    if (observer) return;

    // Resets the badge counter to B:0 in the background — every fresh
    // start of auto-scan (new visit to the tab/page) starts the count over.
    safelySendMessage({ type: 'AUTO_SCAN_START' });

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
    safelySendMessage({ type: 'AUTO_SCAN_STOP' });

    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (window.xbInterval) {
        clearInterval(window.xbInterval);
        window.xbInterval = null;
    }
}

// --- Removal Diagnostics ---
// A real, account-level bookmark got removed on X during an unattended
// scroll pass, and the cause hasn't been confirmed yet (it may not even be
// this heuristic — see the isTrusted note below). Every removal decision
// gets logged here — including whether the triggering click was genuinely
// user-initiated — so this can be inspected forensically after the fact
// instead of guessed at. Read it from the dashboard/devtools console via:
//   chrome.storage.local.get('xb_remove_log', r => console.table(r.xb_remove_log))
const REMOVE_LOG_KEY = 'xb_remove_log';
const REMOVE_LOG_MAX = 100;

function logRemovalDecision(entry) {
    try {
        if (!(chrome && chrome.storage && chrome.storage.local)) return;
        chrome.storage.local.get(REMOVE_LOG_KEY, (result) => {
            const existing = (result && result[REMOVE_LOG_KEY]) || [];
            const updated = [entry, ...existing].slice(0, REMOVE_LOG_MAX);
            chrome.storage.local.set({ [REMOVE_LOG_KEY]: updated });
        });
    } catch (e) { /* best-effort only, never block the actual removal on this */ }
}

// --- Manual Click Detection (Heuristic) ---
document.addEventListener('click', (event) => {
    // TEMPORARY DIAGNOSTIC — logs every single click this listener ever
    // receives, regardless of whether anything below matches it as a
    // bookmark action. Point: get hard proof of whether ANY click fires
    // during an auto-scroll run, instead of reasoning about it. Check via:
    //   chrome.storage.local.get('xb_click_log', r => console.table(r.xb_click_log))
    // Safe to remove once this question is settled.
    try {
        if (chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get('xb_click_log', (result) => {
                const existing = (result && result.xb_click_log) || [];
                const updated = [{
                    at: new Date().toISOString(),
                    isTrusted: event.isTrusted,
                    targetTag: event.target.tagName,
                    targetTestId: event.target.getAttribute ? event.target.getAttribute('data-testid') : null,
                    x: event.clientX,
                    y: event.clientY,
                    pageUrl: window.location.href,
                }, ...existing].slice(0, 200);
                chrome.storage.local.set({ xb_click_log: updated });
            });
        }
    } catch (e) { /* best-effort only */ }

    let element = event.target;
    let foundRef = null;

    // The bookmark button is always inside the clicked tweet's own
    // <article> — bound the walk to that boundary so it can never escape
    // into an OUTER page landmark (e.g. the "Timeline: Bookmarks" region
    // wrapping the whole /i/bookmarks feed, which legitimately mentions
    // "Bookmarks" in its own accessible name but has nothing to do with
    // any single tweet's bookmark button). This was previously causing
    // shallow-DOM tweets (plain text, no media) to get falsely matched.
    const containingArticle = event.target.closest ? event.target.closest('article') : null;

    for (let i = 0; i < 7; i++) {
        if (!element) break;
        if (containingArticle && !containingArticle.contains(element)) break; // never leave the tweet's own article

        // A. CHeck test-id
        const testId = element.getAttribute ? element.getAttribute('data-testid') : '';
        if (testId === 'bookmark' || testId === 'removeBookmark') {
            foundRef = element;
            break;
        }

        // B. Check aria-label — only trust this on an actual button, not
        // any ancestor wrapper/landmark that happens to mention the word.
        const role = element.getAttribute ? element.getAttribute('role') : '';
        const label = element.getAttribute ? element.getAttribute('aria-label') : '';
        if (role === 'button' && label && (label.includes('Bookmark') || label.includes('Signet'))) {
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
        // Now determine if it's REMOVE or ADD — also bounded to the same
        // article, for the same reason as above.
        let buttonEl = foundRef.getAttribute('role') === 'button' ? foundRef : foundRef.closest('[role="button"]');
        if (buttonEl && containingArticle && !containingArticle.contains(buttonEl)) buttonEl = null;

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

                // NOTE ON isTrusted: this only tells you whether the browser
                // considers the click "real" input (mouse/touch/keyboard),
                // vs. dispatched via event.dispatchEvent()/element.click()
                // from a script. It does NOT distinguish "the user clicked
                // this" from "an automation tool drove the real mouse (or
                // used a trusted input API) and happened to click this
                // element" — both read as isTrusted: true. So a false
                // isTrusted:true here does not rule out an auto-scroll/
                // auto-click tool as the cause; it only rules out our own
                // code (or some other script on the page) synthesizing the
                // click. Logged for forensic purposes, not as a filter.
                logRemovalDecision({
                    at: new Date().toISOString(),
                    isTrusted: event.isTrusted,
                    matchedTestId: buttonEl ? (buttonEl.getAttribute('data-testid') || '') : '',
                    matchedLabel: buttonEl ? (buttonEl.getAttribute('aria-label') || '') : '',
                    tweetId: data ? data.id : null,
                    tweetTextSnippet: data ? (data.text || '').slice(0, 80) : null,
                    tweetUrl: data ? data.url : null,
                    pageUrl: window.location.href,
                });

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

    // Strategy 1: Timestamp link (article-specific — always tried first)
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

    // Last resort: the page's own pathname. This can't tell the
    // difference between the main tweet on a permalink page and any
    // reply/quote-tweet also visible on that same page — only trust it
    // once the article-specific strategies above have both failed.
    if (!tweetId && window.location.pathname.includes('/status/')) {
        const parts = window.location.pathname.split('/');
        const statusIdx = parts.indexOf('status');
        if (statusIdx !== -1 && parts[statusIdx + 1]) {
            tweetId = parts[statusIdx + 1];
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