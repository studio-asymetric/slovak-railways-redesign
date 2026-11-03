import Lenis from 'lenis';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Showcase order — front-car model IDs for studio (always cab / front segment). */
export const SHOWCASE_VEHICLES = [
    { anchor: 'vehicle-kiss', modelId: 'KissPredok' },
    { anchor: 'vehicle-tatra', modelId: 'tatra' },
    { anchor: 'vehicle-delfin', modelId: 'delfin' },
    { anchor: 'vehicle-dmu861', modelId: 'dmu861zaciatok' },
    { anchor: 'vehicle-panter', modelId: 'panterPredok' },
    { anchor: 'vehicle-janosik', modelId: 'janosikpredok' },
    { anchor: 'vehicle-vectron', modelId: 'lok383' },
    { anchor: 'vehicle-dmu810', modelId: 'dmu810' },
    { anchor: 'vehicle-lok363', modelId: 'lok363' },
    { anchor: 'vehicle-lok754', modelId: 'lok754' },
    { anchor: 'vehicle-lok380', modelId: 'lok380' },
    { anchor: 'vehicle-lok240', modelId: 'lok240' },
    { anchor: 'vehicle-lok210', modelId: 'lok210' },
];

let lenisMain = null;
let lenisRafId = null;
let studioRenderer = null;
let studioComposer = null;
let studioScene = null;
let studioCamera = null;
let studioModel = null;
let studioPivot = null;   // permanent Group; model is positioned inside it so its bbox centre aligns with pivot origin
let studioReflectionPivot = null;
let studioReflectionModel = null;
let studioFloor = null;
let studioAnimId = null;
let studioClock = null;
let studioResizeObserver = null;
let studioHostEl = null;
let studioVisibilityObserver = null;
let activeShowcaseIndex = -1;
let studioLoadSeq = 0;      // incremented on every load request; stale loads self-discard
const studioTemplateCache = new Map();
const studioPackCache = new Map();
const studioPackPending = new Map();

const STUDIO_DESKTOP_MQ = window.matchMedia('(min-width: 900px)');

let studioResumePending = false;
let studioSceneReadyAt = 0;
let studioComposerWarmed = false;

function studioDebugLog(location, message, data, hypothesisId) {
    const payload = {
        sessionId: 'efc220',
        location,
        message,
        data,
        hypothesisId,
        timestamp: Date.now(),
    };
    console.log(`[studio] ${message}`, data);
    // #region agent log
    fetch('http://127.0.0.1:7325/ingest/fa5556a7-8007-464a-8834-2fbd06697d84', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'efc220' },
        body: JSON.stringify(payload),
    }).catch(() => {});
    // #endregion
}

function getStudioPreloadState() {
    return {
        packsCached: studioPackCache.size,
        packsPending: studioPackPending.size,
        packsTotal: SHOWCASE_VEHICLES.length,
        activeModelId: studioModel?.userData?.modelId ?? null,
        rendering: studioAnimId !== null,
        msSinceSceneReady: studioSceneReadyAt ? Math.round(performance.now() - studioSceneReadyAt) : null,
    };
}

let studioCameraLookAt = new THREE.Vector3(0, 0.85, 0);
const studioFloorClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

const _studioMetricsBox = new THREE.Box3();
const _studioMeshBox = new THREE.Box3();
const _studioLocalMatrix = new THREE.Matrix4();
const _studioInvRoot = new THREE.Matrix4();
const _studioMetricsSize = new THREE.Vector3();
const _studioMetricsCenter = new THREE.Vector3();

/** Same local-space bbox logic as hero canvas — independent of GLB pivot placement. */
function computeStudioGeometryMetrics(root) {
    _studioMetricsBox.makeEmpty();
    root.updateMatrixWorld(true);
    _studioInvRoot.copy(root.matrixWorld).invert();

    root.traverse((node) => {
        if (!node.isMesh || !node.geometry) return;
        const geometry = node.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        _studioMeshBox.copy(geometry.boundingBox);
        _studioLocalMatrix.multiplyMatrices(_studioInvRoot, node.matrixWorld);
        _studioMeshBox.applyMatrix4(_studioLocalMatrix);
        _studioMetricsBox.union(_studioMeshBox);
    });

    if (_studioMetricsBox.isEmpty()) {
        _studioMetricsBox.setFromObject(root);
    }

    _studioMetricsBox.getSize(_studioMetricsSize);
    _studioMetricsBox.getCenter(_studioMetricsCenter);

    return {
        centerLocal: _studioMetricsCenter.clone(),
        localBox: _studioMetricsBox.clone(),
        size: _studioMetricsSize.clone(),
    };
}

