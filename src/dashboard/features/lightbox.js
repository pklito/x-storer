// Click a photo to view it enlarged. Built as a single reused overlay
// (not one per card) so there's only ever one in the DOM.

let lightboxEls = null; // built lazily on first use

export function openLightbox(src, alt) {
    if (!lightboxEls) lightboxEls = buildLightbox();
    lightboxEls.img.src = src;
    lightboxEls.img.alt = alt || '';
    lightboxEls.overlay.classList.add('active');
}

export function closeLightbox() {
    if (!lightboxEls) return;
    lightboxEls.overlay.classList.remove('active');
    lightboxEls.img.src = ''; // release the decoded image rather than holding it in memory
}

function buildLightbox() {
    const overlay = document.createElement('div');
    overlay.className = 'xb-lightbox-overlay';
    overlay.addEventListener('click', closeLightbox);

    const img = document.createElement('img');
    img.className = 'xb-lightbox-img';
    img.addEventListener('click', (e) => e.stopPropagation()); // clicking the image itself shouldn't close it
    overlay.appendChild(img);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'xb-lightbox-close-btn';
    closeBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeLightbox(); });
    overlay.appendChild(closeBtn);

    document.body.appendChild(overlay);
    return { overlay, img };
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightboxEls && lightboxEls.overlay.classList.contains('active')) closeLightbox();
});
