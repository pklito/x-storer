import { config } from './config.js';

const pct = v => `${Math.round(v * 100)}%`;

function statsText(tweets, shownTweetCount, untaggedCount, linkCount) {
    const cappedNote = shownTweetCount < tweets.length ? ` (of ${tweets.length})` : '';
    const untaggedNote = untaggedCount > 0 ? `, ${untaggedCount} untagged` : '';
    return `${shownTweetCount} tweets shown${cappedNote}${untaggedNote} · ${linkCount} links · hold Shift + hover to inspect`;
}

// `onDataChange` fires for sliders that actually change which tweets/
// links exist (maxTweets, linksPerTweet) — the caller rebuilds graph
// data and merges it into the live simulation. `onVisualChange` fires
// for sliders that only affect how existing data is drawn (hull
// threshold, hull opacity) — the caller must NOT touch nodes/links/
// the simulation for these, only redraw hulls.
export function buildToolbar(tweets, shownTweetCount, untaggedCount, linkCount, { onDataChange, onVisualChange }) {
    const bar = document.createElement('div');
    bar.className = 'force-graph-toolbar';

    const stats = document.createElement('div');
    stats.className = 'force-graph-stats';
    stats.textContent = statsText(tweets, shownTweetCount, untaggedCount, linkCount);
    bar.appendChild(stats);

    bar.appendChild(buildCheckbox({
        label: 'Show untagged tweets',
        checked: config.showUntaggedTweets,
        onChange: (v) => { config.showUntaggedTweets = v; onDataChange(); },
    }));

    const sliderMax = Math.max(50, tweets.length);
    bar.appendChild(buildSlider({
        label: 'Max tweets',
        value: Math.min(config.maxTweets, sliderMax),
        min: 20,
        max: sliderMax,
        step: 1,
        onChange: (v) => { config.maxTweets = v; onDataChange(); },
    }));

    bar.appendChild(buildSlider({
        label: 'Links/tweet',
        value: config.linksPerTweet,
        min: 1,
        max: 5,
        step: 1,
        onChange: (v) => { config.linksPerTweet = v; onDataChange(); },
    }));

    bar.appendChild(buildSlider({
        label: 'Group threshold',
        value: config.groupHullThreshold,
        min: 0,
        max: 1,
        step: 0.05,
        format: pct,
        onChange: (v) => { config.groupHullThreshold = v; onVisualChange(); },
    }));

    bar.appendChild(buildSlider({
        label: 'Hull opacity',
        value: config.hullOpacity,
        min: 0,
        max: 1,
        step: 0.05,
        format: pct,
        onChange: (v) => { config.hullOpacity = v; onVisualChange(); },
    }));

    return bar;
}

// Patches just the stats line after a data-changing slider update,
// without rebuilding the toolbar (a full rebuild would tear out and
// recreate the slider inputs mid-interaction, losing focus/drag state).
export function updateToolbarStats(root, tweets, shownTweetCount, untaggedCount, linkCount) {
    const stats = root.querySelector('.force-graph-stats');
    if (stats) stats.textContent = statsText(tweets, shownTweetCount, untaggedCount, linkCount);
}

function buildSlider({ label, value, min, max, step = 1, format, onChange }) {
    const fmt = format || (v => v);
    const wrap = document.createElement('label');
    wrap.className = 'force-graph-slider';
    const span = document.createElement('span');
    span.textContent = `${label}: ${fmt(value)}`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => { span.textContent = `${label}: ${fmt(Number(input.value))}`; });
    input.addEventListener('change', () => onChange(Number(input.value)));
    wrap.appendChild(span);
    wrap.appendChild(input);
    return wrap;
}
function buildCheckbox({ label, checked, onChange }) {
    const wrap = document.createElement('label');
    wrap.className = 'force-graph-checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(input);
    wrap.appendChild(span);
    return wrap;
}