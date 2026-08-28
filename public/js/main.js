document.addEventListener('DOMContentLoaded', () => {
    const TOTAL_FRAMES = 881; // Actual extracted count in public/frames/

    // Distinct storage names per rules
    const frames = new Map();      // Hero frame sequence map

    const canvas = document.getElementById('hero-canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const loader = document.getElementById('loader');
    const loaderBar = document.getElementById('loader-bar');
    const loaderStatus = document.getElementById('loader-status');
    const heroTrack = document.getElementById('hero-track');
    const progressFill = document.getElementById('progress-fill');

    let currentFrameIndex = 1;
    let scrollDirection = 1;
    let lastIndex = 1;

    // Initialize Lenis Smooth Scroll
    const lenis = new Lenis({
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true
    });

    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);

    // Cover-Fit Canvas Sizing & Rendering
    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        renderFrame(currentFrameIndex);
    }
    window.addEventListener('resize', resizeCanvas);

    function drawImageCover(img) {
        if (!img || !img.complete || img.naturalWidth === 0) return;
        const cw = canvas.width;
        const ch = canvas.height;
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const imgAspect = iw / ih;
        const canvasAspect = cw / ch;
        let dw, dh, ox, oy;

        if (canvasAspect > imgAspect) {
            dw = cw;
            dh = cw / imgAspect;
            ox = 0;
            oy = (ch - dh) / 2;
        } else {
            dh = ch;
            dw = ch * imgAspect;
            ox = (cw - dw) / 2;
            oy = 0;
        }

        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(img, ox, oy, dw, dh);
    }

    function renderFrame(index) {
        const targetImg = frames.get(index);
        if (targetImg && targetImg.complete && targetImg.naturalWidth > 0) {
            drawImageCover(targetImg);
            return;
        }

        // Fallback to nearest decoded frame in rolling cache if target frame is decoding
        let nearest = null;
        let minDiff = Infinity;
        for (let [k, v] of frames.entries()) {
            if (v && v.complete && v.naturalWidth > 0) {
                const diff = Math.abs(k - index);
                if (diff < minDiff) {
                    minDiff = diff;
                    nearest = v;
                }
            }
        }
        if (nearest) {
            drawImageCover(nearest);
        }
    }

    function loadSingleFrame(idx, onSingleLoad, onSingleError) {
        if (idx < 1 || idx > TOTAL_FRAMES || frames.has(idx)) return;
        const img = new Image();
        const padded = String(idx).padStart(4, '0');
        img.src = `./public/frames/frame_${padded}.jpg`;
        frames.set(idx, img);
        img.onload = () => {
            if (onSingleLoad) onSingleLoad(idx);
            if (idx === currentFrameIndex) renderFrame(idx);
        };
        img.onerror = () => {
            frames.delete(idx);
            // A failed frame still has to count toward "preload finished",
            // or a single missing file on the server would hang the loader
            // forever waiting for a completion count that can never arrive.
            if (onSingleError) onSingleError(idx);
        };
    }

    // Preload ALL frames before revealing the page. We used to only wait
    // for the first 40 and stream the rest in via a scroll-driven "rolling
    // cache" window — fine on a fast local server, but on a live server the
    // network can't always keep up with fast scrolling, so renderFrame()
    // falls back to whatever frame happens to already be decoded, which is
    // exactly the stutter/lag you were seeing. Waiting for the full
    // sequence up front trades a longer initial load for a scroll that
    // never has to guess.
    let initialLoaded = 0;
    let fullyPreloaded = false;
    function preloadAllFrames() {
        const onFrameSettled = () => {
            initialLoaded++;
            const pct = Math.round((initialLoaded / TOTAL_FRAMES) * 100);
            loaderBar.style.width = pct + '%';
            loaderStatus.textContent = `PRELOADING HARVEST (${initialLoaded} / ${TOTAL_FRAMES})`;
            if (initialLoaded === TOTAL_FRAMES) {
                fullyPreloaded = true;
                revealPage();
            }
        };

        for (let i = 1; i <= TOTAL_FRAMES; i++) {
            loadSingleFrame(i, onFrameSettled, onFrameSettled);
        }

        // Safety fallback only — this should essentially never fire under
        // normal conditions since onload/onerror above always resolve. It
        // exists purely so a pathological network doesn't hang the loader
        // forever. Long on purpose: this is a last resort, not a target.
        setTimeout(() => {
            if (!fullyPreloaded && !loader.classList.contains('hidden')) {
                revealPage();
            }
        }, 25000);
    }

    function revealPage() {
        loader.classList.add('hidden');
        document.dispatchEvent(new CustomEvent('site:loaded')); // tells bee-controller.js to take off
        resizeCanvas();
        renderFrame(1);
        updateRollingCache(1, 1);
        initScrollAnimations();
    }

    // Rolling Cache & JIT Prefetch Window Management
    function updateRollingCache(currentIndex, direction) {
        // Once every frame has been preloaded up front, there's nothing
        // left to prune or prefetch — skip the window bookkeeping entirely
        // rather than needlessly deleting/reloading frames we already have.
        if (fullyPreloaded) return;

        const windowSize = 60;
        const prefetchExtra = 15;

        const minKeep = Math.max(1, currentIndex - (windowSize + prefetchExtra));
        const maxKeep = Math.min(TOTAL_FRAMES, currentIndex + (windowSize + prefetchExtra));

        // Prune frames outside window from cache for garbage collection
        for (let [idx, img] of frames.entries()) {
            if (idx < minKeep || idx > maxKeep) {
                if (img) img.src = '';
                frames.delete(idx);
            }
        }

        // Prefetch window around currentIndex
        let startFetch = Math.max(1, currentIndex - windowSize);
        let endFetch = Math.min(TOTAL_FRAMES, currentIndex + windowSize);

        if (direction > 0) {
            endFetch = Math.min(TOTAL_FRAMES, currentIndex + windowSize + prefetchExtra);
        } else if (direction < 0) {
            startFetch = Math.max(1, currentIndex - (windowSize + prefetchExtra));
        }

        for (let i = startFetch; i <= endFetch; i++) {
            loadSingleFrame(i);
        }
    }

    // Calculate progress from getBoundingClientRect() of pinned hero track
    function getHeroProgress() {
        const rect = heroTrack.getBoundingClientRect();
        const totalScrollable = rect.height - window.innerHeight;
        if (totalScrollable <= 0) return 0;
        const rawProgress = -rect.top / totalScrollable;
        return Math.max(0, Math.min(1, rawProgress));
    }

    // Hero Frame Sequence Update
    function updateHero() {
        const progress = getHeroProgress();
        const targetFrame = 1 + Math.round(progress * (TOTAL_FRAMES - 1));

        if (targetFrame !== lastIndex) {
            scrollDirection = targetFrame > lastIndex ? 1 : -1;
            lastIndex = targetFrame;
        }

        currentFrameIndex = targetFrame;
        renderFrame(targetFrame);
        updateRollingCache(targetFrame, scrollDirection);

        // Hero Text Overlays Progress Logic
        setOverlayOpacity('hero-text-1', getRangeOpacity(progress, 0.15, 0.25));
        setOverlayOpacity('hero-text-2', getRangeOpacity(progress, 0.35, 0.45));
        setOverlayOpacity('hero-text-3', getRangeOpacity(progress, 0.55, 0.67));
        setOverlayOpacity('hero-text-4', getRangeOpacity(progress, 0.70, 0.80));
    }

    function getRangeOpacity(p, start, end) {
        const fadeWindow = 0.035;
        if (p < start - fadeWindow || p > end + fadeWindow) return 0;
        if (p >= start && p <= end) return 1;
        if (p < start) return (p - (start - fadeWindow)) / fadeWindow;
        if (p > end) return 1 - ((p - end) / fadeWindow);
        return 0;
    }

    function setOverlayOpacity(id, opacity) {
        const el = document.getElementById(id);
        if (el) el.style.opacity = opacity;
    }

    // Update Fixed Right Edge Progress Bar
    function updateProgressBar() {
        const totalDocHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (totalDocHeight > 0) {
            const scrollPct = (window.scrollY / totalDocHeight) * 100;
            progressFill.style.height = Math.min(100, Math.max(0, scrollPct)) + '%';
        }
    }

    window.addEventListener('scroll', () => {
        updateHero();
        updateProgressBar();
    });

    // IntersectionObserver for Sticky Explainer Product Jar Swap
    const stickyImg = document.getElementById('sticky-product-img');
    const stickyBadge = document.getElementById('sticky-product-badge');
    const explainerPanels = document.querySelectorAll('.explainer-panel');

    const explainerObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const jarSrc = entry.target.getAttribute('data-jar');
                const badgeText = entry.target.getAttribute('data-badge');
                if (jarSrc && stickyImg.src !== jarSrc) {
                    stickyImg.style.opacity = '0';
                    stickyImg.style.transform = 'scale(0.94)';
                    setTimeout(() => {
                        stickyImg.src = jarSrc;
                        stickyBadge.textContent = badgeText;
                        stickyImg.style.opacity = '1';
                        stickyImg.style.transform = 'scale(1)';
                    }, 220);
                }
            }
        });
    }, { threshold: 0.5 });

    explainerPanels.forEach(panel => explainerObserver.observe(panel));

    // Horizontal Collection Rail Pinned GSAP Scroll
    const railFlex = document.getElementById('rail-flex');
    if (railFlex) {
        gsap.to(railFlex, {
            x: () => -(railFlex.scrollWidth - window.innerWidth),
            ease: "none",
            scrollTrigger: {
                trigger: "#collection-rail-track",
                pin: true,
                scrub: 1,
                end: () => "+=" + (railFlex.scrollWidth - window.innerWidth),
                invalidateOnRefresh: true
            }
        });
    }

    // Parallax Statement Background Movement
    const statementBg = document.querySelector('.statement-bg');
    if (statementBg) {
        gsap.to(statementBg, {
            y: "22%",
            ease: "none",
            scrollTrigger: {
                trigger: "#statement-section",
                start: "top bottom",
                end: "bottom top",
                scrub: true
            }
        });
    }

    // Reverse Columns Alternating Vertical Parallax
    const col1 = document.querySelector('.col-1');
    const col2 = document.querySelector('.col-2');
    const col3 = document.querySelector('.col-3');

    if (col1 && col2 && col3) {
        gsap.to(col1, {
            y: "-140px",
            ease: "none",
            scrollTrigger: {
                trigger: "#reverse-columns-section",
                start: "top bottom",
                end: "bottom top",
                scrub: true
            }
        });
        gsap.to(col2, {
            y: "140px",
            ease: "none",
            scrollTrigger: {
                trigger: "#reverse-columns-section",
                start: "top bottom",
                end: "bottom top",
                scrub: true
            }
        });
        gsap.to(col3, {
            y: "-140px",
            ease: "none",
            scrollTrigger: {
                trigger: "#reverse-columns-section",
                start: "top bottom",
                end: "bottom top",
                scrub: true
            }
        });
    }

    // ====================================================================
    //  SCROLL-TRIGGERED ENTRANCE ANIMATIONS
    // ====================================================================
    function initScrollAnimations() {

        // Storyboard items: staggered fade-up
        const storyboardItems = document.querySelectorAll('.storyboard-item');
        if (storyboardItems.length) {
            gsap.fromTo(storyboardItems,
                { opacity: 0, y: 40 },
                {
                    opacity: 1, y: 0,
                    duration: 0.7,
                    ease: 'power2.out',
                    stagger: 0.08,
                    scrollTrigger: {
                        trigger: '.storyboard-archive-section',
                        start: 'top 80%',
                        toggleActions: 'play none none none'
                    }
                }
            );
        }

        // Product grid cards: stagger fade + lift
        const productCards = document.querySelectorAll('.product-card');
        if (productCards.length) {
            gsap.fromTo(productCards,
                { opacity: 0, y: 50 },
                {
                    opacity: 1, y: 0,
                    duration: 0.85,
                    ease: 'power3.out',
                    stagger: 0.15,
                    scrollTrigger: {
                        trigger: '.product-grid',
                        start: 'top 82%',
                        toggleActions: 'play none none none'
                    }
                }
            );
        }

        // Section headers: elegant fade-up
        const sectionHeaders = document.querySelectorAll('.section-header-center');
        sectionHeaders.forEach(header => {
            gsap.fromTo(header,
                { opacity: 0, y: 30 },
                {
                    opacity: 1, y: 0,
                    duration: 1,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: header,
                        start: 'top 85%',
                        toggleActions: 'play none none none'
                    }
                }
            );
        });

        // Statement section title
        const statementTitle = document.querySelector('.statement-title');
        if (statementTitle) {
            gsap.fromTo(statementTitle,
                { opacity: 0, y: 28 },
                {
                    opacity: 1, y: 0,
                    duration: 1.4,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: '.statement-section',
                        start: 'top 70%',
                        toggleActions: 'play none none none'
                    }
                }
            );
        }

        // Newsletter content: fade up
        const nlContent = document.querySelector('.newsletter-content');
        if (nlContent) {
            gsap.fromTo(nlContent,
                { opacity: 0, y: 35 },
                {
                    opacity: 1, y: 0,
                    duration: 1,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: '.newsletter-section',
                        start: 'top 75%',
                        toggleActions: 'play none none none'
                    }
                }
            );
        }

        // Ritual cards: each slides up slightly as it enters view
        const ritualCards = document.querySelectorAll('.ritual-card');
        ritualCards.forEach((card, i) => {
            gsap.fromTo(card.querySelector('.ritual-card-content'),
                { opacity: 0, y: 20 },
                {
                    opacity: 1, y: 0,
                    duration: 0.9,
                    delay: i * 0.05,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: card,
                        start: 'top 75%',
                        toggleActions: 'play none none none'
                    }
                }
            );
        });

        // Reverse-columns images: subtle entrance
        const reverseCards = document.querySelectorAll('.reverse-card');
        if (reverseCards.length) {
            gsap.fromTo(reverseCards,
                { opacity: 0 },
                {
                    opacity: 1,
                    duration: 1.2,
                    ease: 'power2.out',
                    stagger: 0.1,
                    scrollTrigger: {
                        trigger: '#reverse-columns-section',
                        start: 'top 85%',
                        toggleActions: 'play none none none'
                    }
                }
            );
        }
    }

    // Preload every hero frame, then kick off
    preloadAllFrames();

    // MUST end script with ScrollTrigger.refresh()
    ScrollTrigger.refresh();

    // ====================================================================
    //  CURSOR GLOW FOLLOWER
    // ====================================================================
    const cursorGlow = document.getElementById('cursor-glow');
    if (cursorGlow) {
        let mouseX = window.innerWidth / 2;
        let mouseY = window.innerHeight / 2;
        let glowX = mouseX;
        let glowY = mouseY;

        document.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        });

        function animateCursor() {
            glowX += (mouseX - glowX) * 0.08;
            glowY += (mouseY - glowY) * 0.08;
            cursorGlow.style.left = glowX + 'px';
            cursorGlow.style.top = glowY + 'px';
            requestAnimationFrame(animateCursor);
        }
        animateCursor();
    }
});