/**
 * Flying Bee Guide — vanilla three.js (no React, no bundler)
 * -----------------------------------------------------------------------
 * - Loads honey_bee.glb (clips found inside: "hover", "idle", "take_off_and_land")
 * - Plays "take_off_and_land" once the page finishes loading, then settles
 *   into a looping "idle"
 * - On scroll, GSAP ScrollTrigger flies the bee's on-screen position from
 *   waypoint to waypoint (one per section) so it looks like it's guiding /
 *   pointing at whatever text is currently on screen
 * - Renders into a small fixed-size <canvas> that sits inside a
 *   position:fixed div — we move that DIV with CSS (via GSAP), not the
 *   3D camera. This keeps the whole thing simple and resolution-independent.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = 'public/models/honey_bee-new.glb';
const RENDER_SIZE = 210; // keep in sync with #bee-container size in CSS

// ---- Waypoints: one per section, tuned to sit near that section's copy.
// x / y are viewport percentages (CSS left/top), rot is the 2D CSS tilt
// (deg) applied to the whole #bee-container — a "banking" lean as it moves.
// facing is the 3D THREE.js yaw (radians) applied to the bee MODEL itself —
// this is what actually turns the bee to look left/right/toward the camera
// while it's parked at that section. Omit facing on a waypoint to keep
// whatever angle it already had (no snap).
//   0            -> facing the camera head-on
//   Math.PI / 2  -> profile, facing screen-right
//  -Math.PI / 2  -> profile, facing screen-left
//   Math.PI / 4  -> 3/4 view facing screen-right
//  -Math.PI / 4  -> 3/4 view facing screen-left
//   Math.PI      -> facing away from camera
const WAYPOINTS = [
    { trigger: '#hero-track', x: '178vw', y: '58vh', rot: -50, facing: Math.PI / 2 },
    { trigger: '#explainer-section', x: '10vw', y: '5vh', rot: -15, facing: Math.PI / 4 },
    { trigger: '#collection-rail-track', x: '85vw', y: '75vh', rot: -10, facing: -Math.PI / 4 },
    { trigger: '#ritual-section', x: '18vw', y: '3vh', rot: -10, facing: Math.PI / 4 },
    { trigger: '#statement-section', x: '50vw', y: '22vh', rot: 0, facing: 0 },
    { trigger: '#reverse-columns-section', x: '20vw', y: '65vh', rot: -6, facing: Math.PI / 4 },
    { trigger: '#grid-section', x: '80vw', y: '18vh', rot: 8, facing: -Math.PI / 4 },
    { trigger: '#newsletter-section', x: '60vw', y: '55vh', rot: 0, facing: 0 },
];

init();

async function init() {
    const container = document.getElementById('bee-container');
    const canvas = document.getElementById('bee-canvas');
    if (!container || !canvas) return;

    // ---- Scene / camera / renderer -----------------------------------
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0.35, 3.2);
    // If you'd rather orbit the CAMERA around the bee instead of turning the
    // model (see bee.rotation.y below), move camera.position off-axis, e.g.
    // camera.position.set(2.2, 0.6, 2.2), and add camera.lookAt(0, 0, 0)
    // right after. Only use one approach at a time — mixing both just
    // compounds the angle in a confusing way.

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

    const loader = new GLTFLoader();
    loader.load(
        MODEL_URL,
        (gltf) => {
            bee = gltf.scene;
            bee.scale.setScalar(0.75); // tune to fill the 190px frame nicely
            bee.position.set(0, -0.15, 0);
            // Rotate the bee itself so a different side faces the camera —
            // the model faces straight at the lens (0°) by default. Try:
            //   Math.PI / 2   -> profile view, facing screen-right
            //  -Math.PI / 2   -> profile view, facing screen-left
            //   Math.PI / 4   -> 3/4 view (usually the most flattering for flight)
            //   Math.PI       -> facing directly away from camera
            bee.rotation.y = Math.PI / 4;
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

            // Idle gentle bob so the bee never looks frozen, even between clips
            startRenderLoop();

            // Play the take-off clip once the loader/hero UI has revealed itself
            // (main.js dispatches this the moment it hides the loading screen).
            document.addEventListener('site:loaded', takeOff, { once: true });
            console.log("takeOff");
            // Safety net: don't leave the bee invisible forever if that event
            // never fires for some reason (e.g. main.js changes in the future).
            setTimeout(() => {
                if (!activeAction) takeOff();
            }, 4000);

            setupScrollChoreography(container, bee);
        },
        undefined,
        (err) => console.error('[bee-controller] failed to load honey_bee.glb', err)
    );

    function takeOff() {
        container.classList.add('bee-ready');
        console.log(container);
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
    // Exposed so the scroll-choreography code below (which only deals with
    // CSS position) can also nudge which animation clip is playing.
    window.__beeCrossfade = crossfadeTo;

    let rafId = null;
    function startRenderLoop() {
        if (rafId) return;
        const tick = () => {
            rafId = requestAnimationFrame(tick);
            const dt = clock.getDelta();
            if (mixer) mixer.update(dt);
            renderer.render(scene, camera);
        };
        tick();
    }

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
function setupScrollChoreography(container, bee) {
    if (!window.gsap || !window.ScrollTrigger) {
        console.warn('[bee-controller] GSAP/ScrollTrigger not found — bee will stay put.');
        return;
    }
    const { gsap, ScrollTrigger } = window;

    // Start parked at the hero waypoint
    gsap.set(container, {
        left: WAYPOINTS[0].x,
        top: WAYPOINTS[0].y,
        rotate: WAYPOINTS[0].rot,
    });
    if (bee && typeof WAYPOINTS[0].facing === 'number') {
        bee.rotation.y = WAYPOINTS[0].facing;
    }

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
        // switch to the "hover" clip while it's mid-flight, back to "idle" on arrival
        document.dispatchEvent(new CustomEvent('bee:flying'));
        gsap.to(container, {
            left: wp.x,
            top: wp.y,
            rotate: wp.rot,
            duration: 1.1,
            ease: 'power2.inOut',
            onComplete: () => document.dispatchEvent(new CustomEvent('bee:arrived')),
        });

        // Turn the 3D model itself to face the direction set for this
        // section. This is a separate tween from the CSS move above: gsap
        // can animate any numeric object property, not just DOM elements,
        // so it happily tweens bee.rotation.y (a THREE.js Euler component)
        // the same way it tweens container.style.left.
        if (bee && typeof wp.facing === 'number') {
            gsap.to(bee.rotation, {
                y: wp.facing,
                duration: 1.1,
                ease: 'power2.inOut',
            });
        }
    }
}

// Small bridge so the two independent concerns (animation clips vs. CSS
// position) can talk to each other without tangling the code above.
document.addEventListener('bee:flying', () => window.__beeCrossfade?.('hover', 0.35));
document.addEventListener('bee:arrived', () => window.__beeCrossfade?.('idle', 0.5));