export function getLenis() {
    return lenisMain;
}

/** Snappier than Lenis defaults — higher lerp, slightly stronger wheel. */
const LENIS_LERP = 0.18;
const LENIS_WHEEL_MULTIPLIER = 1.08;
const LENIS_SCROLL_TO_DURATION = 0.75;

export function initGlobalLenis({ autoStart = true } = {}) {
    if (!lenisMain) {
        lenisMain = new Lenis({
            lerp: LENIS_LERP,
            smoothWheel: true,
            wheelMultiplier: LENIS_WHEEL_MULTIPLIER,
        });
    }

    if (autoStart) startGlobalLenis();
    return lenisMain;
}

/** Start Lenis rAF loop (safe to call multiple times). */
export function startGlobalLenis() {
    if (!lenisMain) initGlobalLenis({ autoStart: false });
    if (lenisRafId != null) {
        lenisMain.start();
        return lenisMain;
    }

    lenisMain.start();
    const raf = (time) => {
        lenisMain?.raf(time);
        lenisRafId = requestAnimationFrame(raf);
    };
    lenisRafId = requestAnimationFrame(raf);
    return lenisMain;
}

/** Stop Lenis and cancel its rAF loop so WebGL loops don't compete on the main thread. */
export function stopGlobalLenis() {
    if (!lenisMain) return;
    lenisMain.stop();
    if (lenisRafId != null) {
        cancelAnimationFrame(lenisRafId);
        lenisRafId = null;
    }
}

export function scrollToElement(el, { offset = 0, immediate = false } = {}) {
    if (!el) return;
    if (lenisMain) {
        lenisMain.scrollTo(el, { offset, immediate, duration: immediate ? 0 : LENIS_SCROLL_TO_DURATION });
    } else {
        const top = el.getBoundingClientRect().top + window.scrollY + offset;
        window.scrollTo({ top, behavior: immediate ? 'auto' : 'smooth' });
    }
}

export function scrollToSelector(selector, options = {}) {
    scrollToElement(document.querySelector(selector), options);
}

/** Split loaded article HTML into per-vehicle panels inside #showcase-panels. */
export function buildShowcasePanels(articleEl, panelsHost) {
    if (!articleEl || !panelsHost) return;

    const children = [...articleEl.children];
    const headerBlock = document.createElement('div');
    headerBlock.className = 'showcase-section-header';

    const panels = [];
    let current = null;
    let headerDone = false;

    for (const node of children) {
        const isVehicle = node.id && node.id.startsWith('vehicle-');

        if (!headerDone && !isVehicle) {
            headerBlock.appendChild(node.cloneNode(true));
            continue;
        }
        headerDone = true;

        if (isVehicle) {
            current = document.createElement('article');
            current.className = 'showcase-panel';
            current.id = node.id;
            const vehicle = SHOWCASE_VEHICLES.find((v) => v.anchor === node.id);
            if (vehicle) current.dataset.modelId = vehicle.modelId;
            current.appendChild(node.cloneNode(true));
            panels.push(current);
            continue;
        }

        if (current) {
            current.appendChild(node.cloneNode(true));
        } else {
            headerBlock.appendChild(node.cloneNode(true));
        }
    }

    const section = document.getElementById('thesis-new_visual');
    const headerHost = section?.querySelector('.showcase-section-header-host');
    if (headerHost) headerHost.replaceChildren(headerBlock);
    else if (headerBlock.childNodes.length) panelsHost.before(headerBlock);

    panelsHost.replaceChildren(...panels);
    articleEl.replaceChildren();
}

// Compound logical IDs whose studio display is a full multi-segment train.
// Segment order is front → rear.
const STUDIO_COMPOUND_UNITS = {
    tatra:  ['tatra1', 'tatra2', 'tatra3'],
    delfin: ['delfin1', 'delfin2', 'delfin3'],
};

async function loadStudioTemplate(modelId, createTrainModel) {
    if (!studioTemplateCache.has(modelId)) {
        const model = await createTrainModel(modelId);
        studioTemplateCache.set(modelId, model);
    }
    return studioTemplateCache.get(modelId);
}

/**
 * Build a single Group with all segments placed end-to-end along the Z axis
 * (the train running direction used by the hero canvas). The group is then
 * rotated 90° around Y so the side of the train faces the camera.
 */
