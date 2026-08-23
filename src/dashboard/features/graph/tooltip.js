let tooltipEl = null;

export function getTooltip() {
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'force-graph-tooltip';
        document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
}

export function positionTooltip(el, event) {
    el.style.left = `${event.clientX + 14}px`;
    el.style.top = `${event.clientY + 14}px`;
}

export function showTooltip(el, event, d, links) {
    const t = d.tweet;
    const who = t.authorHandle ? `@${t.authorHandle}` : (t.authorName || 'unknown');
    const text = (t.text || '').slice(0, 140) + ((t.text || '').length > 140 ? '…' : '');
    const tagList = d.tweet.tags.length
        ? d.tweet.tags.map(tag => tag === d.dominantTag ? `<strong>#${escapeHtml(tag)}</strong>` : `#${escapeHtml(tag)}`).join(' ')
        : '<em>no tags</em>';
    const linkCount = links.filter(l => l.source.id === d.id || l.target.id === d.id).length;
    el.innerHTML = `
        <div class="force-graph-tooltip-title">${escapeHtml(who)}</div>
        <div class="force-graph-tooltip-count">${escapeHtml(text)}</div>
        <div class="force-graph-tooltip-related">${tagList} &middot; ${linkCount} link${linkCount === 1 ? '' : 's'}</div>
    `;
    el.style.display = 'block';
    positionTooltip(el, event);
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
