export function initCarousel() {
    let idx = 0;
    const total = 4;
    const track = document.getElementById('og-carousel-track');
    const dots = document.querySelectorAll('.og-dot');
    if (!track || !dots.length) return;

    function goTo(i) {
        idx = i;
        track.style.transform = `translateX(-${idx * 100}%)`;
        dots.forEach((d, j) => d.classList.toggle('active', j === idx));
    }
    dots.forEach(d => d.addEventListener('click', () => goTo(parseInt(d.dataset.index, 10))));

    // Fallback for broken OG images
    document.querySelectorAll('.og-card img').forEach(img => {
        img.addEventListener('error', function () {
            this.style.display = 'none';
            this.nextElementSibling.style.display = 'flex';
        });
    });

    setInterval(() => goTo((idx + 1) % total), 4000);
}