async function buildCompoundStudioModel(logicalId, createTrainModel) {
    const segIds = STUDIO_COMPOUND_UNITS[logicalId];
    const group = new THREE.Group();
    group.userData.modelId = logicalId;

    let offsetZ = 0;
    for (const segId of segIds) {
        const tmpl = await loadStudioTemplate(segId, createTrainModel);
        await yieldToMain();
        const seg = tmpl.clone(true);
        seg.userData.modelId = segId;

        // Measure Z-axis bounds in the segment's own local space.
        const segMetrics = computeStudioGeometryMetrics(seg);

        // Place the segment so its bbox min.z lands exactly at offsetZ.
        // seg's local origin lands at: offsetZ - localBox.min.z
        seg.position.set(0, 0, offsetZ - segMetrics.localBox.min.z);
        offsetZ += segMetrics.size.z;

        group.add(seg);
    }

    // Rotate 90° so the train side faces the camera (camera looks down -Z).
    group.rotation.y = Math.PI / 2;

    return group;
}

function disposeModel(model) {
    model.traverse((node) => {
        if (!node.isMesh) return;
        node.geometry?.dispose();
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach((m) => m?.dispose());
    });
}

const _idleCallback = typeof requestIdleCallback === 'function'
    ? (fn, opts) => requestIdleCallback(fn, opts)
    : (fn) => setTimeout(fn, 16);

function yieldToMain() {
    return new Promise((resolve) => {
        _idleCallback(() => resolve(), { timeout: 48 });
    });
}

function applyStudioFitTransforms(model) {
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    model.updateMatrixWorld(true);

    const metrics = computeStudioGeometryMetrics(model);
    const maxDim = Math.max(metrics.size.x, metrics.size.y, metrics.size.z);
    const scale = 4.2 / Math.max(maxDim, 0.001);
    model.scale.setScalar(scale);
    model.position.copy(metrics.centerLocal).multiplyScalar(-scale);

    return scale * (metrics.localBox.min.y - metrics.centerLocal.y);
}

function buildStudioReflection(main, floorLocalY) {
    const reflectionPivot = new THREE.Group();
    reflectionPivot.name = 'studioReflectionPivot';
    reflectionPivot.position.set(0, floorLocalY * 2, 0);
    reflectionPivot.scale.set(1, -1, 1);

    const reflection = main.clone(true);
    reflection.position.copy(main.position);
    reflection.rotation.copy(main.rotation);
    reflection.scale.copy(main.scale);
    configureStudioReflectionModel(reflection);
    reflectionPivot.add(reflection);

    return { reflectionPivot, reflection };
}

async function prepareStudioPack(modelId, createTrainModel) {
    if (studioPackCache.has(modelId)) return studioPackCache.get(modelId);
    if (studioPackPending.has(modelId)) return studioPackPending.get(modelId);

    const task = (async () => {
        const t0 = performance.now();
        let main;
        if (STUDIO_COMPOUND_UNITS[modelId]) {
            main = await buildCompoundStudioModel(modelId, createTrainModel);
        } else {
            const template = await loadStudioTemplate(modelId, createTrainModel);
            await yieldToMain();
            main = template.clone(true);
            main.userData.modelId = modelId;
        }
        configureStudioModel(main);
        const floorLocalY = applyStudioFitTransforms(main);
        await yieldToMain();

        const { reflectionPivot, reflection } = buildStudioReflection(main, floorLocalY);
        await yieldToMain();

        const pack = { modelId, main, reflectionPivot, reflection, floorLocalY };
        studioPackCache.set(modelId, pack);
        studioDebugLog('studio-showcase.js:prepareStudioPack', 'pack ready', {
            modelId,
            prepareMs: Math.round(performance.now() - t0),
            ...getStudioPreloadState(),
        }, 'H1');
        return pack;
    })();

    studioPackPending.set(modelId, task);
    try {
        return await task;
    } catch (err) {
        studioPackPending.delete(modelId);
        throw err;
    } finally {
        studioPackPending.delete(modelId);
    }
}

function warmStudioPack(pack) {
    if (!studioRenderer || !studioScene || !studioCamera || !pack) return;

    const t0 = performance.now();
    const warmGroup = new THREE.Group();
    warmGroup.position.set(0, -9999, 0);
    studioScene.add(warmGroup);

    // Clone graphs so GPU compile never steals the live pack from studioPivot.
    const mainClone = pack.main.clone(true);
    const reflectionClone = pack.reflectionPivot.clone(true);
    warmGroup.add(mainClone);
    warmGroup.add(reflectionClone);

    studioRenderer.compile(studioScene, studioCamera);

    warmGroup.remove(mainClone);
    warmGroup.remove(reflectionClone);
    studioScene.remove(warmGroup);

    studioDebugLog('studio-showcase.js:warmStudioPack', 'gpu compile done', {
        modelId: pack.modelId,
        warmMs: Math.round(performance.now() - t0),
        mainOnPivot: pack.main.parent === studioPivot,
        ...getStudioPreloadState(),
    }, 'H5');
}

