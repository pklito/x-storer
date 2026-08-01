import { db } from '../../utils/db.js';

// Click extension icon → open dashboard (reuse existing tab if open)
chrome.action.onClicked.addListener(async () => {
    const dashboardUrl = chrome.runtime.getURL('src/dashboard/index.html');
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find(t => t.url && t.url.startsWith(dashboardUrl));
    if (existing) {
        chrome.tabs.update(existing.id, { active: true });
        chrome.windows.update(existing.windowId, { focused: true });
    } else {
        chrome.tabs.create({ url: dashboardUrl });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SAVE_TWEET') {
        handleSaveTweet(message.payload);
        return true;
    }

    if (message.type === 'REMOVE_TWEET') {
        handleRemoveTweet(message.payload);
        return true;
    }
});

async function handleSaveTweet(tweetData) {
    try {
        await db.addTweet(tweetData);

        if (tweetData.source !== 'auto_scan') {
            chrome.action.setBadgeText({ text: '!' });
            setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
        }

    } catch (err) {
        console.error('Error saving tweet in background:', err);
    }
}

async function handleRemoveTweet(payload) {
    try {
        await db.deleteTweet(payload.id);
    } catch (err) {
        console.error('Error removing tweet:', err);
    }
}
