import { state } from '@components/state.js';
import { tagEditorContainer, tagInput } from '@components/dom.js';

export function renderTagCapsules() {
    // Keep the input at the end, remove old capsules, re-append fresh ones.
    const capsules = tagEditorContainer.querySelectorAll('.tag-capsule');
    capsules.forEach(el => el.remove());

    const fragment = document.createDocumentFragment();
    state.currentQuoteTags.forEach((tag, index) => {
        const span = document.createElement('span');
        span.className = 'tag-capsule';
        span.textContent = tag + ' ';

        const i = document.createElement('i');
        i.className = 'bi bi-x';
        i.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent focus trigger
            removeTagFromEditor(index);
        });

        span.appendChild(i);
        fragment.appendChild(span);
    });

    tagEditorContainer.insertBefore(fragment, tagInput);
}

export function addTagToEditor(tag) {
    const cleanTag = tag.trim().replace(/^#/, ''); // remove # if user typed it
    if (cleanTag && !state.currentQuoteTags.includes(cleanTag)) {
        state.currentQuoteTags.push(cleanTag);
        renderTagCapsules();
    }
}

export function removeTagFromEditor(index) {
    state.currentQuoteTags.splice(index, 1);
    renderTagCapsules();
}