/** One off-screen composer render during idle preload — warms bloom + shadow maps. */
function warmStudioComposer() {
    if (!studioComposer || studioComposerWarmed || !studioModel) return;

    const t0 = performance.now();
    studioComposer.render();
    studioComposerWarmed = true;

    studioDebugLog('studio-showcase.js:warmStudioComposer', 'composer warmed', {
        warmMs: Math.round(performance.now() - t0),
        mainOnPivot: studioModel?.parent === studioPivot,
        ...getStudioPreloadState(),
    }, 'H2');
}

function detachCurrentStudioPack() {
    if (studioModel?.parent === studioPivot) studioPivot.remove(studioModel);
    if (studioReflectionPivot?.parent === studioPivot) studioPivot.remove(studioReflectionPivot);
    studioModel = null;
    studioReflectionPivot = null;
    studioReflectionModel = null;
}

function applyStudioPack(pack) {
    if (!pack || !studioPivot) return;

    detachCurrentStudioPack();

    studioModel = pack.main;
    studioReflectionPivot = pack.reflectionPivot;
    studioReflectionModel = pack.reflection;
    studioPivot.add(studioModel);
    studioPivot.add(studioReflectionPivot);

    if (studioFloor) {
        studioFloor.position.y = pack.floorLocalY;
        studioFloorClipPlane.constant = pack.floorLocalY;
    }

    studioCameraLookAt.set(0, 0, 0);
    studioCamera.position.set(0, 0, 5.8);
    studioCamera?.lookAt(studioCameraLookAt);
}

function prefetchStudioNeighbors(centerIndex, createTrainModel) {
    [centerIndex - 1, centerIndex + 1].forEach((i) => {
        const vehicle = SHOWCASE_VEHICLES[i];
        if (!vehicle || studioPackCache.has(vehicle.modelId) || studioPackPending.has(vehicle.modelId)) return;
        prepareStudioPack(vehicle.modelId, createTrainModel).catch(() => {});
    });
}

async function setStudioModel(modelId, createTrainModel) {
    if (!studioScene || !STUDIO_DESKTOP_MQ.matches) return;

    const seq = ++studioLoadSeq;
    const t0 = performance.now();
    const cacheHit = studioPackCache.has(modelId);

    try {
        const pack = cacheHit
            ? studioPackCache.get(modelId)
            : await prepareStudioPack(modelId, createTrainModel);

        if (seq !== studioLoadSeq) return;
        applyStudioPack(pack);
        studioDebugLog('studio-showcase.js:setStudioModel', 'model applied', {
            modelId,
            cacheHit,
            applyMs: Math.round(performance.now() - t0),
            ...getStudioPreloadState(),
        }, cacheHit ? 'H3' : 'H1');
    } catch (err) {
        console.warn('Studio model load failed:', modelId, err);
    }
}

function configureStudioModel(model) {
    model.traverse((node) => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
    });
}

function configureStudioReflectionModel(model) {
    model.traverse((node) => {
        if (!node.isMesh || !node.material) return;
        node.castShadow = false;
        node.receiveShadow = false;
        node.renderOrder = 0;

        const mats = Array.isArray(node.material) ? node.material : [node.material];
        const cloned = mats.map((mat) => {
            const m = mat.clone();
            m.clippingPlanes = [studioFloorClipPlane];
            m.clipShadows = true;
            m.transparent = false;
            m.opacity = 1;
            return m;
        });
        node.material = cloned.length === 1 ? cloned[0] : cloned;
    });
}

/**
 * Build fitted studio packs during idle time so switching only attaches cached graphs.
 */
function scheduleBackgroundPreload(createTrainModel) {
    const queue = SHOWCASE_VEHICLES.filter((v) => !studioPackCache.has(v.modelId));

    let i = 0;

    function loadNext() {
        if (i >= queue.length || !studioRenderer || !studioScene || !studioCamera) return;
        const v = queue[i++];
        if (studioPackCache.has(v.modelId)) {
            _idleCallback(loadNext, { timeout: 4000 });
            return;
        }

        prepareStudioPack(v.modelId, createTrainModel)
            .then((pack) => warmStudioPack(pack))
            .catch(() => {})
            .finally(() => { _idleCallback(loadNext, { timeout: 4000 }); });
    }

    _idleCallback(loadNext, { timeout: 2000 });
}

