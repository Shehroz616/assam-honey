import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = 'public/models/honey_bee-new.glb';
const RENDER_SIZE = 210; // keep in sync with #bee-container size in CSS

const WAYPOINTS = [
    { trigger: '#hero-track', x: '-78vw', y: '58vh', rot: -50, facing: Math.PI / 2 },
    { trigger: '#explainer-section', x: '10vw', y: '5vh', rot: -15, facing: Math.PI / 4 },
    { trigger: '#collection-rail-track', x: '85vw', y: '75vh', rot: -10, facing: -Math.PI / 4 },
    { trigger: '#ritual-section', x: '18vw', y: '3vh', rot: -10, facing: Math.PI / 4 },
    { trigger: '#statement-section', x: '50vw', y: '22vh', rot: 0, facing: 0 },
    { trigger: '#reverse-columns-section', x: '20vw', y: '65vh', rot: -6, facing: Math.PI / 4 },
    { trigger: '#grid-section', x: '80vw', y: '18vh', rot: 8, facing: -Math.PI / 4 },
    { trigger: '#newsletter-section', x: '60vw', y: '55vh', rot: 0, facing: 0 },
];
// ---- Chase-and-sting tuning ------------------------------------------
const STING_DISTANCE = 55; // px — how close counts as "caught"
const CHASE_SPEED = 560; // px/second — bee's max pursuit speed. A quick
// mouse flick easily outruns this; the bee only gains ground once you slow
// down or stop. Raise this to make it harder to escape, lower it for more
// breathing room.
const CHASE_TIMESCALE = 1.8; // wing-flap speed multiplier while hunting
const WINDUP_TIMESCALE = 2.6; // wing-flap speed multiplier during the angry shake
const STING_RETURN_DELAY = 700; // ms to sit at the sting point before flying back

init();

