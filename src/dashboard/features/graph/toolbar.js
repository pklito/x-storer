import { config } from './config.js';

const pct = v => `${Math.round(v * 100)}%`;

export function buildToolbar(tweets, shownTweetCount, untaggedCount, linkCount, onChange) {
    const bar = document.createElement('div');
    bar.className = 'force-graph-toolbar';

    const stats = document.createElement('div');
    stats.className = 'force-graph-stats';
    const cappedNote = shownTweetCount < tweets.length ? ` (of ${tweets.length})` : '';
    const untaggedNote = untaggedCount > 0 ? `, ${untaggedCount} untagged` : '';
    stats.textContent = `${shownTweetCount} tweets shown${cappedNote}${untaggedNote} · ${linkCount} links · hold Shift + hover to inspect`;
    bar.appendChild(stats);

    const sliderMax = Math.max(50, tweets.length);
    bar.appendChild(buildSlider({
        label: 'Max tweets',
        value: Math.min(config.maxTweets, sliderMax),
        min: 20,
        max: sliderMax,
        step: 1,
        onChange: (v) => { config.maxTweets = v; onChange(); },
    }));

    bar.appendChild(buildSlider({
        label: 'Links/tweet',
        value: config.linksPerTweet,
        min: 1,
        max: 5,
        step: 1,
        onChange: (v) => { config.linksPerTweet = v; onChange(); },
    }));

    bar.appendChild(buildSlider({
        label: 'Group threshold',
        value: config.groupHullThreshold,
        min: 0,
        max: 1,
        step: 0.05,
        format: pct,
        onChange: (v) => { config.groupHullThreshold = v; onChange(); },
    }));

    bar.appendChild(buildSlider({
        label: 'Hull opacity',
        value: config.hullOpacity,
        min: 0,
        max: 1,
        step: 0.05,
        format: pct,
        onChange: (v) => { config.hullOpacity = v; onChange(); },
    }));

    return bar;
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