function studioAnimate() {
    studioAnimId = null;
    if (!studioRenderer || !STUDIO_DESKTOP_MQ.matches || !studioHostEl) return;

    const frameStart = performance.now();
    const isResumeFrame = studioResumePending;
    if (isResumeFrame) {
        studioResumePending = false;
        studioDebugLog('studio-showcase.js:studioAnimate', 'first frame after resume', getStudioPreloadState(), 'H2');
    }

    if (studioPivot) studioPivot.rotation.y += 0.001;
    const renderStart = performance.now();
    if (studioComposer) {
        studioComposer.render();
    } else {
        studioRenderer.render(studioScene, studioCamera);
    }
    const renderMs = Math.round(performance.now() - renderStart);
    const frameMs = Math.round(performance.now() - frameStart);
    if (isResumeFrame || renderMs > 12) {
        studioDebugLog('studio-showcase.js:studioAnimate', 'render timing', {
            renderMs,
            frameMs,
            isResumeFrame,
            ...getStudioPreloadState(),
        }, 'H2');
    }

    studioAnimId = requestAnimationFrame(studioAnimate);
}

function startStudioRender() {
    if (studioAnimId !== null || !studioRenderer) return;
    studioResumePending = true;
    studioDebugLog('studio-showcase.js:startStudioRender', 'render loop starting', getStudioPreloadState(), 'H4');
    studioClock?.getDelta();
    studioAnimId = requestAnimationFrame(studioAnimate);
}

function stopStudioRender() {
    if (studioAnimId === null) return;
    cancelAnimationFrame(studioAnimId);
    studioAnimId = null;
    studioDebugLog('studio-showcase.js:stopStudioRender', 'render loop stopped', getStudioPreloadState(), 'H4');
}

function initStudioVisibility(hostEl) {
    studioHostEl = hostEl;
    const layout = hostEl.closest('.showcase-layout') || hostEl.closest('#thesis-new_visual');
    if (!layout) return;

    studioVisibilityObserver?.disconnect();
    studioVisibilityObserver = new IntersectionObserver(([entry]) => {
        studioDebugLog('studio-showcase.js:initStudioVisibility', 'visibility change', {
            inView: entry.isIntersecting,
            intersectionRatio: entry.intersectionRatio,
            ...getStudioPreloadState(),
        }, 'H4');
        if (entry.isIntersecting) {
            startStudioRender();
        } else {
            stopStudioRender();
        }
    }, { threshold: 0.02 });
    studioVisibilityObserver.observe(layout);
}