async function init() {
    const container = document.getElementById('bee-container');
    const canvas = document.getElementById('bee-canvas');
    if (!container || !canvas) return;

    // ---- Scene / camera / renderer -----------------------------------
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0.35, 3.2);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    scene.add(new THREE.AmbientLight(0xfff4d6, 1.2));
    const key = new THREE.DirectionalLight(0xffe9b0, 1.8);
    key.position.set(2, 3, 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.7);
    rim.position.set(-2, 1, -2);
    scene.add(rim);

    // ---- Load the bee ---------------------------------------------------
    let bee, mixer;
    const actions = {};
    let activeAction = null;
    const clock = new THREE.Clock();

    // Rotation is split into two independently-driven pieces that get
    // summed together every frame in the render loop:
    //  - facingState.y  -> the scroll-driven "which section am I facing"
    //                      angle, tweened by GSAP.
    //  - mouseYawOffset -> a small extra turn toward the cursor, updated
    //                      continuously on mousemove and eased each frame.
    // Writing straight to bee.rotation.y from multiple places would fight
    // itself, so everything writes here instead and only the render loop
    // touches the model.
    const facingState = { y: 0 };
    let mouseYawTarget = 0;
    let mouseYawOffset = 0;
    const MOUSE_YAW_RANGE = 0.35; // radians of extra turn at screen edges
    const MOUSE_EASE = 0.08;

    // Live cursor position in page coordinates, used both for the subtle
    // head-tracking above and for the chase-and-sting game below.
    const mousePos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    window.addEventListener('mousemove', (e) => {
        mousePos.x = e.clientX;
        mousePos.y = e.clientY;
        const nx = (e.clientX / window.innerWidth) * 2 - 1; // -1 .. 1
        mouseYawTarget = nx * MOUSE_YAW_RANGE;
    });
    window.addEventListener('touchmove', (e) => {
        if (!e.touches || !e.touches.length) return;
        mousePos.x = e.touches[0].clientX;
        mousePos.y = e.touches[0].clientY;
    }, { passive: true });
    window.addEventListener('touchend', () => {
        mouseYawTarget = 0;
    });

    // ---- Chase-and-sting state -----------------------------------------
    let isChasing = false;
    let isWindingUp = false;
    let stingCooldown = false;
    let choreo = null; // set once setupScrollChoreography() returns below

    const loader = new GLTFLoader();
    loader.load(
        MODEL_URL,
        (gltf) => {
            bee = gltf.scene;
            bee.scale.setScalar(0.70); // tune to fill the 210px frame nicely
            bee.position.set(0, -0.15, 0);
            bee.rotation.y = Math.PI / 4;
            facingState.y = Math.PI / 4;
            scene.add(bee);

            bee.traverse((object) => {
                if (!object.isMesh || !object.material) return;
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                materials.forEach((material) => {
                    if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
                    material.needsUpdate = true;
                });
            });

            mixer = new THREE.AnimationMixer(bee);
            gltf.animations.forEach((clip) => {
                actions[clip.name] = mixer.clipAction(clip);
            });

            startRenderLoop();

            // Play the take-off clip once the loader/hero UI has revealed itself
            // (main.js dispatches this the moment it hides the loading screen).
            document.addEventListener('site:loaded', takeOff, { once: true });
            setTimeout(() => {
                if (!activeAction) takeOff();
            }, 4000);

            choreo = setupScrollChoreography(container, facingState);
        },
        undefined,
        (err) => console.error('[bee-controller] failed to load honey_bee.glb', err)
    );

    function takeOff() {
        container.classList.add('bee-ready');
        const takeoff = actions['take_off_and_land'];
        const idle = actions['idle'];

        if (takeoff) {
            takeoff.reset();
            takeoff.setLoop(THREE.LoopOnce, 1);
            takeoff.clampWhenFinished = true;
            takeoff.play();
            activeAction = takeoff;

            mixer.addEventListener('finished', function onFinished(e) {
                if (e.action !== takeoff) return;
                mixer.removeEventListener('finished', onFinished);
                crossfadeTo('idle', 0.6);
            });
        } else if (idle) {
            crossfadeTo('idle', 0);
        }
    }

    function crossfadeTo(name, duration = 0.4) {
        const next = actions[name];
        if (!next || next === activeAction) return;
        next.reset().fadeIn(duration).play();
        if (activeAction) activeAction.fadeOut(duration);
        activeAction = next;
    }
    // Exposed so the scroll-choreography code (which only deals with CSS
    // position) can also nudge which animation clip is playing.
    window.__beeCrossfade = crossfadeTo;

    let rafId = null;
    function startRenderLoop() {
        if (rafId) return;
        const tick = () => {
            rafId = requestAnimationFrame(tick);
            const dt = clock.getDelta();
            if (mixer) mixer.update(dt);

            if (isChasing) {
                updateChase(dt);
            } else {
                // Ease the mouse-driven yaw offset toward its target and
                // combine with the scroll-driven base facing.
                mouseYawOffset += (mouseYawTarget - mouseYawOffset) * MOUSE_EASE;
                if (bee) bee.rotation.y = facingState.y + mouseYawOffset;
            }

            renderer.render(scene, camera);
        };
        tick();
    }

    // ---- Chase-and-sting ------------------------------------------------
    // Three phases: windUp() (angry shake + a failed stab) -> beginChase()
    // (actually pursues the cursor) -> sting() (catches it, instant this
    // time since the "wind up" already happened).
    function onBeeClick() {
        if (isChasing || isWindingUp || stingCooldown || !mixer) return;
        windUp();
    }

    function windUp() {
        isWindingUp = true;
        stingCooldown = true; // blocks re-clicks for the whole sequence
        document.dispatchEvent(new CustomEvent('bee:windup-start'));

        crossfadeTo('hover', 0.15);
        const hover = actions['hover'];
        if (hover) hover.timeScale = WINDUP_TIMESCALE;

        function finishWindUp() {
            isWindingUp = false;
            beginChase();
        }

        if (!window.gsap || !bee) {
            // No GSAP / model not ready — skip the flourish, go straight to chase.
            finishWindUp();
            return;
        }

        window.gsap.timeline({ onComplete: finishWindUp })
            // Angry shake: quick alternating left-right jitter on the
            // container. Net displacement is zero so it doesn't drift the
            // bee off its current spot before the chase even starts.
            .to(container, { x: -10, duration: 0.06, ease: 'power1.inOut' })
            .to(container, { x: 10, duration: 0.06, ease: 'power1.inOut' })
            .to(container, { x: -8, duration: 0.06, ease: 'power1.inOut' })
            .to(container, { x: 8, duration: 0.06, ease: 'power1.inOut' })
            .to(container, { x: -4, duration: 0.05, ease: 'power1.inOut' })
            .to(container, { x: 0, duration: 0.05, ease: 'power1.inOut' })
            // A failed stab — same forward-and-down dive as the real sting
            // (see sting() below) but nothing to catch yet, so it whiffs.
            .to(bee.rotation, { x: 0.45, duration: 0.08, ease: 'power2.out' })
            .to(bee.position, { z: '+=0.15', duration: 0.08, ease: 'power2.out' }, '<')
            .to(bee.rotation, { x: 0, duration: 0.22, ease: 'power2.inOut' })
            .to(bee.position, { z: '-=0.15', duration: 0.22, ease: 'power2.inOut' }, '<');
    }

    function beginChase() {
        isChasing = true;
        if (choreo) choreo.setChasing(true);
        crossfadeTo('hover', 0.2);
        const hover = actions['hover'];
        if (hover) hover.timeScale = CHASE_TIMESCALE;
        document.dispatchEvent(new CustomEvent('bee:chase-start'));
    }

    function updateChase(dt) {
        // NOTE: getBoundingClientRect() returns the element's box AFTER the
        // CSS "rotate" transform (from the waypoint's banking tilt) is
        // applied — for a rotated square that box is measurably WIDER/
        // TALLER than the real on-screen size (up to ~40px extra at a 45°
        // lean). rect.left/rect.top + half of that inflated rect.width/
        // rect.height still correctly locates the visual CENTER (rotating
        // about the center point doesn't move it), so it's safe to use for
        // measuring. But writing a new position back using rect.width/
        // rect.height divides by the wrong (inflated) size and places the
        // box tens of pixels off — that's what made this only work on the
        // waypoints with rot: 0 (nothing to inflate the bounding box) and
        // go sideways everywhere else. Fix: convert the new center back to
        // left/top using the element's true, unrotated size instead.
        const rect = container.getBoundingClientRect();
        const w = container.offsetWidth; // true, unrotated size
        const h = container.offsetHeight;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = mousePos.x - cx;
        const dy = mousePos.y - cy;
        const dist = Math.hypot(dx, dy);

        // Turn to face the direction of travel (and thus the cursor) while
        // hunting — overrides the passive mouse-look for a more purposeful feel.
        if (bee && dist > 2) {
            const targetYaw = Math.atan2(dx, 400); // rough left/right lean toward cursor
            bee.rotation.y = THREE.MathUtils.lerp(bee.rotation.y, targetYaw, 0.15);
        }

        if (dist <= STING_DISTANCE) {
            sting(cx, cy);
            return;
        }

        // Fixed top speed rather than "close X% of the gap per frame": that
        // proportional approach converges almost instantly and never gives
        // the mouse a real chance to run. Here the bee covers at most
        // CHASE_SPEED px/second, capped so it never overshoots the cursor.
        const maxStep = CHASE_SPEED * dt;
        const travel = Math.min(maxStep, dist);
        const ux = dx / dist;
        const uy = dy / dist;

        const newCenterX = cx + ux * travel;
        const newCenterY = cy + uy * travel;

        container.style.left = newCenterX - w / 2 + 'px';
        container.style.top = newCenterY - h / 2 + 'px';
    }

    function sting(x, y) {
        isChasing = false;
        stingCooldown = true;
        const hover = actions['hover'];
        if (hover) hover.timeScale = 1;

        // Hand rotation control back to the passive mouse-look system
        // starting from wherever the chase left it, so the head doesn't
        // visibly snap the instant the chase ends.
        if (bee) {
            facingState.y = bee.rotation.y;
            mouseYawOffset = 0;
            mouseYawTarget = 0;
        }

        document.dispatchEvent(new CustomEvent('bee:sting', { detail: { x, y } }));

        // The model's GLB only ships "hover" / "idle" / "take_off_and_land" —
        // there's no dedicated sting clip baked into the rig, so we can't
        // just play one. Instead we fake the motion procedurally: a fast
        // forward-and-down dive of the whole model, then a spring back —
        // driven directly on bee.rotation/bee.position rather than the
        // skeletal animation system. If you ever add a real rigged "sting"
        // clip in Blender/Mixamo and export it into the GLB, swap this out
        // for crossfadeTo('sting', 0.05) instead — it'll slot in exactly
        // like the other three clips.
        if (bee && window.gsap) {
            window.gsap.timeline()
                .to(bee.rotation, { x: 0.55, duration: 0.08, ease: 'power2.out' })
                .to(bee.position, { y: '-=0.14', z: '+=0.2', duration: 0.08, ease: 'power2.out' }, '<')
                .to(bee.rotation, { x: 0, duration: 0.3, ease: 'elastic.out(1, 0.5)' })
                .to(bee.position, { y: '+=0.14', z: '-=0.2', duration: 0.3, ease: 'power2.inOut' }, '<');
        }

        // A quick "impact" punch on the container — scale up then settle —
        // using GSAP if it's available, otherwise just skip the flourish.
        if (window.gsap) {
            window.gsap.timeline()
                .to(container, { scale: 1.35, duration: 0.12, ease: 'power1.out' })
                .to(container, { scale: 1, duration: 0.3, ease: 'power2.out' });
        }
        crossfadeTo('idle', 0.3);

        setTimeout(() => {
            if (choreo) {
                choreo.setChasing(false);
                choreo.flyToLast();
            }
            stingCooldown = false;
        }, STING_RETURN_DELAY);
    }

    // ---- Mouse/touch interaction directly on the bee -------------------
    // The container stays pointer-events:none (so it never blocks clicks on
    // your page underneath), but the small canvas itself can safely opt
    // back in — it's only ~210px and moves with scroll/chase, so this
    // doesn't interfere with the rest of the site.
    canvas.style.pointerEvents = 'auto';
    canvas.style.cursor = 'pointer';

    canvas.addEventListener('mouseenter', () => {
        if (!isChasing && !isWindingUp) crossfadeTo('hover', 0.3);
    });
    canvas.addEventListener('mouseleave', () => {
        if (!isChasing && !isWindingUp) crossfadeTo('idle', 0.4);
    });
    canvas.addEventListener('click', onBeeClick);

    // Pause rendering when the tab isn't visible (saves battery/CPU)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        } else if (!document.hidden && mixer) {
            startRenderLoop();
        }
    });
}

