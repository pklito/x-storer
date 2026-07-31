export function appendLinkifiedText(element, text) {
    if (!text) return;
    const regex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            element.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        const a = document.createElement('a');
        a.href = match[0];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = match[0];
        a.className = 'linkified-url';
        element.appendChild(a);

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        element.appendChild(document.createTextNode(text.substring(lastIndex)));
    }
}