function initStudioScene(hostEl, createTrainModel) {
    if (!hostEl || studioRenderer) return;

    studioScene = new THREE.Scene();
    studioScene.background = new THREE.Color(0x111111);

    // Persistent pivot — model is placed inside this so its bbox centre aligns
    // with the pivot's Y-axis. Rotating the pivot gives a clean turntable spin.
    studioPivot = new THREE.Group();
    studioScene.add(studioPivot);

    const wrapEl = hostEl.parentElement;
    const w = hostEl.clientWidth || wrapEl?.clientWidth || 400;
    const h = hostEl.clientHeight || wrapEl?.clientHeight || window.innerHeight;
    studioCamera = new THREE.PerspectiveCamera(36, w / h, 0.1, 100);
    studioCamera.position.set(0, 0.9, 5.8);

    studioRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    studioRenderer.setSize(w, h);
    studioRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    studioRenderer.shadowMap.enabled = true;
    studioRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    studioRenderer.localClippingEnabled = true;
    studioRenderer.toneMapping = THREE.NoToneMapping; // OutputPass handles ACES
    hostEl.appendChild(studioRenderer.domElement);

    // ── Post-processing ─────────────────────────────────────────────────────
    studioComposer = new EffectComposer(studioRenderer);
    studioComposer.addPass(new RenderPass(studioScene, studioCamera));

    const studioBloom = new UnrealBloomPass(
        new THREE.Vector2(w, h),
        0.22,   // strength
        0.45,   // radius
        0.92,   // threshold — only the brightest spots bloom
    );
    studioComposer.addPass(studioBloom);

    const studioOutput = new OutputPass();
    studioOutput.toneMappingExposure = 0.88;
    studioComposer.addPass(studioOutput);

    // ── Lighting ─────────────────────────────────────────────────────────────
    // Sky/ground hemisphere for a gentle ambient gradient
    const hemi = new THREE.HemisphereLight(0x141820, 0x020202, 1);
    studioScene.add(hemi);

    // Key — warm soft-box from upper-right-front
    const key = new THREE.DirectionalLight(0xfff4d0, 4.6);
    key.position.set(5, 8, 4);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.width  = 2048;
    key.shadow.mapSize.height = 2048;
    key.shadow.camera.near   = 0.5;
    key.shadow.camera.far    = 40;
    key.shadow.camera.left   = -8;
    key.shadow.camera.right  = 8;
    key.shadow.camera.top    = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.bias          = -0.0002;
    key.shadow.normalBias    = 0.006;
    key.shadow.radius        = 3;
    studioScene.add(key);
    studioScene.add(key.target);

    // Ground bounce — very subtle warm fill from below
    const bounce = new THREE.DirectionalLight(0xff9966, 0.38);
    bounce.position.set(0, -4, 3);
    studioScene.add(bounce);

    // ── Floor ────────────────────────────────────────────────────────────────
    // Semi-transparent grey plane — the mirrored clone beneath reads as reflection.
    studioFloor = new THREE.Group();

    const floorPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.MeshBasicMaterial({
            color: 0x111111,
            transparent: true,
            opacity: 0.97,
            depthWrite: false,
        }),
    );
    floorPlane.rotation.x = -Math.PI / 2;
    floorPlane.receiveShadow = true;
    floorPlane.renderOrder = 2;
    studioFloor.add(floorPlane);

    const shadowCatcher = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.ShadowMaterial({ opacity: 0.75, transparent: true, color: 0x000000 }),
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = 0.002;
    shadowCatcher.receiveShadow = true;
    shadowCatcher.renderOrder = 3;
    studioFloor.add(shadowCatcher);

    studioScene.add(studioFloor);

    // ── Environment map ──────────────────────────────────────────────────────
    new RGBELoader().load('dark_autumn_forest_1k.hdr', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        studioScene.environment = texture;
        studioScene.environmentIntensity = 0.3;
    });

    studioClock = new THREE.Clock();

    // Prepare all showcase packs in the background while rendering stays paused.
    scheduleBackgroundPreload(createTrainModel);

    const firstVehicle = SHOWCASE_VEHICLES[0];
    if (firstVehicle) {
        prepareStudioPack(firstVehicle.modelId, createTrainModel)
            .then((pack) => {
                applyStudioPack(pack);
                warmStudioPack(pack);
                warmStudioComposer();
            })
            .catch(() => {});
    }

    studioResizeObserver = new ResizeObserver(() => {
        if (!studioRenderer || !studioCamera) return;
        const cw = hostEl.clientWidth || wrapEl?.clientWidth || 0;
        const ch = hostEl.clientHeight || wrapEl?.clientHeight || 0;
        if (cw < 1 || ch < 1) return;
        studioCamera.aspect = cw / ch;
        studioCamera.updateProjectionMatrix();
        studioRenderer.setSize(cw, ch);
        studioComposer?.setSize(cw, ch);
    });
    studioResizeObserver.observe(hostEl);
    if (wrapEl) studioResizeObserver.observe(wrapEl);

    initStudioVisibility(hostEl);
    studioSceneReadyAt = performance.now();
    studioDebugLog('studio-showcase.js:initStudioScene', 'scene initialized', getStudioPreloadState(), 'H1');
}

function pickCentermostPanel(panels) {
    // Returns the panel whose vertical centre is closest to the viewport centre.
    const mid = window.innerHeight / 2;
    let best = null;
    let bestDist = Infinity;
    for (const panel of panels) {
        const r = panel.getBoundingClientRect();
        const dist = Math.abs((r.top + r.bottom) / 2 - mid);
        if (dist < bestDist) { bestDist = dist; best = panel; }
    }
    return best;
}

function bindShowcaseScroll(createTrainModel) {
    let rafPending = false;
    let scrollUnbind = null;

    function check() {
        rafPending = false;
        const panels = [...document.querySelectorAll('.showcase-panel')];
        if (!panels.length) return;

        const active = pickCentermostPanel(panels);
        if (!active) return;

        const idx = panels.indexOf(active);

        // Update active highlight regardless (CSS only, cheap).
        panels.forEach((p, i) => p.classList.toggle('is-active', i === idx));

        // Only trigger a model load when the index actually changes.
        if (idx === activeShowcaseIndex) return;
        activeShowcaseIndex = idx;

        const vehicle = SHOWCASE_VEHICLES[idx];
        if (vehicle) {
            studioDebugLog('studio-showcase.js:bindShowcaseScroll', 'panel changed', {
                idx,
                modelId: vehicle.modelId,
                ...getStudioPreloadState(),
            }, 'H1');
            setStudioModel(vehicle.modelId, createTrainModel);
            prefetchStudioNeighbors(idx, createTrainModel);
        }
    }

    function onScroll() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(check);
    }

    // Prefer Lenis scroll event so the check fires on every virtual frame,
    // not just native scroll ticks (which Lenis may suppress).
    const lenis = getLenis();
    if (lenis) {
        lenis.on('scroll', onScroll);
        scrollUnbind = () => lenis.off('scroll', onScroll);
    } else {
        window.addEventListener('scroll', onScroll, { passive: true });
        scrollUnbind = () => window.removeEventListener('scroll', onScroll);
    }

    // Run once immediately to prime the active panel.
    setTimeout(check, 150);

    return scrollUnbind;
}