// ---- Scroll choreography: fly between waypoints -------------------------
// Returns { flyToLast, setChasing } so init() can pause section-flights
// during a chase and resume/reposition afterward.
function setupScrollChoreography(container, facingState) {
    if (!window.gsap || !window.ScrollTrigger) {
        console.warn('[bee-controller] GSAP/ScrollTrigger not found — bee will stay put.');
        return { flyToLast: () => {}, setChasing: () => {} };
    }
    const { gsap, ScrollTrigger } = window;

    let chasing = false;
    let lastWaypoint = WAYPOINTS[0];

    // Start parked at the hero waypoint
    gsap.set(container, {
        left: WAYPOINTS[0].x,
        top: WAYPOINTS[0].y,
        rotate: WAYPOINTS[0].rot,
    });
    facingState.y = WAYPOINTS[0].facing ?? facingState.y;

    WAYPOINTS.forEach((wp) => {
        const el = document.querySelector(wp.trigger);
        if (!el) return; // section not present on this page — skip safely

        ScrollTrigger.create({
            trigger: wp.trigger,
            start: 'top center',
            end: 'bottom center',
            onEnter: () => flyTo(wp),
            onEnterBack: () => flyTo(wp),
        });
    });

    function flyTo(wp) {
        lastWaypoint = wp; // always track this, even mid-chase
        if (chasing) return; // don't yank the bee away from the hunt

        document.dispatchEvent(new CustomEvent('bee:flying'));
        gsap.to(container, {
            left: wp.x,
            top: wp.y,
            rotate: wp.rot,
            duration: 1.1,
            ease: 'power2.inOut',
            onComplete: () => document.dispatchEvent(new CustomEvent('bee:arrived')),
        });

        if (typeof wp.facing === 'number') {
            gsap.to(facingState, {
                y: wp.facing,
                duration: 1.1,
                ease: 'power2.inOut',
            });
        }
    }

    return {
        setChasing(v) {
            chasing = v;
            if (v) gsap.killTweensOf(container); // hand control to the chase loop
        },
        flyToLast() {
            flyTo(lastWaypoint);
        },
    };
}

// Small bridge so the two independent concerns (animation clips vs. CSS
// position) can talk to each other without tangling the code above.
document.addEventListener('bee:flying', () => window.__beeCrossfade?.('hover', 0.35));
document.addEventListener('bee:arrived', () => window.__beeCrossfade?.('idle', 0.5));