export function initStudioShowcase({ createTrainModel }) {
    const hostEl = document.getElementById('studio-canvas-host');
    const panelsHost = document.getElementById('showcase-panels');
    const articleEl = document.getElementById('new_visual_text');

    if (panelsHost && articleEl?.children.length) {
        buildShowcasePanels(articleEl, panelsHost);
    }

    if (STUDIO_DESKTOP_MQ.matches && hostEl) {
        initStudioScene(hostEl, createTrainModel);
    }

    STUDIO_DESKTOP_MQ.addEventListener('change', () => {
        if (STUDIO_DESKTOP_MQ.matches && hostEl && !studioRenderer) {
            initStudioScene(hostEl, createTrainModel);
        } else if (!STUDIO_DESKTOP_MQ.matches) {
            stopStudioRender();
        }
    });

    bindShowcaseScroll(createTrainModel);
}

const NAV_ARROW_ICONS = {
    left: `<svg class="ui-arrow-icon" width="24" height="24" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8H3M7 4L3 8l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    right: `<svg class="ui-arrow-icon" width="24" height="24" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M11 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

function upgradeLightboxNavButtons(overlay) {
    const prev = overlay.querySelector('.image-lightbox-prev');
    const next = overlay.querySelector('.image-lightbox-next');
    if (prev && !prev.querySelector('.ui-arrow-icon')) prev.innerHTML = NAV_ARROW_ICONS.left;
    if (next && !next.querySelector('.ui-arrow-icon')) next.innerHTML = NAV_ARROW_ICONS.right;
}

/** Image lightbox for thesis / showcase photos. */
export function initImageLightbox() {
    let overlay = document.getElementById('image-lightbox');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'image-lightbox';
        overlay.className = 'image-lightbox';
        overlay.innerHTML = `
            <button type="button" class="image-lightbox-close" data-i18n-aria-en="Close" data-i18n-aria-sk="Zavrieť">&times;</button>
            <button type="button" class="image-lightbox-prev" data-i18n-aria-en="Previous" data-i18n-aria-sk="Predchádzajúci">${NAV_ARROW_ICONS.left}</button>
            <img class="image-lightbox-img" alt="">
            <button type="button" class="image-lightbox-next" data-i18n-aria-en="Next" data-i18n-aria-sk="Ďalší">${NAV_ARROW_ICONS.right}</button>
        `;
        document.body.appendChild(overlay);
    }

    upgradeLightboxNavButtons(overlay);

    // Clean up any leftover wrapper elements from previous refactors
    overlay.querySelector('.image-lightbox-bg')?.remove();
    overlay.querySelector('.image-lightbox-stage')?.replaceWith(...overlay.querySelector('.image-lightbox-stage')?.childNodes ?? []);
    const orphanFrame = overlay.querySelector('.image-lightbox-frame');
    if (orphanFrame) orphanFrame.replaceWith(...orphanFrame.childNodes);

    const imgEl = overlay.querySelector('.image-lightbox-img');
    let gallery = [];
    let galleryIndex = 0;

    const close = () => overlay.classList.remove('open');
    const show = (index) => {
        if (!gallery.length) return;
        galleryIndex = (index + gallery.length) % gallery.length;
        imgEl.src = gallery[galleryIndex];
        overlay.classList.add('open');
    };

    overlay.querySelector('.image-lightbox-close')?.addEventListener('click', close);
    overlay.querySelector('.image-lightbox-prev')?.addEventListener('click', () => show(galleryIndex - 1));
    overlay.querySelector('.image-lightbox-next')?.addEventListener('click', () => show(galleryIndex + 1));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => {
        if (!overlay.classList.contains('open')) return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') show(galleryIndex - 1);
        if (e.key === 'ArrowRight') show(galleryIndex + 1);
    });

    document.getElementById('thesis-document')?.addEventListener('click', (e) => {
        const target = e.target;
        if (target.tagName !== 'IMG') return;
        if (target.closest('#studio-canvas-host')) return;
        if (target.closest('#thesis-intro')) return;
        if (target.closest('.thesis-intro-video')) return;
        if (target.closest('.render-slider__track')) return;

        const container = target.closest('.flex_div, article, .showcase-panel, .thesis-chapter');
        const imgs = container
            ? [...container.querySelectorAll('img')].filter((i) => !i.closest('#studio-canvas-host'))
            : [target];
        gallery = imgs.map((i) => i.src);
        galleryIndex = Math.max(0, imgs.indexOf(target));
        show(galleryIndex);
    });
}

/** Legacy HTML used missing relative assets/arrow*.svg — replace with inline icons. */
function upgradeRenderSliderButtons(root = document) {
    root.querySelectorAll('.render-slider__btn').forEach((btn) => {
        if (btn.querySelector('.ui-arrow-icon')) return;
        const icon = btn.dataset.dir === '-1' ? NAV_ARROW_ICONS.left : btn.dataset.dir === '1' ? NAV_ARROW_ICONS.right : null;
        if (!icon) return;
        btn.querySelector('img')?.remove();
        btn.innerHTML = icon;
    });
}

/**
 * Horizontal render sliders — optional drag, arrow navigation, auto-play.
 * Enable drag: data-drag="true" on .render-slider (default: on unless data-drag="false").
 */
export function initRenderSliders() {
    upgradeRenderSliderButtons();
    document.querySelectorAll('.render-slider').forEach((el) => {
        const track = el.querySelector('.render-slider__track');
        if (!track) return;

        const dragEnabled = el.dataset.drag !== 'false';
        if (dragEnabled) el.classList.add('render-slider--drag');

        const slides = Array.from(track.querySelectorAll('img'));
        const indexEl = el.querySelector('.render-slider__index');
        const totalEl = el.querySelector('.render-slider__total');
        const total = slides.length;
        if (!total) return;

        let current = 0;
        let offsetX = 0;
        let autoId = null;
        let isDragging = false;
        let dragStartX = 0;
        let dragStartOffset = 0;
        let dragMoved = false;

        if (totalEl) totalEl.textContent = String(total).padStart(2, '0');

        function viewportWidth() {
            return el.getBoundingClientRect().width || window.innerWidth;
        }

        function slideOffset(idx) {
            return slides[idx]?.offsetLeft ?? 0;
        }

        function maxOffset() {
            const last = slides[total - 1];
            if (!last) return 0;
            const padLeft = parseFloat(getComputedStyle(track).paddingLeft) || 0;
            return Math.max(0, last.offsetLeft + last.offsetWidth - viewportWidth() + padLeft);
        }

        function applyOffset(px, animate = false) {
            offsetX = Math.max(0, Math.min(maxOffset(), px));
            track.style.transition = animate ? 'transform 1s cubic-bezier(0.25, 1, 0.35, 1)' : 'none';
            track.style.transform = `translateX(${-offsetX}px)`;
        }

        function updateCounter() {
            if (indexEl) indexEl.textContent = String(current + 1).padStart(2, '0');
        }

        function nearestIndex(forOffset = offsetX) {
            let closest = 0;
            let minDist = Infinity;
            slides.forEach((_, i) => {
                const dist = Math.abs(slideOffset(i) - forOffset);
                if (dist < minDist) { minDist = dist; closest = i; }
            });
            return closest;
        }

        function scrollToSlide(idx, animate = true) {
            current = ((idx % total) + total) % total;
            applyOffset(slideOffset(current), animate);
            updateCounter();
        }

        function syncLayout(animate = false) {
            applyOffset(slideOffset(current), animate);
        }

        function startAuto() {
            stopAuto();
            autoId = setInterval(() => scrollToSlide(current + 1), 4000);
        }

        function stopAuto() {
            if (autoId) { clearInterval(autoId); autoId = null; }
        }

        el.querySelectorAll('.render-slider__btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                scrollToSlide(current + parseInt(btn.dataset.dir, 10));
                stopAuto();
                startAuto();
            });
        });

        if (dragEnabled) {
            track.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                isDragging = true;
                dragMoved = false;
                dragStartX = e.clientX;
                dragStartOffset = offsetX;
                track.classList.add('is-dragging');
                track.setPointerCapture(e.pointerId);
                stopAuto();
            });

            track.addEventListener('pointermove', (e) => {
                if (!isDragging) return;
                const dx = dragStartX - e.clientX;
                if (Math.abs(dx) > 4) dragMoved = true;
                if (dragMoved) e.preventDefault();
                applyOffset(dragStartOffset + dx, false);
                current = nearestIndex();
                updateCounter();
            });

            function endDrag(e) {
                if (!isDragging) return;
                isDragging = false;
                track.classList.remove('is-dragging');
                if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
                if (dragMoved) scrollToSlide(nearestIndex(), true);
                startAuto();
            }

            track.addEventListener('pointerup', endDrag);
            track.addEventListener('pointercancel', endDrag);
        }

        slides.forEach((img) => {
            if (img.complete) return;
            img.addEventListener('load', () => syncLayout(false), { once: true });
        });

        window.addEventListener('resize', () => syncLayout(false));

        scrollToSlide(0, false);
        startAuto();
    });
}
