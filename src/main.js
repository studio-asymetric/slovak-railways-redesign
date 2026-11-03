import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PMREMGenerator } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import {
    initGlobalLenis,
    startGlobalLenis,
    stopGlobalLenis,
    scrollToElement,
    getLenis,
    initStudioShowcase,
    initImageLightbox,
    initRenderSliders,
} from './studio-showcase.js';
import { initCustomCursor } from './cursor.js';



// Declare global variables
let scene;
let camera;
let renderer;
let composer;
let sunLight; // tight HQ shadow — follows the train
let sunWideLight; // wide LQ shadow fill — same direction, larger frustum
let controls;
const train = [];  // This array will store all train cars
const clock = new THREE.Clock(); // Clock to keep track of time
const passingTrains = [];
let hasSpawnedFirstPassingTrain = false;
let mainHeadDistance = 0;
let isSceneVisible = true;
let heroCanvasActive = true;
let siteScrollHandler = null;
let siteLenisScrollBound = false;
let siteScrollLocked = false;

function isRootLandingPath() {
    const path = window.location.pathname;
    return path === '/' || path === '';
}

function scrollToTopImmediate() {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    getLenis()?.scrollTo(0, { immediate: true });
    updatePageTopClass();
}

function isPageAtTop() {
    const lenisY = getLenis()?.scroll;
    const y = typeof lenisY === 'number' ? lenisY : window.scrollY;
    return y <= 20;
}

function updatePageTopClass() {
    document.body.classList.toggle('ontop', isPageAtTop());
}

function preventScrollWhileLoading(e) {
    if (!siteScrollLocked) return;
    e.preventDefault();
}

function preventScrollKeyWhileLoading(e) {
    if (!siteScrollLocked) return;
    const blockKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
    if (blockKeys.includes(e.key)) e.preventDefault();
}

function lockSiteScrollForLoading() {
    if (siteScrollLocked) return;
    siteScrollLocked = true;
    document.documentElement.classList.add('hero-loading');
    document.body.classList.add('hero-loading');
    scrollToTopImmediate();
    stopGlobalLenis();
    window.addEventListener('wheel', preventScrollWhileLoading, { passive: false });
    window.addEventListener('touchmove', preventScrollWhileLoading, { passive: false });
    window.addEventListener('keydown', preventScrollKeyWhileLoading);
}

function unlockSiteScrollAfterLoading() {
    if (!siteScrollLocked) return;
    siteScrollLocked = false;
    document.documentElement.classList.remove('hero-loading');
    document.body.classList.remove('hero-loading');
    window.removeEventListener('wheel', preventScrollWhileLoading);
    window.removeEventListener('touchmove', preventScrollWhileLoading);
    window.removeEventListener('keydown', preventScrollKeyWhileLoading);
}

if (isRootLandingPath()) {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    scrollToTopImmediate();
    lockSiteScrollForLoading();
}
let trainLoadQueue = Promise.resolve();
let trainGeneration = 0;
let heroResumePending = false;
let _heroLastDisplayKey = '';

function getHeroTrainDisplayState() {
    return {
        trainCount: train.length,
        trainIds: train.map((u) => u.logicalId),
        placeholderActive: !!noTrainPlaceholder,
        heroDismissed: document.body.classList.contains('hero-dismissed'),
        passingCount: passingTrains.length,
        trainGeneration,
    };
}

function heroDebugLog(location, message, data, hypothesisId) {
    const payload = {
        sessionId: 'efc220',
        location,
        message,
        data,
        hypothesisId,
        timestamp: Date.now(),
    };
    console.log(`[hero] ${message}`, data);
    // #region agent log
    fetch('http://127.0.0.1:7325/ingest/fa5556a7-8007-464a-8834-2fbd06697d84', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'efc220' },
        body: JSON.stringify(payload),
    }).catch(() => {});
    // #endregion
}

function logHeroTrainDisplay(location, reason, hypothesisId, force = false) {
    const state = getHeroTrainDisplayState();
    const key = `${state.trainCount}|${state.trainIds.join(',')}|${state.placeholderActive}|${state.heroDismissed}`;
    if (!force && key === _heroLastDisplayKey) return;
    _heroLastDisplayKey = key;
    heroDebugLog(location, reason, state, hypothesisId);
}

const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(DRACO_DECODER_PATH);

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

const modelCache = new Map();
const modelLoadPromises = new Map();


// Import model files
import KissPredok from '../models/KissPredok.glb';
import KissStred from '../models/KissStred.glb';
import KissCumakKoniec from '../models/KissCumakKoniec.glb';

import dmu861zaciatok from '../models/dmu861 zaciatok.glb';
import dmu861stred from '../models/dmu861 stred.glb';
import dmu861koniec from '../models/dmu861 koniec.glb';

import janosikpredok from '../models/janosikpredok.glb';
import janosikstred from '../models/janosikstred.glb';
import janosikriadiaci from '../models/janosikriadiaci.glb';

import delfin1 from '../models/delfin1.glb';
import delfin2 from '../models/delfin2.glb';
import delfin3 from '../models/delfin3.glb';
import tatra1 from '../models/tatra1.glb';
import tatra2 from '../models/tatra2.glb';
import tatra3 from '../models/tatra3.glb';
import dmu810 from '../models/dmu810.glb';

import panterPredok from '../models/panterPredok.glb';
import panterStred from '../models/panterStred.glb';
import panterZadok from '../models/panterZadok.glb';

import lok380 from '../models/lok380.glb';
import lok363 from '../models/lok363.glb';
import lok383 from '../models/lok383.glb';
import lok350 from '../models/lok350.glb';
import lok754 from '../models/lok754.glb';
import lok210 from '../models/lok210.glb';
import lok240 from '../models/lok240.glb';

import ampeer from '../models/ampeer.glb';
import aeer from '../models/aeer.glb';
import bmpeer from '../models/bmpeer.glb';
import bmz from '../models/bmz.glb';
import bds from '../models/bds.glb';
import wrrm from '../models/wrrm.glb';
import wlab from '../models/wlab.glb';

import catenary from '../models/catenary.glb';
// station.glb is loaded at runtime so the page still works if the file is not
// present yet — setupStationSegments() will silently skip in that case.
const STATION_MODEL_URL = new URL('../models/station.glb', import.meta.url).href;

import lokofix from '../models/lokofix.glb';

const modelMap = {
    'KissPredok': KissPredok,
    'KissStred': KissStred,
    'KissCumakKoniec': KissCumakKoniec,

    'panterPredok': panterPredok,
    'panterStred': panterStred,
    'panterZadok': panterZadok,

    'dmu861zaciatok': dmu861zaciatok,
    'dmu861stred': dmu861stred,
    'dmu861koniec': dmu861koniec,

    'janosikpredok': janosikpredok,
    'janosikstred': janosikstred,
    'janosikriadiaci': janosikriadiaci,

    'delfin1': delfin1,
    'delfin2': delfin2,
    'delfin3': delfin3,
    'tatra1': tatra1,
    'tatra2': tatra2,
    'tatra3': tatra3,
    'dmu810': dmu810,

    'lok380': lok380,
    'lok363': lok363,
    'lok383': lok383,
    'lok350': lok350,
    'lok754': lok754,
    'lok240': lok240,
    'lok210': lok210,

    'ampeer': ampeer,
    'aeer': aeer,
    'bmpeer': bmpeer,
    'bmz': bmz,
    'bds': bds,
    'wrrm': wrrm,
    'wlab': wlab,
    'catenary': catenary,
    'lokofix': lokofix,
};

// Short articulated DMUs — one logical catalog car, multiple physical segments on curves.
const COMPOUND_UNITS = {
    tatra: ['tatra1', 'tatra2', 'tatra3'],
    delfin: ['delfin1', 'delfin2', 'delfin3'],
};

function isCompoundLogicalId(id) {
    return Object.prototype.hasOwnProperty.call(COMPOUND_UNITS, id);
}

function isCatalogLogicalId(id) {
    return !!modelMap[id] || isCompoundLogicalId(id);
}

function getSegmentIdsForLogicalId(logicalId, reverse = false) {
    const ids = COMPOUND_UNITS[logicalId] || [logicalId];
    return reverse && ids.length > 1 ? [...ids].reverse() : ids;
}

function getUnitLeadSegment(unit) {
    return unit?.segments?.[0] ?? null;
}

function getUnitTotalLength(unit) {
    if (!unit?.segments?.length) return 0;
    return unit.segments.reduce(
        (sum, seg) => sum + (seg.userData.length || 0) * (seg.scale?.x ?? 1),
        0,
    );
}

function addUnitToScene(unit) {
    for (const seg of unit.segments) scene.add(seg);
}

function removeUnitFromScene(unit) {
    if (!unit?.segments) return;
    for (const seg of unit.segments) {
        if (unit.isGapPlaceholder) scene.remove(seg);
        else removeTrainModel(seg);
    }
}

async function createTrainUnit(logicalId) {
    const segmentIds = getSegmentIdsForLogicalId(logicalId);
    const segments = [];
    try {
        for (const segId of segmentIds) {
            const model = await createTrainModel(segId);
            model.userData.modelId = segId;
            model.userData.logicalId = logicalId;
            segments.push(model);
        }
    } catch (error) {
        for (const model of segments) removeTrainModel(model);
        throw error;
    }
    return { logicalId, segments, isGapPlaceholder: false };
}

function createGapUnit(unscaledLength, refUnit) {
    const gap = createGapPlaceholder(unscaledLength);
    const refSeg = getUnitLeadSegment(refUnit);
    if (refSeg?.scale) gap.scale.copy(refSeg.scale);
    scene.add(gap);
    return { logicalId: null, segments: [gap], isGapPlaceholder: true };
}

// console.log('KissPredok URL:', modelMap['KissPredok']);
// console.log('KissStred URL:', modelMap['KissStred']);

function configureTrainModel(model, { castShadow = true, receiveShadow = true } = {}) {
    model.traverse(function (node) {
        if (!node.isMesh || node.userData.isCarDebug) return;

        node.castShadow = castShadow;
        node.receiveShadow = receiveShadow;

        if (!(node.material instanceof THREE.MeshPhongMaterial || node.material instanceof THREE.MeshStandardMaterial)) {
            const existingMap = node.material ? node.material.map : null;
            node.material = new THREE.MeshStandardMaterial({
                map: existingMap,
                color: 0xffffff,
                roughness: 0.62,
                metalness: 0.12,
            });
        }
    });
}

const _carMetricsBox = new THREE.Box3();
const _carMetricsMeshBox = new THREE.Box3();
const _carMetricsLocalMatrix = new THREE.Matrix4();
const _carMetricsInvRoot = new THREE.Matrix4();
const _carMetricsSize = new THREE.Vector3();
const _carMetricsCenter = new THREE.Vector3();

// Measure car length from mesh geometry in the model's local space, independent
// of where the GLB origin sits (often at the front coupler).
function computeCarGeometryMetrics(root) {
    _carMetricsBox.makeEmpty();
    root.updateMatrixWorld(true);
    _carMetricsInvRoot.copy(root.matrixWorld).invert();

    root.traverse((node) => {
        if (!node.isMesh || !node.geometry) return;

        const geometry = node.geometry;
        if (!geometry.boundingBox) {
            geometry.computeBoundingBox();
        }

        _carMetricsMeshBox.copy(geometry.boundingBox);
        _carMetricsLocalMatrix.multiplyMatrices(_carMetricsInvRoot, node.matrixWorld);
        _carMetricsMeshBox.applyMatrix4(_carMetricsLocalMatrix);
        _carMetricsBox.union(_carMetricsMeshBox);
    });

    if (_carMetricsBox.isEmpty()) {
        _carMetricsBox.setFromObject(root);
    }

    const length = _carMetricsBox.max.z - _carMetricsBox.min.z;
    const centerLocal = new THREE.Vector3();
    _carMetricsBox.getCenter(centerLocal);

    return {
        length,
        centerLocal,
        localBox: _carMetricsBox.clone(),
    };
}

// Master switch for all debug visuals + catenary span console reports:
// train bbox/origin markers, catenary start/end dots, track guide lines.
const SHOW_DEBUG = false;

function attachCarDebugHelpers(car) {
    if (!SHOW_DEBUG || car.userData.debugAttached) return;

    const metrics = car.userData.geometryMetrics;
    if (!metrics) return;

    const debugGroup = new THREE.Group();
    debugGroup.name = 'carDebug';

    const metricsBox = metrics.localBox;
    metricsBox.getSize(_carMetricsSize);
    metricsBox.getCenter(_carMetricsCenter);

    const bboxMesh = new THREE.Mesh(
        new THREE.BoxGeometry(_carMetricsSize.x, _carMetricsSize.y, _carMetricsSize.z),
        new THREE.MeshBasicMaterial({
            color: 0xff3333,
            wireframe: true,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
        }),
    );
    bboxMesh.userData.isCarDebug = true;
    bboxMesh.position.copy(_carMetricsCenter);
    debugGroup.add(bboxMesh);

    // Green sphere = original GLB pivot (often front of car, not its true center).
    const originMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0x33ff66, depthTest: false }),
    );
    originMarker.userData.isCarDebug = true;
    originMarker.position.set(0, _carMetricsSize.y * 0.35, 0);
    debugGroup.add(originMarker);

    // Cyan sphere = computed bounding-box center used as the placement origin.
    const computedCenterMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x33ddff, depthTest: false }),
    );
    computedCenterMarker.userData.isCarDebug = true;
    computedCenterMarker.position.copy(_carMetricsCenter);
    debugGroup.add(computedCenterMarker);

    const axes = new THREE.AxesHelper(Math.max(1.5, _carMetricsSize.z * 0.35));
    axes.userData.isCarDebug = true;
    debugGroup.add(axes);

    car.add(debugGroup);
    car.userData.debugAttached = true;
}

function attachComputedOriginAnchor(car) {
    if (car.userData.computedOriginAnchor) return;

    const metrics = car.userData.geometryMetrics;
    if (!metrics?.centerLocal) return;

    const anchor = new THREE.Object3D();
    anchor.name = 'computedOriginAnchor';
    anchor.position.copy(metrics.centerLocal);
    car.add(anchor);
    car.userData.computedOriginAnchor = anchor;
}

function detachCarDebugHelpers(car) {
    const debugGroup = car.getObjectByName('carDebug');
    if (debugGroup) {
        car.remove(debugGroup);
        debugGroup.traverse((node) => {
            if (node.geometry) node.geometry.dispose();
            if (node.material) {
                if (Array.isArray(node.material)) {
                    node.material.forEach((material) => material.dispose());
                } else {
                    node.material.dispose();
                }
            }
        });
    }
    car.userData.debugAttached = false;
}

async function loadModelTemplate(id) {
    if (modelCache.has(id)) {
        return modelCache.get(id);
    }

    if (modelLoadPromises.has(id)) {
        return modelLoadPromises.get(id);
    }

    const modelPath = modelMap[id];
    if (!modelPath) {
        throw new Error(`Model ID not found in modelMap: ${id}`);
    }

    const loadPromise = gltfLoader.loadAsync(modelPath).then((gltf) => {
        const model = gltf.scene;
        model.scale.set(0.5, 0.5, 0.5);
        configureTrainModel(model);

        const metrics = computeCarGeometryMetrics(model);
        const template = {
            scene: model,
            length: metrics.length,
            geometryMetrics: metrics,
        };
        modelCache.set(id, template);
        modelLoadPromises.delete(id);
        return template;
    }).catch((error) => {
        modelLoadPromises.delete(id);
        throw error;
    });

    modelLoadPromises.set(id, loadPromise);
    return loadPromise;
}

async function createTrainModel(id) {
    const template = await loadModelTemplate(id);
    const model = cloneSkeleton(template.scene);
    model.userData.length = template.length;
    model.userData.geometryMetrics = {
        length: template.geometryMetrics.length,
        localBox: template.geometryMetrics.localBox.clone(),
        centerLocal: template.geometryMetrics.centerLocal.clone(),
    };
    attachComputedOriginAnchor(model);
    attachCarDebugHelpers(model);
    configureTrainModel(model, { castShadow: true, receiveShadow: true });
    return model;
}

function removeTrainModel(model) {
    detachCarDebugHelpers(model);
    scene.remove(model);
}

function setSceneVisibility(isVisible) {
    isSceneVisible = isVisible;
    const heroCanvas = document.querySelector('#hero-canvas-wrap canvas');
    if (heroCanvas) heroCanvas.style.visibility = isVisible ? '' : 'hidden';
}




// --- Route curve system ---
//
// A procedurally generated closed loop so the train runs indefinitely.
// Control points are placed around a large, irregular oval each time the
// page loads, giving a fresh layout on every visit.
//
// Tweak ROUTE_POINT_COUNT and ROUTE_BASE_RADIUS to change the loop size.
// A larger radius means a longer lap — at TRAIN_SPEED = 24 the train takes
// roughly (2π × BASE_RADIUS / 24) seconds to complete one loop.
//
// ROUTE_SEED — change this integer to get a different but stable layout.
// Same seed always produces the same curve. Set to null for random each reload.
// Try: 1, 42, 847291, 20250425, 999001
const ROUTE_SEED = 3;

const ROUTE_POINT_COUNT  = 60;   // more points → finer detail on bends
const ROUTE_BASE_RADIUS  = 900;  // world units — increase for a longer lap
// Maximum turn angle (degrees) at any single control point.
// Lower = smoother, Higher = allows tighter bends.
const ROUTE_MAX_BEND_DEG = 38;

function createSeededRandom(seed) {
    let state = (seed >>> 0) || 1;
    return function rand() {
        state += 0x6D2B79F5;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Procedural closed-loop route.
//
// Shape is built from a sum of low-frequency sinusoidal harmonics on a polar
// circle, which guarantees global smoothness and ensures variety throughout
// (no long boring straights, no random hairpin spikes).
//
// After the initial generation an iterative pass detects any control-point
// triple that still exceeds ROUTE_MAX_BEND_DEG and pulls the offending point
// toward its neighbours until the constraint is met.
function generateRoutePoints() {
    const COUNT = ROUTE_POINT_COUNT;
    const R     = ROUTE_BASE_RADIUS;
    const rand  = ROUTE_SEED == null ? Math.random : createSeededRandom(ROUTE_SEED);

    // Ellipse eccentricity — breaks perfect circular symmetry.
    const stretchX = 0.82 + rand() * 0.36; // 0.82–1.18
    const stretchZ = 0.82 + rand() * 0.36;
    const rotAngle = rand() * Math.PI * 2;

    // Sinus + cosinus harmonics — mixed phases give less repetitive “oval” feel.
    const harmonics = [
        { freq: 2,  amp: (0.24 + rand() * 0.14) * R, phase: rand() * Math.PI * 2, cos: true  },
        { freq: 3,  amp: (0.18 + rand() * 0.12) * R, phase: rand() * Math.PI * 2, cos: false },
        { freq: 4,  amp: (0.12 + rand() * 0.09) * R, phase: rand() * Math.PI * 2, cos: true  },
        { freq: 5,  amp: (0.10 + rand() * 0.08) * R, phase: rand() * Math.PI * 2, cos: false },
        { freq: 7,  amp: (0.06 + rand() * 0.06) * R, phase: rand() * Math.PI * 2, cos: true  },
        { freq: 9,  amp: (0.04 + rand() * 0.05) * R, phase: rand() * Math.PI * 2, cos: false },
        { freq: 11, amp: (0.025 + rand() * 0.035) * R, phase: rand() * Math.PI * 2, cos: true },
    ];

    const pts = [];
    for (let i = 0; i < COUNT; i++) {
        const angle = (i / COUNT) * Math.PI * 2;
        let r = R;
        for (const h of harmonics) {
            const wave = h.cos
                ? Math.cos(h.freq * angle + h.phase)
                : Math.sin(h.freq * angle + h.phase);
            r += h.amp * wave;
        }
        r = Math.max(r, R * 0.32); // allow deeper bays, still no collapse

        let x = Math.cos(angle) * r * stretchX;
        let z = Math.sin(angle) * r * stretchZ;

        // Rotate the whole loop so it isn't axis-aligned every load.
        const cosR = Math.cos(rotAngle);
        const sinR = Math.sin(rotAngle);
        pts.push(new THREE.Vector3(
            x * cosR - z * sinR,
            0,
            x * sinR + z * cosR,
        ));
    }

    // Iterative angle-clamping pass: pull any control point whose incoming-
    // to-outgoing bend exceeds the limit toward the midpoint of its neighbours.
    // Up to 16 passes; exits early once every point is within tolerance.
    const maxBend = ROUTE_MAX_BEND_DEG * Math.PI / 180;
    for (let iter = 0; iter < 16; iter++) {
        let fixed = false;
        for (let i = 0; i < COUNT; i++) {
            const prev = pts[(i - 1 + COUNT) % COUNT];
            const cur  = pts[i];
            const next = pts[(i + 1) % COUNT];

            const v1x = cur.x - prev.x, v1z = cur.z - prev.z;
            const v2x = next.x - cur.x, v2z = next.z - cur.z;
            const l1 = Math.hypot(v1x, v1z);
            const l2 = Math.hypot(v2x, v2z);
            if (l1 < 1 || l2 < 1) continue;

            const cosA = Math.max(-1, Math.min(1, (v1x*v2x + v1z*v2z) / (l1 * l2)));
            const bend = Math.acos(cosA);

            if (bend > maxBend) {
                // Pull toward neighbour midpoint proportionally to the excess.
                const w = Math.min(0.55, ((bend - maxBend) / (Math.PI - maxBend)) * 0.8);
                const midX = 0.5 * (prev.x + next.x);
                const midZ = 0.5 * (prev.z + next.z);
                cur.x += (midX - cur.x) * w;
                cur.z += (midZ - cur.z) * w;
                fixed = true;
            }
        }
        if (!fixed) break;
    }

    return pts;
}

const ROUTE_POINTS = generateRoutePoints();
// 'centripetal' parameterisation avoids cusps / self-intersections on
// uneven control-point spacing — better than standard 'catmullrom' here.
const routeCurve = new THREE.CatmullRomCurve3(ROUTE_POINTS, true, 'centripetal');

const ROUTE_DIVISIONS = 4000;
let routeSamplePoints = [];
let routeArcLengths = [];
let routeTotalLength = 0;

function precomputeRouteSamples() {
    routeSamplePoints = routeCurve.getSpacedPoints(ROUTE_DIVISIONS);
    routeArcLengths = new Array(routeSamplePoints.length);
    routeArcLengths[0] = 0;
    for (let i = 1; i < routeSamplePoints.length; i++) {
        routeArcLengths[i] = routeArcLengths[i - 1]
            + routeSamplePoints[i].distanceTo(routeSamplePoints[i - 1]);
    }
    routeTotalLength = routeArcLengths[routeArcLengths.length - 1];
}
precomputeRouteSamples();

// The route is a closed loop — wrap distances instead of clamping so the
// train runs forever without stopping.
function clampRouteDistance(distance) {
    if (routeTotalLength === 0) return 0;
    return ((distance % routeTotalLength) + routeTotalLength) % routeTotalLength;
}

// Distance from `from` to `to` along increasing route distance (handles loop wrap).
function routeDistanceForward(from, to) {
    let d = clampRouteDistance(to) - clampRouteDistance(from);
    if (d < 0) d += routeTotalLength;
    return d;
}

// Convert a distance along the route (in world units) to the curve's t parameter.
function distanceToT(distance) {
    const d = clampRouteDistance(distance);
    let lo = 0;
    let hi = routeArcLengths.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (routeArcLengths[mid] < d) lo = mid + 1;
        else hi = mid;
    }
    const idx = Math.max(1, lo);
    const a = routeArcLengths[idx - 1];
    const b = routeArcLengths[idx];
    const segT = b > a ? (d - a) / (b - a) : 0;
    return (idx - 1 + segT) / ROUTE_DIVISIONS;
}

const _routePos = new THREE.Vector3();
const _routeTan = new THREE.Vector3();
const _routeNormal = new THREE.Vector3();

// Returns position/tangent/normal/yaw at a given route distance, optionally
// offset laterally by `lateralOffset` units along the in-plane normal.
function getPoseAtDistance(distance, lateralOffset = 0) {
    const t = distanceToT(distance);
    routeCurve.getPointAt(t, _routePos);
    routeCurve.getTangentAt(t, _routeTan).normalize();
    _routeNormal.set(-_routeTan.z, 0, _routeTan.x).normalize();
    const position = new THREE.Vector3()
        .copy(_routePos)
        .addScaledVector(_routeNormal, lateralOffset);
    const yaw = Math.atan2(_routeTan.x, _routeTan.z);
    return {
        position,
        tangent: _routeTan.clone(),
        normal: _routeNormal.clone(),
        yaw,
    };
}

// Reusable vectors for placeCarOnRoute curve-swing calculation.
const _swingP1 = new THREE.Vector3();
const _swingP2 = new THREE.Vector3();
const _swingChordMid = new THREE.Vector3();
const _swingCarCenter = new THREE.Vector3();

// Place a car on the route.
//
// The car's two end-couplers follow the route exactly (at routeDistance ±
// halfWorld).  The car body centre lands at the chord midpoint of those two
// route positions — naturally replicating the real-world inward swing a rigid
// car experiences on a curve.  CURVE_SWING_INTENSITY blends from the straight
// route point (0) to the full chord midpoint (1).
//
// The car's yaw is derived from the chord direction so it always aligns with
// the actual span between its two ends, regardless of local curvature.
function placeCarOnRoute(car, routeDistance, lateralOffset, direction) {
    const metrics = car.userData.geometryMetrics;
    const halfWorld = metrics ? (metrics.length * car.scale.x) / 2 : 0;

    // Sample route at both coupler positions.
    const d1 = clampRouteDistance(routeDistance - halfWorld); // smaller-d end
    const d2 = clampRouteDistance(routeDistance + halfWorld); // larger-d end
    _swingP1.copy(getPoseAtDistance(d1, lateralOffset).position);
    _swingP2.copy(getPoseAtDistance(d2, lateralOffset).position);

    // Chord midpoint = where car body centre ends up (inside of curve).
    _swingChordMid.addVectors(_swingP1, _swingP2).multiplyScalar(0.5);

    // Route centre at routeDistance (used when CURVE_SWING_INTENSITY < 1).
    const routePose = getPoseAtDistance(routeDistance, lateralOffset);
    _swingCarCenter.lerpVectors(routePose.position, _swingChordMid, CURVE_SWING_INTENSITY);

    // Yaw from chord direction — car faces toward its direction of travel.
    // direction < 0  → train moves toward smaller distances → face toward p1 (smaller d)
    // direction > 0  → train moves toward larger distances  → face toward p2 (larger d)
    //
    // All GLB models have their nose at local -Z (not +Z), so we add Math.PI
    // to flip every car 180° so the nose points in the direction of travel.
    const facingX = direction < 0 ? _swingP1.x - _swingP2.x : _swingP2.x - _swingP1.x;
    const facingZ = direction < 0 ? _swingP1.z - _swingP2.z : _swingP2.z - _swingP1.z;
    const yaw = Math.atan2(facingX, facingZ) + Math.PI;

    car.rotation.set(0, yaw, 0);
    car.userData.routeDistance = routeDistance;

    if (metrics && metrics.centerLocal) {
        // centerLocal is in GLB-unscaled space; multiply by car.scale.x to get
        // world units before rotating and subtracting from the car centre.
        const s = car.scale.x;
        const cx = metrics.centerLocal.x * s;
        const cz = metrics.centerLocal.z * s;
        const cosY = Math.cos(yaw);
        const sinY = Math.sin(yaw);
        const offsetX = cx * cosY + cz * sinY;
        const offsetZ = -cx * sinY + cz * cosY;
        car.position.set(
            _swingCarCenter.x - offsetX,
            0,
            _swingCarCenter.z - offsetZ,
        );
    } else {
        car.position.set(_swingCarCenter.x, 0, _swingCarCenter.z);
    }
}

// Chain cars using measured geometry length only. Each car's bounding-box
// center is the anchor; consecutive cars are spaced by half-lengths so adjacent
// boxes touch (zero gap), regardless of where the GLB pivots sit.
// userData.length is in GLB-unscaled space, so multiply by car.scale.x to get
// world-space half-length for the route-distance step.
function placeTrainCarsOnRoute(startDistance, cars, lateralOffset, facingDirection) {
    let distance = startDistance;
    for (const car of cars) {
        const halfLength = (car.userData.length || 0) * car.scale.x / 2;
        distance += halfLength;
        car.userData.chainDistance = distance;
        placeCarOnRoute(car, distance, lateralOffset, facingDirection);
        distance += halfLength;
    }
    return distance;
}

const MAIN_TRACK_OFFSET = 0;
const PASSING_TRACK_OFFSET = 2.4;

// ---------------------------------------------------------------------------
// Scene colours
// ---------------------------------------------------------------------------
const BACKGROUND_COLOR           = 0x0C0C0C;
const FOG_COLOR                  = 0x0C0C0C; // horizon fade colour (usually matches background)
const FOG_DISTANCE               = 400;        // world units — higher = see farther
const FOG_DENSITY                = 1.4;      // subtle distance crush — keeps mid-frame lit by same lights
const GROUND_COLOR               = 0x111111; // unlit base — stays dark regardless of scene lights
const GROUND_Y                   = -0.09;
const GROUND_SHADOW_OPACITY      = 0.4;     // shadow catcher strength on top of the base
const GROUND_ROUGHNESS           = 2;  // unused — kept for reference if switching back to StandardMaterial
const GROUND_ENV_MAP_INTENSITY   = 0.0;

// Hero lighting — matched to studio showcase (without floor reflection)
const HERO_ENV_INTENSITY         = 0.6;
const HERO_HEMI_SKY              = 0x141820;
const HERO_HEMI_GROUND           = 0x020202;
const HERO_HEMI_INTENSITY        = 1;
const HERO_KEY_COLOR             = 0xfff4d0;
const HERO_KEY_INTENSITY         = 4.6;
const HERO_KEY_OFFSET_X          = 18;
const HERO_KEY_OFFSET_Y          = 28;
const HERO_KEY_OFFSET_Z          = 12;
const HERO_BOUNCE_COLOR          = 0xff9966;
const HERO_BOUNCE_INTENSITY      = 0.38;
const HERO_KEY_SHADOW_MAP_SIZE   = 2048;
const HERO_KEY_SHADOW_FRUSTUM    = 26;
const HERO_WIDE_SHADOW_MAP_SIZE  = 1024;
const HERO_WIDE_SHADOW_FRUSTUM   = 72;
const HERO_WIDE_SHADOW_INTENSITY = 0.9;  // fill — wider, softer shadow coverage
const HERO_WIDE_SHADOW_DARKNESS  = 0.55; // shadow.intensity — keeps wide map subtle
const HERO_BLOOM_STRENGTH        = 0.12;
const HERO_BLOOM_RADIUS          = 0.45;
const HERO_BLOOM_THRESHOLD       = 0.92;
const HERO_TONE_EXPOSURE         = 0.76; // global output darken — does not change scene lights
const HERO_VIGNETTE_OFFSET       = 0.88;
const HERO_VIGNETTE_DARKNESS     = 0.0;
const HERO_MAX_PIXEL_RATIO       = 1.5;  // cap for HiDPI — lower saves fillrate
const HERO_RENDER_SCALE          = 0.85;  // internal buffer scale: 1 = full, 0.75 = 75%, 0.5 = half
const CATENARY_COLOR           = 0x222222;
const STATION_COLOR            = 0x666666;
const STATION_PLATFORM_COLOR   = 0x222222;

const CATENARY_Y = -0.23;
const CATENARY_SCALE = 0.55;
// Shift the whole catenary section sideways along the route normal.
// + = toward the route's right side, − = toward the left. Tweak until the
// section centreline sits on the track centreline.
const CATENARY_LATERAL_SHIFT = 1.12;
// Multiplier on the computed segment span used as placement spacing.
// < 1.0 pulls segments apart (fixes overlap on tight curves).
// > 1.0 pushes them together (closes gaps).  Start at 0.95 and tune.
const CATENARY_SPACING_SCALE = 1;
// Shift where catenary segments start along the route (world units). Rotates
// the loop-closure gap to a different part of the track — use ~half the loop
// length to move it opposite the train start. Tune until the seam is out of sight.
const CATENARY_ROUTE_OFFSET = 3900;

// ---------------------------------------------------------------------------
// Station constants
// ---------------------------------------------------------------------------
// How far along the route the first station sits (world units from start).
const STATION_FIRST_OFFSET   = 600;
// Distance between consecutive stations after the first.
const STATION_SPACING        = 800;
// Physical length of the platform in world units — train stops so its
// midpoint (first-car bbox centre) aligns with the platform midpoint.
const STATION_PLATFORM_LENGTH = 150;
// How far the station building (GLB) is offset from the route centreline.
// Positive = route's right side, negative = left.
const STATION_LATERAL_OFFSET  = 8;
// Scale applied to the station GLB.
const STATION_SCALE           = 0.55;
// Y offset for the station building root (tweak if it floats/sinks).
const STATION_Y               = 0;
// Procedural platform box dimensions.
const STATION_PLATFORM_WIDTH           = 2;     // platform width (world units)
const STATION_PLATFORM_HEIGHT          = 0.3;   // platform height above STATION_Y
// Lateral distance from the route curve centreline (offset 0) to each platform
// slab centre. Set each side independently (+ = route right, − = route left).
const STATION_PLATFORM_RIGHT_OFFSET = 4.2;
const STATION_PLATFORM_LEFT_OFFSET  = -1.85;
const STATION_PLATFORM_SEGS            = 32;    // Z-axis segments for curve bending
// Distance from which the train starts braking before a station stop point.
const STATION_BRAKE_DISTANCE  = 240;
// Deceleration / acceleration rate (world units per second²).
const STATION_DECEL_RATE      = 3;
const STATION_ACCEL_RATE      = 1
// How long the train dwells at the station before departing (seconds).
const STATION_DWELL_TIME      = 6;

// ---------------------------------------------------------------------------
// Single speed control for both the current train and opposite passing trains.
const TRAIN_SPEED = 24;
// Passing trains — tweak these to control how early they appear and how quickly
// they despawn after the pass (shorter total = more frequent spawns).
// Spawn offset: how far behind the main train (route distance) they appear.
const PASSING_TRAIN_SPAWN_AHEAD = 480;
// First opposite train only — smaller = closer spawn = sooner pass on load.
const PASSING_TRAIN_FIRST_SPAWN_AHEAD = 250;
// Despawn once the passing train is this far ahead of the main train (+route direction).
const PASSING_TRAIN_DESPAWN_AHEAD = 400;
const FOLLOW_CAMERA_HEIGHT = 5;
const FOLLOW_CAMERA_BACK_OFFSET = 16;
const FOLLOW_CAMERA_SIDE_OFFSET = 8;
const CAMERA_FOV = 38; // vertical field of view in degrees (lower = zoomed in)
// Tighter FOV when entering train builder — animated on "Build your own train".
const BUILDER_CAMERA_FOV = 45; // lower = more zoomed-in / immersive
const BUILDER_CAMERA_FOV_DURATION_MS = 900; // transition length in ms
// Exponential lerp speed for wheel / pinch zoom (higher = snappier).
const CAMERA_ZOOM_SMOOTH = 10;
// Fixed world Y for the OrbitControls target — XZ still follow the train.
const CAMERA_ORIGIN_HEIGHT = 0.7;
// Initial camera on load — in front of the train, looking at its nose.
const INITIAL_CAMERA_FRONT_OFFSET = 15; // distance ahead of the train (world units)
const INITIAL_CAMERA_SIDE_OFFSET  = -4;  // lateral offset (+ = route right)
const INITIAL_CAMERA_HEIGHT_OFFSET  = 3;  // added on top of CAMERA_ORIGIN_HEIGHT
// Idle auto-orbit (OrbitControls.autoRotate) after no user input.
const AUTO_ROTATE_SPEED      = -0.29;  // higher = faster spin
const AUTO_ROTATE_IDLE_MS    = 15000; // ms of inactivity before auto-orbit resumes

// ---------------------------------------------------------------------------
// Mobile hero — frozen at first layout (≤ MOBILE_BREAKPOINT_PX). Tweak here.
// ---------------------------------------------------------------------------
const MOBILE_BREAKPOINT_PX = 720;

const MOBILE_HERO = {
    // Camera on load — larger FRONT_OFFSET = further ahead of the locomotive nose
    INITIAL_CAMERA_FRONT_OFFSET: 24,
    INITIAL_CAMERA_SIDE_OFFSET: -3,
    INITIAL_CAMERA_HEIGHT_OFFSET: 2.5,
    CAMERA_FOV: 42,

    // OrbitControls.autoRotate (idle spin + presentation / showcase mode)
    AUTO_ROTATE_ENABLED: false,
    AUTO_ROTATE_IN_PRESENTATION: false,
    AUTO_ROTATE_SPEED: -0.29,
    AUTO_ROTATE_IDLE_MS: 15000,
};

let heroUsesMobileLayout = false;

function initHeroLayoutProfile() {
    heroUsesMobileLayout = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
}

function getHeroCameraFrontOffset() {
    return heroUsesMobileLayout
        ? MOBILE_HERO.INITIAL_CAMERA_FRONT_OFFSET
        : INITIAL_CAMERA_FRONT_OFFSET;
}

function getHeroCameraSideOffset() {
    return heroUsesMobileLayout
        ? MOBILE_HERO.INITIAL_CAMERA_SIDE_OFFSET
        : INITIAL_CAMERA_SIDE_OFFSET;
}

function getHeroCameraHeightOffset() {
    return heroUsesMobileLayout
        ? MOBILE_HERO.INITIAL_CAMERA_HEIGHT_OFFSET
        : INITIAL_CAMERA_HEIGHT_OFFSET;
}

function getHeroCameraFov() {
    return heroUsesMobileLayout ? MOBILE_HERO.CAMERA_FOV : CAMERA_FOV;
}

function getHeroAutoRotateSpeed() {
    return heroUsesMobileLayout ? MOBILE_HERO.AUTO_ROTATE_SPEED : AUTO_ROTATE_SPEED;
}

function getHeroAutoRotateIdleMs() {
    return heroUsesMobileLayout ? MOBILE_HERO.AUTO_ROTATE_IDLE_MS : AUTO_ROTATE_IDLE_MS;
}

function isHeroAutoRotateEnabled() {
    if (!heroUsesMobileLayout) return true;
    if (presentationLoopActive) return MOBILE_HERO.AUTO_ROTATE_IN_PRESENTATION;
    return MOBILE_HERO.AUTO_ROTATE_ENABLED;
}

// ---------------------------------------------------------------------------
// Curve-swing correction
// When a rigid car rounds a curve, the two end couplers sit on the rail while
// the body centre swings slightly toward the inside of the curve.  We sample
// the route at both car ends and use the chord midpoint as the actual car-body
// centre.  Set CURVE_SWING_INTENSITY between 0 (disabled) and 1 (full physics).
// ---------------------------------------------------------------------------
const CURVE_SWING_INTENSITY = 1.0;

// ---------------------------------------------------------------------------
// Track visualisation (when SHOW_DEBUG is true)
// Draws the route centreline, the two track-centre paths, and one rail line
// on each side of each track.
// TRACK_VIS_RAIL_HALF_GAUGE is the rail-to-rail half-width in world units —
// increase/decrease it until the lines sit exactly under the wheel bogies.
// ---------------------------------------------------------------------------
const TRACK_VIS_RAIL_HALF_GAUGE = 0.70;

// Start the train sitting at the first station so it departs from a platform.
mainHeadDistance = STATION_FIRST_OFFSET;
let stationState = 'stopped';
let stationDwellTimer = 0;
let currentStationD  = STATION_FIRST_OFFSET;
let mainTrainSpeed   = 0;
// Dwell timer is paused until at least one train car has been added to the
// scene, so the train doesn't depart before its models finish loading.
let stationWaitingForTrain = true;
// Adjusted head-stop distance so the train body CENTER aligns with the station.
// Computed from halfLength when braking starts; null outside braking state.
let currentStopPoint = null;

// ---------------------------------------------------------------------------
// Station route positions — computed once from the route total length.
// ---------------------------------------------------------------------------
let stationDistances = [];

function computeStationDistances() {
    stationDistances = [];
    let d = STATION_FIRST_OFFSET;
    while (d < routeTotalLength) {
        stationDistances.push(d);
        d += STATION_SPACING;
    }
}
computeStationDistances();

// ---------------------------------------------------------------------------
// Stations — building (rigid GLB, no deformation) + platform (warped box).
// ---------------------------------------------------------------------------

// All scene objects created per-station are collected here for easy cleanup.
const stationObjects = [];
let stationTemplate  = null;   // loaded GLB scene, used as clone source

function applyMeshColor(root, color) {
    root.traverse(node => {
        if (!node.isMesh || !node.material) return;
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of mats) {
            if (mat.color) mat.color.set(color);
        }
    });
}

// Shared platform material — DoubleSide so both faces are visible regardless
// of winding direction after vertex deformation.
const platformMat = new THREE.MeshStandardMaterial({
    color: STATION_PLATFORM_COLOR,
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide,
});

// Build a platform box whose vertices are already in world space, bent along
// the route curve centreline (lateral offset 0 — the white debug path).
// The box is W × H × STATION_PLATFORM_LENGTH; its Z axis runs along the route
// so each Z-slice samples a different centreline pose.
// centerlineLateralOffset > 0 = route's right side, < 0 = left side.
function createPlatformMesh(routeDistance, centerlineLateralOffset) {
    const geo = new THREE.BoxGeometry(
        STATION_PLATFORM_WIDTH,
        STATION_PLATFORM_HEIGHT,
        STATION_PLATFORM_LENGTH,
        1, 1,
        STATION_PLATFORM_SEGS,
    );
    const posAttr = geo.attributes.position;
    const arr     = posAttr.array;
    const baseY   = STATION_Y + STATION_PLATFORM_HEIGHT / 2;

    for (let i = 0; i < posAttr.count; i++) {
        const localX = arr[i * 3    ];
        const localY = arr[i * 3 + 1];
        const localZ = arr[i * 3 + 2];

        // Arc-length along the route curve centreline; lateral spread is applied
        // via getPoseAtDistance's second arg — never MAIN_TRACK_OFFSET.
        const pose = getPoseAtDistance(
            clampRouteDistance(routeDistance + localZ),
            localX + centerlineLateralOffset,
        );

        arr[i * 3    ] = pose.position.x;
        arr[i * 3 + 1] = localY + baseY;
        arr[i * 3 + 2] = pose.position.z;
    }

    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    // DoubleSide material makes winding direction irrelevant; no normal flip needed.

    const mesh = new THREE.Mesh(geo, platformMat);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.position.set(0, 0, 0);
    return mesh;
}

// Place the rigid GLB building at a station point.
function placeStationBuilding(routeDistance) {
    if (!stationTemplate) return;
    const pose     = getPoseAtDistance(routeDistance, STATION_LATERAL_OFFSET);
    const building = stationTemplate.clone(true);
    building.scale.set(STATION_SCALE, STATION_SCALE, STATION_SCALE);
    building.position.set(pose.position.x, STATION_Y, pose.position.z);
    building.rotation.set(0, pose.yaw, 0);
    building.traverse(node => {
        if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
    });
    scene.add(building);
    stationObjects.push(building);
}

async function setupStationSegments() {
    // Try loading the GLB; if absent, stations still appear (platform only).
    try {
        const gltf = await gltfLoader.loadAsync(STATION_MODEL_URL);
        stationTemplate = gltf.scene;
        applyMeshColor(stationTemplate, STATION_COLOR);
        console.log('[station] building GLB loaded');
    } catch {
        console.warn('[station] station.glb not found — building will be skipped');
    }

    await placeStationSegments();
}

// Yield between stations so placement never freezes the page.
async function placeStationSegments() {
    for (const obj of stationObjects) scene.remove(obj);
    stationObjects.length = 0;

    const t0 = performance.now();

    for (const stationD of stationDistances) {
        const platformR = createPlatformMesh(stationD, STATION_PLATFORM_RIGHT_OFFSET);
        const platformL = createPlatformMesh(stationD, STATION_PLATFORM_LEFT_OFFSET);
        scene.add(platformR);
        scene.add(platformL);
        stationObjects.push(platformR, platformL);

        placeStationBuilding(stationD);

        await new Promise(r => setTimeout(r, 0));
    }

    console.log(
        `[station] placed ${stationDistances.length} station(s) ` +
        `(${(performance.now() - t0).toFixed(1)} ms)`,
    );
}

// ---------------------------------------------------------------------------
// Station stopping state for the main train
// (variables initialised near mainHeadDistance above so they start at the
//  first station — stationState='stopped', currentStationD=STATION_FIRST_OFFSET)
// ---------------------------------------------------------------------------

function findNextStationAhead() {
    // The main train moves by decreasing mainHeadDistance.
    // "Ahead" means the next station at a lower route distance the train will reach.
    // We must account for wrap-around.
    for (let i = stationDistances.length - 1; i >= 0; i--) {
        const sd = stationDistances[i];
        // How far "behind" is this station from current position on the wrapped route?
        let delta = mainHeadDistance - sd;
        if (delta < 0) delta += routeTotalLength;
        // We want the closest one that's ahead (delta between 0..routeTotal).
        if (delta > 0 && delta < STATION_BRAKE_DISTANCE * 3) return sd;
    }
    // Fallback: find the one that is the smallest positive ahead distance.
    let best = null, bestDelta = Infinity;
    for (const sd of stationDistances) {
        let delta = mainHeadDistance - sd;
        if (delta < 0) delta += routeTotalLength;
        if (delta > 0 && delta < bestDelta) { bestDelta = delta; best = sd; }
    }
    return best;
}

function stationDistanceAhead(stationD) {
    let d = mainHeadDistance - stationD;
    if (d < 0) d += routeTotalLength;
    return d;  // positive = station is this far ahead in travel direction
}

const catenarySegments = [];
let catenaryTemplate = null;
let catenarySegmentLength = 0;

// ---------------------------------------------------------------------------
// Track visualisation
//
// Draws the guide curves so you can tune TRACK_VIS_RAIL_HALF_GAUGE until the
// lines sit exactly under the wheel bogies, and CURVE_SWING_INTENSITY until
// the cars look right in curves.
//
// Lines drawn (all float 0.05 m above ground to avoid z-fighting):
//   White  (dim)  — route centreline
//   Yellow        — main track centre path (MAIN_TRACK_OFFSET)
//   Cyan          — passing track centre path (PASSING_TRACK_OFFSET)
//   Orange (×2)   — main track rails (± TRACK_VIS_RAIL_HALF_GAUGE)
//   Teal   (×2)   — passing track rails (± TRACK_VIS_RAIL_HALF_GAUGE)
// ---------------------------------------------------------------------------
const _trackVisLines = [];

function createTrackVisualization() {
    if (!SHOW_DEBUG) return;

    const STEPS = 800;
    const Y = 0.05;

    // Build a set of XZ points along the route at a given lateral offset.
    function samplePath(lateralOffset) {
        const pts = [];
        for (let i = 0; i <= STEPS; i++) {
            const d = (i / STEPS) * routeTotalLength;
            const p = getPoseAtDistance(d, lateralOffset).position;
            pts.push(new THREE.Vector3(p.x, Y, p.z));
        }
        return pts;
    }

    function makeLine(pts, color, opacity) {
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
            color,
            transparent: opacity < 1,
            opacity,
            depthTest: false,
        });
        const line = new THREE.Line(geo, mat);
        scene.add(line);
        _trackVisLines.push(line);
    }

    // Centreline
    makeLine(samplePath(0), 0xffffff, 0.25);

    // Track-centre paths
    makeLine(samplePath(MAIN_TRACK_OFFSET),    0xffee00, 0.6);
    makeLine(samplePath(PASSING_TRACK_OFFSET), 0x00ffee, 0.6);

    // Rails — offset ± TRACK_VIS_RAIL_HALF_GAUGE from each track centre
    makeLine(samplePath(MAIN_TRACK_OFFSET + TRACK_VIS_RAIL_HALF_GAUGE), 0xff9900, 0.9);
    makeLine(samplePath(MAIN_TRACK_OFFSET - TRACK_VIS_RAIL_HALF_GAUGE), 0xff9900, 0.9);
    makeLine(samplePath(PASSING_TRACK_OFFSET + TRACK_VIS_RAIL_HALF_GAUGE), 0x00ccaa, 0.9);
    makeLine(samplePath(PASSING_TRACK_OFFSET - TRACK_VIS_RAIL_HALF_GAUGE), 0x00ccaa, 0.9);
}

function getHeroPixelRatio() {
    return Math.min(window.devicePixelRatio, HERO_MAX_PIXEL_RATIO) * HERO_RENDER_SCALE;
}

function applyHeroRenderSize(width, height) {
    if (!renderer) return;
    const dpr = getHeroPixelRatio();
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height);
    if (composer) {
        composer.setPixelRatio(dpr);
        composer.setSize(width, height);
    }
}

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND_COLOR);
    scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY / FOG_DISTANCE);

    camera = new THREE.PerspectiveCamera(getHeroCameraFov(), window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(10, 2.2, 5);

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
    });
    applyHeroRenderSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NoToneMapping; // OutputPass handles ACES at the end
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const heroCanvasWrap = document.getElementById('hero-canvas-wrap');
    (heroCanvasWrap || document.body).appendChild(renderer.domElement);


    
    // OrbitControls follow the main train's head on the curve while still
    // letting the user orbit around it.
    controls = new OrbitControls(camera, renderer.domElement);
    controls.rotateSpeed = 0.4;
    controls.autoRotate = false;
    controls.autoRotateSpeed = getHeroAutoRotateSpeed();
    controls.enableDamping = true;
    controls.dampingFactor = 0.04;

    
    controls.maxPolarAngle = Math.PI / 1.96;
    controls.enablePan = false;

    const initialPose = getPoseAtDistance(mainHeadDistance, MAIN_TRACK_OFFSET);
    _leadForwardTmp.copy(initialPose.tangent).multiplyScalar(-1); // direction the train faces
    controls.target.set(
        initialPose.position.x, CAMERA_ORIGIN_HEIGHT, initialPose.position.z,
    );
    camera.position
        .set(initialPose.position.x, CAMERA_ORIGIN_HEIGHT, initialPose.position.z)
        .addScaledVector(_leadForwardTmp, getHeroCameraFrontOffset())
        .addScaledVector(initialPose.normal, getHeroCameraSideOffset());
    camera.position.y = CAMERA_ORIGIN_HEIGHT + getHeroCameraHeightOffset();













    // Sky/ground hemisphere — same gentle dark gradient as studio
    const hemiLight = new THREE.HemisphereLight(
        HERO_HEMI_SKY, HERO_HEMI_GROUND, HERO_HEMI_INTENSITY,
    );
    scene.add(hemiLight);

    // Warm key light — studio-matched, tight HQ shadow frustum follows the train
    sunLight = new THREE.DirectionalLight(HERO_KEY_COLOR, HERO_KEY_INTENSITY);
    sunLight.position.set(HERO_KEY_OFFSET_X, HERO_KEY_OFFSET_Y, HERO_KEY_OFFSET_Z);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(HERO_KEY_SHADOW_MAP_SIZE, HERO_KEY_SHADOW_MAP_SIZE);
    sunLight.shadow.camera.near   = 1;
    sunLight.shadow.camera.far    = 80;
    sunLight.shadow.camera.left   = -HERO_KEY_SHADOW_FRUSTUM;
    sunLight.shadow.camera.right  = HERO_KEY_SHADOW_FRUSTUM;
    sunLight.shadow.camera.top    = HERO_KEY_SHADOW_FRUSTUM;
    sunLight.shadow.camera.bottom = -HERO_KEY_SHADOW_FRUSTUM;
    sunLight.shadow.bias          = -0.003;
    sunLight.shadow.normalBias    = 0.012;
    sunLight.shadow.radius        = 3;
    scene.add(sunLight);
    scene.add(sunLight.target);

    // Wide fill — lower-res shadow map over a bigger area (soft distant / inter-car shadows)
    sunWideLight = new THREE.DirectionalLight(HERO_KEY_COLOR, HERO_WIDE_SHADOW_INTENSITY);
    sunWideLight.position.set(HERO_KEY_OFFSET_X, HERO_KEY_OFFSET_Y, HERO_KEY_OFFSET_Z);
    sunWideLight.castShadow = true;
    sunWideLight.shadow.mapSize.set(HERO_WIDE_SHADOW_MAP_SIZE, HERO_WIDE_SHADOW_MAP_SIZE);
    sunWideLight.shadow.camera.near   = 1;
    sunWideLight.shadow.camera.far    = 140;
    sunWideLight.shadow.camera.left   = -HERO_WIDE_SHADOW_FRUSTUM;
    sunWideLight.shadow.camera.right  = HERO_WIDE_SHADOW_FRUSTUM;
    sunWideLight.shadow.camera.top    = HERO_WIDE_SHADOW_FRUSTUM;
    sunWideLight.shadow.camera.bottom = -HERO_WIDE_SHADOW_FRUSTUM;
    sunWideLight.shadow.bias          = -0.0008;
    sunWideLight.shadow.normalBias    = 0.022;
    sunWideLight.shadow.radius        = 6;
    sunWideLight.shadow.intensity     = HERO_WIDE_SHADOW_DARKNESS;
    scene.add(sunWideLight);
    scene.add(sunWideLight.target);

    // Subtle warm bounce from below — studio fill, no shadow cost
    const bounceLight = new THREE.DirectionalLight(HERO_BOUNCE_COLOR, HERO_BOUNCE_INTENSITY);
    bounceLight.position.set(0, -4, 3);
    bounceLight.castShadow = false;
    scene.add(bounceLight);

    // Initialize your scene somewhere in your code
    createPlanes();
    startPassingTrains();
    loadHDREnvironment(scene);
    loadDefaultTrain(); // Load the HDR environment map
    ensureThesisContentLoaded(); // prepare thesis + studio canvas in background while hero loads

    setupCatenarySegments();
    setupStationSegments();
    createTrackVisualization();

    // ---------------------------------------------------------------------------
    // Post-processing pipeline
    // RenderPass → UnrealBloom (subtle glow on bright surfaces) →
    // Vignette (darkened edges, Blender-render feel) → OutputPass (ACES + sRGB)
    // ---------------------------------------------------------------------------
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    // Bloom at half resolution — same perceived look, half the texture samples.
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2)),
        HERO_BLOOM_STRENGTH,
        HERO_BLOOM_RADIUS,
        HERO_BLOOM_THRESHOLD,
    );
    composer.addPass(bloomPass);

    const vignettePass = new ShaderPass({
        uniforms: {
            tDiffuse: { value: null },
            offset:   { value: HERO_VIGNETTE_OFFSET },
            darkness: { value: HERO_VIGNETTE_DARKNESS },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float offset;
            uniform float darkness;
            varying vec2 vUv;
            void main() {
                vec4 color = texture2D(tDiffuse, vUv);
                vec2 uv = (vUv - 0.5) * 2.0;
                float vignette = clamp(1.0 - (length(uv) - offset) * darkness, 0.0, 1.0);
                gl_FragColor = vec4(color.rgb * vignette, color.a);
            }
        `,
    });
    composer.addPass(vignettePass);

    // OutputPass: applies ACESFilmic tone mapping + sRGB conversion on the way to screen
    const outputPass = new OutputPass();
    outputPass.toneMappingExposure = HERO_TONE_EXPOSURE;
    composer.addPass(outputPass);

    applyHeroRenderSize(window.innerWidth, window.innerHeight);

    window.addEventListener('resize', () => onWindowResize(camera, renderer), false);

    var isAnimating = true;
    var heroRafId = null;

    function animate() {
        heroRafId = null;
        if (!isAnimating || !isSceneVisible || document.hidden) return;

        const delta = clock.getDelta();

        if (heroResumePending) {
            logHeroTrainDisplay('main.js:animate', 'hero render resumed — before placement', 'B', true);
            heroResumePending = false;
        }

        updateMainHeadMotion(delta);
        placeMainTrainCars();
        updatePassingTrains(delta);
        updateFollowCamera();
        updateShadowCamera();

        const preZoomDistance = camera.position.distanceTo(controls.target);
        controls.update();
        captureOrbitZoomIntent(preZoomDistance, camera.position.distanceTo(controls.target));
        updateSmoothCameraZoom(delta);

        composer.render(delta);

        heroRafId = requestAnimationFrame(animate);
    }

    function startHeroRender() {
        if (heroRafId !== null) return;
        heroResumePending = true;
        logHeroTrainDisplay('main.js:startHeroRender', 'hero render starting', 'B', true);
        clock.getDelta(); // drain any stale accumulated delta before first frame
        heroRafId = requestAnimationFrame(animate);
    }

    function stopHeroRender() {
        if (heroRafId !== null) {
            cancelAnimationFrame(heroRafId);
            heroRafId = null;
            logHeroTrainDisplay('main.js:stopHeroRender', 'hero render stopped', 'E', true);
        }
    }

    // expose so builder-mode toggle can resume rendering when needed
    window._heroStartRender = startHeroRender;
    window._heroStopRender  = stopHeroRender;

    startHeroRender();
    initHeroCanvasVisibility();
}

function isHeroOverlayInView(heroEl) {
    if (!heroEl) return false;
    const rect = heroEl.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return rect.bottom > vh * 0.02 && rect.top < vh * (1 - 0.02);
}

function syncHeroRenderVisibility(inView) {
    const hero = document.getElementById('hero-overlay');
    const shouldRender = (inView || document.body.classList.contains('hero-dismissed')) && !document.hidden;
    heroCanvasActive = shouldRender;
    heroDebugLog('main.js:syncHeroRenderVisibility', 'hero visibility sync', {
        inView,
        shouldRender,
        documentHidden: document.hidden,
        heroDismissed: document.body.classList.contains('hero-dismissed'),
        ...getHeroTrainDisplayState(),
    }, 'E');
    if (shouldRender) {
        window._heroStartRender?.();
    } else {
        window._heroStopRender?.();
    }
}

function resumeHeroRenderAfterFocus() {
    if (document.hidden) return;
    const hero = document.getElementById('hero-overlay');
    syncHeroRenderVisibility(isHeroOverlayInView(hero));
}

function initHeroCanvasVisibility() {
    const hero = document.getElementById('hero-overlay');
    if (!hero) return;

    new IntersectionObserver(([entry]) => {
        syncHeroRenderVisibility(entry.isIntersecting);
    }, { threshold: 0.02 }).observe(hero);

    // When builder mode activates, force-resume even if IO hasn't fired yet.
    new MutationObserver(() => {
        if (document.body.classList.contains('hero-dismissed')) {
            syncHeroRenderVisibility(true);
        }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // IO does not re-fire when returning from another window/tab — rAF stops on
    // document.hidden and would otherwise stay frozen.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            window._heroStopRender?.();
        } else {
            resumeHeroRenderAfterFocus();
        }
    });

    window.addEventListener('focus', resumeHeroRenderAfterFocus);

    hero.querySelector('#hero-canvas-wrap')?.addEventListener('pointerdown', () => {
        if (!document.hidden) resumeHeroRenderAfterFocus();
    });
}

function enableSmoothSiteScroll() {
    if (!siteLenisScrollBound) {
        initGlobalLenis({ autoStart: false });
        if (siteScrollHandler) getLenis()?.on('scroll', siteScrollHandler);
        siteLenisScrollBound = true;
    }
    startGlobalLenis();
}

// ---------------------------------------------------------------------------
// Main-train station state machine
// ---------------------------------------------------------------------------
// stationState transitions:
//   'cruise'    – full TRAIN_SPEED
//   'braking'   – decelerating toward zero, target = station mid-point
//   'stopped'   – waiting STATION_DWELL_TIME seconds
//   'departing' – accelerating back to TRAIN_SPEED
// ---------------------------------------------------------------------------

function updateStationStateMachine(delta) {
    if (stationDistances.length === 0) { mainTrainSpeed = TRAIN_SPEED; return; }

    switch (stationState) {
        case 'cruise': {
            mainTrainSpeed = TRAIN_SPEED;
            const next = findNextStationAhead();
            if (next !== null) {
                // Stop with the CENTRE of the train at the station, not the head.
                const halfLen = train.reduce(
                    (s, unit) => s + getUnitTotalLength(unit), 0
                ) / 2;
                const stopPt = clampRouteDistance(next - halfLen);
                const dist = stationDistanceAhead(stopPt);
                if (dist > 0 && dist <= STATION_BRAKE_DISTANCE) {
                    stationState = 'braking';
                    currentStationD  = next;
                    currentStopPoint = stopPt;
                }
            }
            break;
        }
        case 'braking': {
            const distToStop = stationDistanceAhead(currentStopPoint);
            // Wrapped value > half-route means we slightly overshot — snap anyway.
            const overshot = distToStop > routeTotalLength / 2;
            if (distToStop <= 0.05 || overshot) {
                mainHeadDistance = currentStopPoint;
                mainTrainSpeed = 0;
                stationState = 'stopped';
                stationDwellTimer = 0;
            } else {
                // Speed profile: coast at full speed until physics demand a slow-down,
                // then follow sqrt(2·a·d) to arrive at exactly zero at the stop point.
                const profileSpeed = Math.sqrt(2 * STATION_DECEL_RATE * distToStop);
                mainTrainSpeed = Math.max(0, Math.min(mainTrainSpeed, profileSpeed));
            }
            break;
        }
        case 'stopped': {
            mainTrainSpeed = 0;
            // Don't count dwell time until a train car is actually loaded.
            if (!stationWaitingForTrain) stationDwellTimer += delta;
            if (stationDwellTimer >= STATION_DWELL_TIME) {
                stationState = 'departing';
                mainTrainSpeed = 0;
            }
            break;
        }
        case 'departing': {
            mainTrainSpeed = Math.min(TRAIN_SPEED, mainTrainSpeed + STATION_ACCEL_RATE * delta);
            if (mainTrainSpeed >= TRAIN_SPEED) {
                mainTrainSpeed = TRAIN_SPEED;
                stationState = 'cruise';
                currentStationD  = null;
                currentStopPoint = null;
            }
            break;
        }
    }
}

// Drives the main train along the curve. It cruises toward lower route
// distances.
function updateMainHeadMotion(delta) {
    updateStationStateMachine(delta);
    mainHeadDistance = clampRouteDistance(
        mainHeadDistance - mainTrainSpeed * delta,
    );
}

// OrbitControls origin = lead car computed bounding-box center (cyan marker).
const _camOriginTmp = new THREE.Vector3();
const _camOriginDelta = new THREE.Vector3();
const _prevCamOrigin = new THREE.Vector3();
const _leadForwardTmp = new THREE.Vector3();
const _leadSideTmp = new THREE.Vector3();
const _camPositionTmp = new THREE.Vector3();
const _camOrbitOffsetTmp = new THREE.Vector3();
const _yAxisUp = new THREE.Vector3(0, 1, 0);
let zoomTargetDistance = null;
let camOriginTracking = false;
let trackedLeadUuid = null;
let _lastTrainYaw = null;

function resetCameraOriginTracking() {
    camOriginTracking = false;
    trackedLeadUuid = null;
    _lastTrainYaw = null;
}

function getLeadTrainYaw() {
    getLeadTrainBasis(_leadForwardTmp, _leadSideTmp);
    return Math.atan2(_leadForwardTmp.x, _leadForwardTmp.z);
}

function normalizeAngleDelta(delta) {
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
}

function syncControlsSphericalFromCamera() {
    // OrbitControls re-derives its internal spherical from camera.position on
    // every controls.update() call, so no manual sync is needed here.
    // (controls.spherical is a private local, not a public property.)
}

function rotateCameraOrbitByTrainYaw(deltaYaw) {
    if (Math.abs(deltaYaw) < 1e-6) return;
    _camOrbitOffsetTmp.copy(camera.position).sub(controls.target);
    _camOrbitOffsetTmp.applyAxisAngle(_yAxisUp, deltaYaw);
    camera.position.copy(controls.target).add(_camOrbitOffsetTmp);
    syncControlsSphericalFromCamera();
}

function applyCameraOrbitDistance(distance) {
    _camOrbitOffsetTmp.copy(camera.position).sub(controls.target);
    if (_camOrbitOffsetTmp.lengthSq() < 1e-8) return;
    _camOrbitOffsetTmp.setLength(distance);
    camera.position.copy(controls.target).add(_camOrbitOffsetTmp);
}

function captureOrbitZoomIntent(preZoomDistance, postZoomDistance) {
    if (Math.abs(postZoomDistance - preZoomDistance) < 1e-4) return;

    const ratio = postZoomDistance / preZoomDistance;
    const base = zoomTargetDistance ?? preZoomDistance;
    zoomTargetDistance = THREE.MathUtils.clamp(
        base * ratio,
        controls.minDistance,
        controls.maxDistance,
    );
    applyCameraOrbitDistance(preZoomDistance);
}

function updateSmoothCameraZoom(delta) {
    if (zoomTargetDistance === null) return;

    const current = camera.position.distanceTo(controls.target);
    const next = THREE.MathUtils.lerp(
        current,
        zoomTargetDistance,
        1 - Math.exp(-CAMERA_ZOOM_SMOOTH * delta),
    );
    applyCameraOrbitDistance(next);

    if (Math.abs(next - zoomTargetDistance) < 0.02) {
        applyCameraOrbitDistance(zoomTargetDistance);
        zoomTargetDistance = null;
    }
}

function getLeadCarComputedOriginWorld(target = _camOriginTmp) {
    if (train.length === 0) {
        if (noTrainPlaceholder) {
            noTrainPlaceholder.updateMatrixWorld(true);
            return noTrainPlaceholder.getWorldPosition(target);
        }
        const pose = getPoseAtDistance(mainHeadDistance, MAIN_TRACK_OFFSET);
        return target.copy(pose.position);
    }

    const lead = getUnitLeadSegment(train[0]);
    lead.updateMatrixWorld(true);

    const anchor = lead.userData.computedOriginAnchor;
    if (anchor) {
        return anchor.getWorldPosition(target);
    }

    const centerLocal = lead.userData.geometryMetrics?.centerLocal;
    if (centerLocal) {
        return target.copy(centerLocal).applyMatrix4(lead.matrixWorld);
    }

    return lead.getWorldPosition(target);
}

// Orbit target: train XZ on the route, fixed world height from CAMERA_ORIGIN_HEIGHT.
function getCameraOrbitOriginWorld(target = _camOriginTmp) {
    getLeadCarComputedOriginWorld(target);
    target.y = CAMERA_ORIGIN_HEIGHT;
    return target;
}

function getLeadTrainBasis(forward = _leadForwardTmp, side = _leadSideTmp) {
    if (train.length > 0) {
        const lead = getUnitLeadSegment(train[0]);
        lead.updateMatrixWorld(true);
        // GLB models have nose at -Z, so use -Z as the "forward / nose" direction.
        forward.set(0, 0, -1).transformDirection(lead.matrixWorld);
        forward.y = 0;
        if (forward.lengthSq() < 1e-8) {
            const pose = getPoseAtDistance(mainHeadDistance, MAIN_TRACK_OFFSET);
            forward.copy(pose.tangent).multiplyScalar(-1);
        } else {
            forward.normalize();
        }
        side.set(-forward.z, 0, forward.x).normalize();
        return;
    }

    // Fallback: placeholder or no subject — read direction from route.
    if (noTrainPlaceholder) {
        noTrainPlaceholder.updateMatrixWorld(true);
        forward.set(0, 0, -1).transformDirection(noTrainPlaceholder.matrixWorld);
        forward.y = 0;
        if (forward.lengthSq() > 1e-8) {
            forward.normalize();
            side.set(-forward.z, 0, forward.x).normalize();
            return;
        }
    }
    const pose = getPoseAtDistance(mainHeadDistance, MAIN_TRACK_OFFSET);
    forward.copy(pose.tangent).multiplyScalar(-1);
    side.copy(pose.normal);
}

// Move directional shadow frusta with the train, snapped to texel grid to avoid banding.
const _shadowTargetPos = new THREE.Vector3();

function snapDirectionalShadowFollow(light, tx, tz, frustumHalfSize) {
    const mapSize = light.shadow.mapSize.x;
    const texelWorld = (frustumHalfSize * 2) / mapSize;
    const sx = Math.round(tx / texelWorld) * texelWorld;
    const sz = Math.round(tz / texelWorld) * texelWorld;

    light.target.position.set(sx, 0, sz);
    light.position.set(
        sx + HERO_KEY_OFFSET_X, HERO_KEY_OFFSET_Y, sz + HERO_KEY_OFFSET_Z,
    );
    light.target.updateMatrixWorld();
    light.shadow.camera.updateProjectionMatrix();
}

function updateShadowCamera() {
    if (!sunLight) return;
    getLeadCarComputedOriginWorld(_shadowTargetPos);
    const tx = _shadowTargetPos.x;
    const tz = _shadowTargetPos.z;

    snapDirectionalShadowFollow(sunLight, tx, tz, HERO_KEY_SHADOW_FRUSTUM);

    if (sunWideLight) {
        snapDirectionalShadowFollow(sunWideLight, tx, tz, HERO_WIDE_SHADOW_FRUSTUM);
    }
}

function updateFollowCamera() {
    const hasSubject = train.length > 0 || noTrainPlaceholder !== null;
    getCameraOrbitOriginWorld(_camOriginTmp);

    const subjectUuid = train.length > 0
        ? getUnitLeadSegment(train[0]).uuid
        : (noTrainPlaceholder ? noTrainPlaceholder.uuid : null);

    const needsSnap = !camOriginTracking || trackedLeadUuid !== subjectUuid;

    if (needsSnap) {
        if (!camOriginTracking && cameraRotationEnabled) {
            // First snap — head-on front view; user can orbit freely after this.
            controls.target.copy(_camOriginTmp);
            getLeadTrainBasis(_leadForwardTmp, _leadSideTmp);
            _camPositionTmp.copy(_camOriginTmp)
                .addScaledVector(_leadForwardTmp, getHeroCameraFrontOffset())
                .addScaledVector(_leadSideTmp, getHeroCameraSideOffset());
            _camPositionTmp.y = CAMERA_ORIGIN_HEIGHT + getHeroCameraHeightOffset();
            camera.position.copy(_camPositionTmp);
        } else {
            // Preserve whatever orbit offset the user already chose.
            _camOrbitOffsetTmp.copy(camera.position).sub(controls.target);
            controls.target.copy(_camOriginTmp);
            camera.position.copy(_camOriginTmp).add(_camOrbitOffsetTmp);
        }
        syncControlsSphericalFromCamera();
        _lastTrainYaw = cameraRotationEnabled && hasSubject ? getLeadTrainYaw() : null;
        _prevCamOrigin.copy(_camOriginTmp);
        camOriginTracking = true;
        trackedLeadUuid = subjectUuid;
        return;
    }

    // Translate target + camera together as the subject moves along the route.
    _camOriginDelta.subVectors(_camOriginTmp, _prevCamOrigin);
    if (_camOriginDelta.lengthSq() > 0) {
        controls.target.add(_camOriginDelta);
        camera.position.add(_camOriginDelta);
    }

    // Yaw-follow: rotate the user's orbit angle with the train heading — no fixed lock.
    if (cameraRotationEnabled && hasSubject) {
        const yaw = getLeadTrainYaw();
        if (_lastTrainYaw !== null) {
            rotateCameraOrbitByTrainYaw(normalizeAngleDelta(yaw - _lastTrainYaw));
        }
        _lastTrainYaw = yaw;
    } else {
        _lastTrainYaw = null;
    }

    _prevCamOrigin.copy(_camOriginTmp);
}

// Place every car in the user-built train along the curve. The first car's
// computed bounding-box center sits exactly on mainHeadDistance — the same
// point the follow camera uses as its orbit origin.
function placeMainTrainCars() {
    ensureNoTrainPlaceholder();
    logHeroTrainDisplay('main.js:placeMainTrainCars', 'hero train placement', 'A');
    if (train.length === 0) {
        if (noTrainPlaceholder) {
            placeCarOnRoute(noTrainPlaceholder, mainHeadDistance, MAIN_TRACK_OFFSET, -1);
        }
        return;
    }

    let distance = mainHeadDistance;
    const allSegments = [];
    for (const unit of train) {
        for (const seg of unit.segments) allSegments.push(seg);
    }

    for (let i = 0; i < allSegments.length; i++) {
        const car = allSegments[i];
        car.userData.chainDistance = distance;
        placeCarOnRoute(car, distance, MAIN_TRACK_OFFSET, -1);

        if (i < allSegments.length - 1) {
            const nextCar = allSegments[i + 1];
            distance += (car.userData.length || 0) * car.scale.x / 2
                      + (nextCar.userData.length || 0) * nextCar.scale.x / 2;
        }
    }
}

// ---------------------------------------------------------------------------
// Catenary — vertex deformation along the route curve
//
// Rather than rotating each segment as a rigid body (which leaves visible kinks
// on curves), we deform every vertex individually: for each vertex we look up
// the route pose at that vertex's Z-distance along the span, then rebuild the
// vertex's XZ position from the curve's tangent/normal frame while keeping its
// Y (height) unchanged.  This makes the tracks, wires and masts all bend
// naturally around every curve exactly like real infrastructure would.
// ---------------------------------------------------------------------------

const _catV  = new THREE.Vector3();
const _catVW = new THREE.Vector3();
const _catNW = new THREE.Vector3();
const _catMI = new THREE.Matrix4();

function deformCatenarySegment(seg, routeDistance) {
    // seg root has position=(0, CATENARY_Y, 0), scale=(CATENARY_SCALE,…), no rotation.
    // updateMatrixWorld so child mesh matrices are current before we invert them.
    seg.updateMatrixWorld(true);

    const cl = catenaryTemplate.userData.centerLocal;
    const cx = cl.x; // lateral centre of geometry in scaled world-space
    const cz = cl.z; // along-route centre of geometry in scaled world-space

    seg.userData.warpStart = null;
    seg.userData.warpEnd = null;
    seg.userData.minDelta = Infinity;
    seg.userData.maxDelta = -Infinity;

    seg.traverse(node => {
        if (!node.isMesh || !node.geometry) return;

        const posAttr = node.geometry.attributes.position;
        if (!posAttr) return;

        // Clone geometry so each segment has independent vertex data.
        const geo = node.geometry.clone();
        node.geometry = geo;

        _catMI.copy(node.matrixWorld).invert();
        const arr = geo.attributes.position.array;

        for (let i = 0; i < posAttr.count; i++) {
            // Read original vertex and transform to scaled world-space.
            _catV.fromBufferAttribute(posAttr, i);
            _catVW.copy(_catV).applyMatrix4(node.matrixWorld);

            // How far along the route from this segment's centre is this vertex?
            const delta   = _catVW.z - cz;
            // How far laterally from the mast-centre is this vertex?
            const lateral = _catVW.x - cx;

            // Sample route centreline; lateral spread comes from the GLB geometry.
            const pose = getPoseAtDistance(
                clampRouteDistance(routeDistance + delta),
                0,
            );

            const lateralShifted = lateral + CATENARY_LATERAL_SHIFT;

            // New world position: follow curve tangent in XZ, keep height in Y.
            _catNW.set(
                pose.position.x + pose.normal.x * lateralShifted,
                _catVW.y,
                pose.position.z + pose.normal.z * lateralShifted,
            );

            if (delta < seg.userData.minDelta) {
                seg.userData.minDelta = delta;
                seg.userData.warpStart = _catNW.clone();
            }
            if (delta > seg.userData.maxDelta) {
                seg.userData.maxDelta = delta;
                seg.userData.warpEnd = _catNW.clone();
            }

            // Transform back to mesh local space and store.
            _catNW.applyMatrix4(_catMI);
            arr[i * 3    ] = _catNW.x;
            arr[i * 3 + 1] = _catNW.y;
            arr[i * 3 + 2] = _catNW.z;
        }

        geo.attributes.position.needsUpdate = true;
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
    });

    seg.userData.routeCenter = routeDistance;
    seg.userData.routeStart = clampRouteDistance(routeDistance + seg.userData.minDelta);
    seg.userData.routeEnd   = clampRouteDistance(routeDistance + seg.userData.maxDelta);
    seg.userData.routeSpan  = seg.userData.maxDelta - seg.userData.minDelta;
}

function logCatenarySpanReport() {
    if (!SHOW_DEBUG || catenarySegments.length === 0) return;

    const rows = catenarySegments.map((seg, index) => ({
        index,
        center: seg.userData.routeCenter,
        start: seg.userData.routeStart,
        end: seg.userData.routeEnd,
        span: seg.userData.routeSpan,
        startXZ: seg.userData.warpStart
            ? { x: +seg.userData.warpStart.x.toFixed(2), z: +seg.userData.warpStart.z.toFixed(2) }
            : null,
        endXZ: seg.userData.warpEnd
            ? { x: +seg.userData.warpEnd.x.toFixed(2), z: +seg.userData.warpEnd.z.toFixed(2) }
            : null,
    }));

    console.log('[catenary] all segment start/end points (route distance on track centreline):');
    console.table(rows);

    const seams = [];
    for (let i = 0; i < catenarySegments.length; i++) {
        const curr = catenarySegments[i];
        const next = catenarySegments[(i + 1) % catenarySegments.length];
        const isLoopSeam = i === catenarySegments.length - 1;
        let nextStartU = next.userData.routeCenter + next.userData.minDelta;
        const prevEndU = curr.userData.routeCenter + curr.userData.maxDelta;
        if (isLoopSeam) nextStartU += routeTotalLength;
        const seam = nextStartU - prevEndU;
        seams.push({
            from: i,
            to: (i + 1) % catenarySegments.length,
            prevEnd: curr.userData.routeEnd,
            nextStart: next.userData.routeStart,
            seam,
            loopSeam: isLoopSeam,
            status: Math.abs(seam) < 0.05 ? 'ok' : (seam > 0 ? 'gap' : 'overlap'),
        });
    }

    console.log('[catenary] seam check (unwrapped; loop row uses +routeTotalLength on next start):');
    console.table(seams);

    const loopSeamAt = clampRouteDistance(catenarySegments[catenarySegments.length - 1].userData.routeEnd);
    console.log(
        `[catenary] loop closure seam near route distance ${loopSeamAt.toFixed(1)} ` +
        `(CATENARY_ROUTE_OFFSET=${CATENARY_ROUTE_OFFSET}, routeTotalLength=${routeTotalLength.toFixed(1)})`,
    );

    const bad = seams.filter(s => s.status !== 'ok');
    if (bad.length > 0) {
        console.warn(`[catenary] ${bad.length} seam(s) with gap/overlap > 0.05 units`);
    } else {
        console.log('[catenary] all seams within 0.05 units — no significant overlap/gap');
    }
}

const _catDebugLocal = new THREE.Vector3();

function attachCatenaryDebugMarkers(seg) {
    if (!SHOW_DEBUG) return;

    const { warpStart, warpEnd } = seg.userData;
    if (!warpStart || !warpEnd) return;

    const debugGroup = new THREE.Group();
    debugGroup.name = 'catenaryDebug';

    function addDot(worldPos, color) {
        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.35, 12, 12),
            new THREE.MeshBasicMaterial({ color, depthTest: false }),
        );
        _catDebugLocal.copy(worldPos);
        seg.worldToLocal(_catDebugLocal);
        dot.position.copy(_catDebugLocal);
        debugGroup.add(dot);
    }

    // Green = span start, red = span end — adjacent segments should share a dot.
    addDot(warpStart, 0x33ff66);
    addDot(warpEnd, 0xff3333);

    seg.add(debugGroup);
}

async function setupCatenarySegments() {
    try {
        const gltf = await gltfLoader.loadAsync(catenary);
        const template = gltf.scene;
        template.scale.set(CATENARY_SCALE, CATENARY_SCALE, CATENARY_SCALE);
        applyMeshColor(template, CATENARY_COLOR);
        template.traverse(node => {
            if (node.isMesh) {
                node.castShadow = false;
                node.receiveShadow = true;
            }
        });

        // Measure span and pivot offset in scaled world-space.
        const box = new THREE.Box3().setFromObject(template);
        const size   = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        // Span is the longest horizontal axis.
        catenarySegmentLength = Math.max(1, size.x, size.z);
        catenaryTemplate = template;
        catenaryTemplate.userData.centerLocal = center.clone();

        placeCatenarySegments();
    } catch (error) {
        console.error('An error occurred while loading the catenary model:', error);
    }
}

function placeCatenarySegments() {
    if (!catenaryTemplate || !catenaryTemplate.userData.centerLocal) return;

    for (const seg of catenarySegments) scene.remove(seg);
    catenarySegments.length = 0;

    const spacing = catenarySegmentLength * CATENARY_SPACING_SCALE;
    const segmentCount = Math.ceil(routeTotalLength / spacing);

    for (let i = 0; i < segmentCount; i++) {
        const center = clampRouteDistance(CATENARY_ROUTE_OFFSET + i * spacing);
        const seg = catenaryTemplate.clone(true);
        // Only apply Y offset as a root position — all XZ placement comes from
        // vertex deformation so the mesh bends to follow the curve.
        seg.position.set(0, CATENARY_Y, 0);
        seg.rotation.set(0, 0, 0);
        // seg.scale inherits CATENARY_SCALE from the template clone.

        deformCatenarySegment(seg, center);
        attachCatenaryDebugMarkers(seg);

        scene.add(seg);
        catenarySegments.push(seg);
    }

    logCatenarySpanReport();
}


// ---------------------------------------------------------------------------
// Camera rotation toggle
// When ON (default): the camera translates with the train and its horizontal
// orbit rotates with the train heading — but pitch, distance and side angle
// stay whatever the user chose. Auto-rotate when idle only runs in this mode.
// When OFF: camera only translates; world-space orbit angle is frozen.
// ---------------------------------------------------------------------------
let cameraRotationEnabled = true;

function setCameraRotationEnabled(enabled) {
    cameraRotationEnabled = enabled;
    _lastTrainYaw = null;
    if (!enabled) {
        controls.autoRotate = false;
        clearTimeout(interactionTimeout);
    }
}

// Set up a variable to store the timeout ID
let interactionTimeout;

function resetInteractionTimeout() {
    if (!cameraRotationEnabled) return;
    if (!isHeroAutoRotateEnabled()) return;
    clearTimeout(interactionTimeout);
    interactionTimeout = setTimeout(() => {
        startAutoRotate();
    }, getHeroAutoRotateIdleMs());
}

function startAutoRotate() {
    if (!cameraRotationEnabled) return;
    if (!isHeroAutoRotateEnabled()) return;
    controls.autoRotate = true;
}

function stopAutoRotate() {
    controls.autoRotate = false;
    controls.update();
}

$(document).ready(function() {
    $('canvas').on('mousemove mousedown mousewheel touchstart touchmove', function() {
        stopAutoRotate();
        resetInteractionTimeout();
    });

    // Auto-orbit on load; stops while the user interacts, resumes after idle.
    startAutoRotate();
});





// scene

function createPlanes() {
    // Unlit dark base + shadow-only overlay on the same Y — polygon offset prevents z-fighting.
    const groundGroup = new THREE.Group();

    const baseMat = new THREE.MeshBasicMaterial({
        color: GROUND_COLOR,
        depthWrite: true,
    });
    const groundPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(6000, 6000),
        baseMat,
    );
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.y = GROUND_Y;
    groundPlane.renderOrder = 0;
    groundGroup.add(groundPlane);

    const shadowMat = new THREE.ShadowMaterial({
        color: 0x000000,
        transparent: true,
        opacity: GROUND_SHADOW_OPACITY,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
    const shadowCatcher = new THREE.Mesh(
        new THREE.PlaneGeometry(6000, 6000),
        shadowMat,
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = GROUND_Y;
    shadowCatcher.receiveShadow = true;
    shadowCatcher.renderOrder = 1;
    groundGroup.add(shadowCatcher);

    scene.add(groundGroup);
}




function onWindowResize(camera, renderer) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyHeroRenderSize(w, h);
}

let cameraFovAnimationId = null;

function animateCameraFov(targetFov, durationMs = BUILDER_CAMERA_FOV_DURATION_MS) {
    if (!camera) return;
    if (cameraFovAnimationId !== null) {
        cancelAnimationFrame(cameraFovAnimationId);
    }

    const startFov = camera.fov;
    const startTime = performance.now();

    function step(now) {
        const t = Math.min((now - startTime) / durationMs, 1);
        const eased = t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease-in-out cubic
        camera.fov = startFov + (targetFov - startFov) * eased;
        camera.updateProjectionMatrix();
        if (t < 1) {
            cameraFovAnimationId = requestAnimationFrame(step);
        } else {
            cameraFovAnimationId = null;
        }
    }

    cameraFovAnimationId = requestAnimationFrame(step);
}

function enterTrainBuilder() {
    animateCameraFov(BUILDER_CAMERA_FOV, BUILDER_CAMERA_FOV_DURATION_MS);
}

function isMobileTrainspottingViewport() {
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
}

function dismissHeroToTrainspotting() {
    document.body.classList.add('hero-dismissed', 'hero-trainspotting');
    document.getElementById('hero-overlay')?.classList.add('dismissed');
    stopGlobalLenis();
    enterTrainBuilder();
    setCameraRotationEnabled(false);
    stopAutoRotate();
    updateGlobalThesisNav();
}

function exitTrainBuilder() {
    const wasTrainspotting = document.body.classList.contains('hero-trainspotting');
    if (presentationLoopActive) {
        stopBuilderPresentationMode();
    }
    if (isTrainTransitioning) {
        transitionGeneration++;
        collapseConsistAfterTransition();
        restoreConsistRemoveButtons();
        isTrainTransitioning = false;
        setTransitionSpinner(false);
    }

    document.body.classList.remove('hero-dismissed', 'hero-trainspotting');
    document.getElementById('hero-overlay')?.classList.remove('dismissed');
    if (siteLenisScrollBound) startGlobalLenis();
    animateCameraFov(getHeroCameraFov(), BUILDER_CAMERA_FOV_DURATION_MS);

    if (wasTrainspotting) {
        setCameraRotationEnabled(true);
    } else {
        setCameraRotationEnabled($('#builder_cam_follow').hasClass('active'));
    }

    if (cameraRotationEnabled) {
        resetInteractionTimeout();
    }
    updateGlobalThesisNav();
}

// HDRI

function loadHDREnvironment(scene) {
    const rgbeLoader = new RGBELoader();
    rgbeLoader.load('dark_autumn_forest_1k.hdr', function (texture) {
        texture.mapping = THREE.EquirectangularReflectionMapping;

        const pmremGenerator = new PMREMGenerator(renderer);
        pmremGenerator.compileEquirectangularShader();
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        pmremGenerator.dispose();

        // Drive reflections across the whole scene
        scene.environment = envMap;
        scene.environmentIntensity = HERO_ENV_INTENSITY;

        // Push env map onto any already-loaded standard materials
        scene.traverse((object) => {
            if (object.isMesh && object.material && object.material.isMeshStandardMaterial) {
                object.material.envMap = envMap;
                object.material.envMapIntensity = HERO_ENV_INTENSITY;
                object.material.needsUpdate = true;
            }
        });

        texture.dispose();
    });
}







// ── Thesis navigation & YouTube ───────────────────────────────────────────
const YOUTUBE_VIDEO_ID = 'WDghfP8oXvU';
const YOUTUBE_EMBED_BASE = `https://www.youtube-nocookie.com/embed/${YOUTUBE_VIDEO_ID}`;

const THESIS_READ_ORDER = ['intro', 'new_visual', 'thanks', 'history', 'navigation_design', 'abroad', 'sources'];

const THESIS_SECTION_THEME = {
    new_visual: 'dark',
    history: 'light',
    navigation_design: 'light',
    abroad: 'light',
};

const THESIS_SECTIONS = {
    intro: {
        anchor: 'thesis-intro',
        path: '/read',
        historyKey: 'intro',
    },
    new_visual: {
        anchor: 'thesis-new_visual',
        article: '#new_visual_text',
        file: 'content_new_visual.html',
        path: '/new_visual',
        historyKey: 'new_visual',
        next: 'thanks',
        nextLabel: { sk: 'Poďakovanie', en: 'Thank you' },
    },
    thanks: {
        anchor: 'thesis-thanks',
        article: '#thanks_text',
        file: 'content_thanks.html',
        path: '/thanks',
        historyKey: 'thanks',
        next: 'history',
        nextLabel: { sk: 'História náterov', en: 'History of liveries' },
    },
    history: {
        anchor: 'thesis-history',
        article: '#bakalarka_text',
        file: 'content_history.html',
        path: '/history',
        historyKey: 'history',
        next: 'navigation_design',
        nextLabel: { sk: 'Navigačný systém', en: 'Navigation system' },
    },
    navigation_design: {
        anchor: 'thesis-navigation_design',
        article: '#navigation_design_text',
        file: 'content_navigation_design.html',
        path: '/navigation_design',
        historyKey: 'navigation_design',
        next: 'abroad',
        nextLabel: { sk: 'Inšpirácia zo zahraničia', en: 'Inspiration abroad' },
    },
    abroad: {
        anchor: 'thesis-abroad',
        article: '#abroad_text',
        file: 'content_abroad.html',
        path: '/abroad',
        historyKey: 'abroad',
        next: 'sources',
        nextLabel: { sk: 'Zdroje', en: 'Sources' },
    },
    sources: {
        anchor: 'thesis-sources',
        article: '#sources_text',
        file: 'content_sources.html',
        path: '/sources',
        historyKey: 'sources',
    },
};

const PATH_TO_SECTION = Object.fromEntries(
    Object.entries(THESIS_SECTIONS).map(([id, s]) => [s.path, id]),
);

const TOC_HASH_TO_SECTION = new Map();

function indexTocAnchors() {
    TOC_HASH_TO_SECTION.clear();
    document.querySelectorAll('.thesis-chapter .TOC a[href*="#"]').forEach((link) => {
        const hash = getHashFromHref(link.getAttribute('href'));
        const sectionId = sectionIdFromAnchor(link.closest('.thesis-chapter')?.id);
        if (sectionId && hash) TOC_HASH_TO_SECTION.set(hash, sectionId);
    });
}

function getHashFromHref(href) {
    if (!href) return '';
    const i = href.indexOf('#');
    return i >= 0 ? href.slice(i + 1) : '';
}

function isLangEn() {
    return document.body.classList.contains('lang-en');
}

function uiT(pair) {
    return isLangEn() ? pair.en : pair.sk;
}

/** Apply data-i18n-aria-* and data-i18n-title-* to aria-label / title attributes. */
function applySiteI18n() {
    const en = isLangEn();
    document.querySelectorAll('[data-i18n-aria-en]').forEach((el) => {
        const label = en ? el.dataset.i18nAriaEn : el.dataset.i18nAriaSk;
        if (label) el.setAttribute('aria-label', label);
    });
    document.querySelectorAll('[data-i18n-title-en]').forEach((el) => {
        const title = en ? el.dataset.i18nTitleEn : el.dataset.i18nTitleSk;
        if (title) el.setAttribute('title', title);
    });
    document.documentElement.lang = en ? 'en' : 'sk';
}

function isElementVisibleForLang(el) {
    if (!el) return false;
    if (el.classList.contains('sk') && isLangEn()) return false;
    if (el.classList.contains('en') && !isLangEn()) return false;
    return true;
}

function resolveThesisHash(hash) {
    if (!hash) return { sectionId: null, hash: null };
    if (hash.startsWith('vehicle-')) return { sectionId: 'new_visual', hash };

    const sectionFromThesisAnchor = sectionIdFromAnchor(hash);
    if (sectionFromThesisAnchor) return { sectionId: sectionFromThesisAnchor, hash: null };

    const sectionFromToc = TOC_HASH_TO_SECTION.get(hash);
    if (sectionFromToc) return { sectionId: sectionFromToc, hash };

    for (const id of THESIS_READ_ORDER) {
        if (id === 'intro') continue;
        const section = THESIS_SECTIONS[id];
        const article = document.querySelector(section.article);
        if (article?.querySelector(`#${CSS.escape(hash)}`)) {
            return { sectionId: id, hash };
        }
    }

    return { sectionId: null, hash: null };
}

function getSectionTocAnchors(sectionId) {
    const section = THESIS_SECTIONS[sectionId];
    const chapter = document.getElementById(section?.anchor);
    if (!chapter) return [];

    const anchors = [];
    chapter.querySelectorAll('.TOC a').forEach((link) => {
        if (!isElementVisibleForLang(link)) return;
        const hash = getHashFromHref(link.getAttribute('href'));
        const el = document.getElementById(hash);
        if (el) anchors.push({ hash, top: el.offsetTop });
    });

    return anchors.sort((a, b) => a.top - b.top);
}

function getActiveSubsectionHash(sectionId) {
    if (!sectionId || sectionId === 'intro') return null;
    if (sectionId === 'new_visual') return getActiveShowcaseVehicleHash();

    const scrollPos = getReadScrollProbeY();
    let activeHash = null;

    for (const { hash, top } of getSectionTocAnchors(sectionId)) {
        if (top <= scrollPos) activeHash = hash;
    }

    return activeHash;
}

function suspendScrollUrlSync(ms = 1400) {
    scrollUrlSyncLockUntil = Date.now() + ms;
}

function isScrollUrlSyncSuspended() {
    return Date.now() < scrollUrlSyncLockUntil;
}

function buildSiteUrl(sectionId, hash) {
    if (!sectionId) return '/';
    const section = THESIS_SECTIONS[sectionId];
    if (!section) return '/read';
    if (hash) {
        if (section.path && section.path !== '/read') return `${section.path}#${hash}`;
        return `/read#${hash}`;
    }
    if (sectionId === 'intro') return '/read';
    return section.path || `/read#${section.anchor}`;
}

function getCurrentSiteUrl() {
    return `${window.location.pathname}${window.location.hash || ''}`;
}

function getReadScrollProbeY() {
    const chromeH = document.getElementById('read-chrome')?.offsetHeight || 0;
    return window.scrollY + chromeH + 40;
}

function isPastHeroSection() {
    const hero = document.getElementById('hero-overlay');
    if (!hero) return true;
    return window.scrollY > hero.offsetHeight - 80;
}

function getActiveThesisSectionId() {
    const scrollPos = getReadScrollProbeY();
    let activeId = null;

    for (const id of THESIS_READ_ORDER) {
        const el = document.getElementById(THESIS_SECTIONS[id].anchor);
        if (el && el.offsetTop <= scrollPos) activeId = id;
    }

    return activeId;
}

function getActiveShowcaseVehicleHash() {
    const panels = document.querySelectorAll('.showcase-panel');
    if (!panels.length) return null;

    const mid = window.innerHeight / 2;
    let best = null;
    let bestDist = Infinity;

    for (const panel of panels) {
        const rect = panel.getBoundingClientRect();
        const dist = Math.abs((rect.top + rect.bottom) / 2 - mid);
        if (dist < bestDist) {
            bestDist = dist;
            best = panel;
        }
    }

    return best?.id?.startsWith('vehicle-') ? best.id : null;
}

function getActiveScrollLocation() {
    if (document.body.classList.contains('hero-dismissed')) {
        return { sectionId: null, hash: null };
    }
    if (!isPastHeroSection()) {
        return { sectionId: null, hash: null };
    }

    const sectionId = getActiveThesisSectionId() || 'intro';
    const hash = getActiveSubsectionHash(sectionId);
    return { sectionId, hash };
}

function scheduleUrlFromScroll() {
    if (scrollUrlSyncRaf) return;
    scrollUrlSyncRaf = requestAnimationFrame(() => {
        scrollUrlSyncRaf = null;
        updateUrlFromScroll();
    });
}

function updateUrlFromScroll() {
    if (isScrollUrlSyncSuspended()) return;
    if (document.body.classList.contains('hero-loading')) return;

    const { sectionId, hash } = getActiveScrollLocation();
    const nextUrl = buildSiteUrl(sectionId, hash);
    if (nextUrl === lastScrollSyncUrl || nextUrl === getCurrentSiteUrl()) return;

    lastScrollSyncUrl = nextUrl;
    window.history.replaceState(
        { section: sectionId || 'hero', hash: hash || undefined, mode: sectionId ? 'read' : 'play' },
        '',
        nextUrl,
    );
}
function syncScrollUrlState(url = getCurrentSiteUrl()) {
    lastScrollSyncUrl = url;
    suspendScrollUrlSync();
}

let scrollUrlSyncLockUntil = 0;
let lastScrollSyncUrl = null;
let scrollUrlSyncRaf = null;
let thesisContentLoaded = false;
let thesisContentLoading = null;
let readScrollSaveTimer = null;

function getReadScrollOffset() {
    const chromeH = document.getElementById('read-chrome')?.offsetHeight || 0;
    return -(chromeH + 8);
}

function sectionIdFromAnchor(anchor) {
    if (!anchor) return null;
    if (anchor.startsWith('thesis-')) {
        return anchor.slice('thesis-'.length);
    }
    for (const [id, section] of Object.entries(THESIS_SECTIONS)) {
        if (section.anchor === anchor) return id;
    }
    return null;
}

const CATALOG_TO_VISUAL_ANCHOR = {
    KissPredok: 'vehicle-kiss',
    KissStred: 'vehicle-kiss',
    KissCumakKoniec: 'vehicle-kiss',
    tatra: 'vehicle-tatra',
    delfin: 'vehicle-delfin',
    dmu861koniec: 'vehicle-dmu861',
    dmu861stred: 'vehicle-dmu861',
    dmu861zaciatok: 'vehicle-dmu861',
    panterPredok: 'vehicle-panter',
    panterStred: 'vehicle-panter',
    panterZadok: 'vehicle-panter',
    janosikpredok: 'vehicle-janosik',
    janosikstred: 'vehicle-janosik',
    janosikriadiaci: 'vehicle-janosik',
    lok383: 'vehicle-vectron',
    dmu810: 'vehicle-dmu810',
    lok363: 'vehicle-lok363',
    lok350: 'vehicle-lok363',
    lok754: 'vehicle-lok754',
    lok380: 'vehicle-lok380',
    lok240: 'vehicle-lok240',
    lok210: 'vehicle-lok210',
};

let thesisNavAdjustHeight = () => {};

function getVisualAnchorForCatalogId(catalogId) {
    return CATALOG_TO_VISUAL_ANCHOR[catalogId] || null;
}

function openYouTubeModal() {
    const modal = document.getElementById('video-modal');
    const iframe = document.getElementById('video-modal-iframe');
    if (!modal || !iframe) return;
    iframe.src = `${YOUTUBE_EMBED_BASE}?autoplay=1&rel=0`;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('video-modal-open');
    showVideoPill();
    try { localStorage.setItem('thesis-video-seen', '1'); } catch (_) { /* ignore */ }
}

function closeYouTubeModal() {
    const modal = document.getElementById('video-modal');
    const iframe = document.getElementById('video-modal-iframe');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('video-modal-open');
    if (iframe) iframe.src = '';
}

function showVideoPill() {
    const pill = document.getElementById('video-pill');
    if (pill) {
        pill.hidden = false;
        pill.classList.add('visible');
    }
}

function maybeShowVideoPill() {
    try {
        if (localStorage.getItem('thesis-video-seen') === '1') showVideoPill();
    } catch (_) { /* ignore */ }
}

function toggleThesisMenu(open) {
    const menu = $('#menu');
    if (open === undefined) open = !menu.hasClass('menu-open');
    if (open) {
        menu.addClass('menu-open');
        $('#menu a').addClass('rolledout');
    } else {
        menu.removeClass('menu-open');
        $('#menu a').removeClass('rolledout');
    }
}

function ensureThesisContentLoaded() {
    if (thesisContentLoaded) return Promise.resolve();
    if (thesisContentLoading) return thesisContentLoading;

    thesisContentLoading = Promise.all(
        THESIS_READ_ORDER.filter((id) => id !== 'intro').map((id) => {
            const section = THESIS_SECTIONS[id];
            const $article = $(section.article);
            if ($article.children().length > 0) return Promise.resolve();
            return new Promise((resolve) => {
                $article.load(section.file, resolve);
            });
        }),
    ).then(() => {
        THESIS_READ_ORDER.forEach((id) => {
            if (id === 'intro') return;
            injectThesisEnhancements(id, $(THESIS_SECTIONS[id].article));
        });
        initStudioShowcase({ createTrainModel });
        initImageLightbox();
        initRenderSliders();
        applySiteI18n();
        thesisContentLoaded = true;
        thesisNavAdjustHeight();
    });

    return thesisContentLoading;
}

function injectThesisEnhancements(sectionId, $article) {
    $article.find('.thesis-next-chapter').remove();

    const section = THESIS_SECTIONS[sectionId];
    if (!section?.next) return;

    const theme = THESIS_SECTION_THEME[sectionId] || 'light';

    const footer = $(`
        <nav class="thesis-next-chapter thesis-next-chapter--${theme}">
            <span class="sk">Ďalej v práci</span>
            <span class="en">Continue reading</span>
            <button type="button" class="thesis-next-btn" data-next="${section.next}">
                <span class="sk">${section.nextLabel.sk} →</span>
                <span class="en">${section.nextLabel.en} →</span>
            </button>
        </nav>
    `);
    footer.find('.thesis-next-btn').on('click', () => {
        scrollToThesisSection(section.next, { pushState: true });
    });
    $article.append(footer);
}

function scrollToThesisTarget({ sectionId, hash, behavior = 'smooth' } = {}) {
    let target = null;

    if (hash) {
        target = document.getElementById(hash);
    }
    if (!target && sectionId && THESIS_SECTIONS[sectionId]) {
        target = document.getElementById(THESIS_SECTIONS[sectionId].anchor);
    }
    if (!target) {
        target = document.getElementById('thesis-intro');
    }

    if (target) {
        scrollToElement(target, {
            offset: getReadScrollOffset(),
            immediate: behavior === 'auto',
        });
    }
}

function updateReadProgress() {
    const fill = document.getElementById('read-progress-fill');
    const doc = document.getElementById('thesis-document');
    if (!fill || !doc) return;

    const docTop = doc.getBoundingClientRect().top + window.scrollY;
    const max = doc.offsetHeight + docTop - window.innerHeight;
    const scrolled = window.scrollY - docTop + window.innerHeight * 0.15;
    const pct = max > docTop ? Math.min(100, Math.max(0, (scrolled / (max - docTop)) * 100)) : 0;
    fill.style.width = `${pct}%`;
}

function updateReadNavHighlight() {
    const activeId = getActiveThesisSectionId();

    document.querySelectorAll('.read-nav-link').forEach((link) => {
        link.classList.toggle('active', link.dataset.section === activeId);
    });
}

function updateTocHighlight() {
    const { sectionId, hash } = getActiveScrollLocation();
    const sectionAnchors = sectionId ? getSectionTocAnchors(sectionId) : [];
    const fallbackHash = sectionAnchors[0]?.hash || null;

    document.querySelectorAll('.thesis-chapter .TOC a').forEach((link) => {
        if (!isElementVisibleForLang(link)) return;
        const linkHash = getHashFromHref(link.getAttribute('href'));
        const linkSectionId = sectionIdFromAnchor(link.closest('.thesis-chapter')?.id);
        const activeHash = hash || fallbackHash;
        link.classList.toggle('active', linkSectionId === sectionId && activeHash === linkHash);
    });
}

function saveReadingScrollPosition() {
    try {
        sessionStorage.setItem('thesis-scroll-y', String(window.scrollY));
    } catch (_) { /* ignore */ }
}

function restoreReadingScrollPosition() {
    try {
        const y = sessionStorage.getItem('thesis-scroll-y');
        if (y != null) {
            requestAnimationFrame(() => {
                window.scrollTo(0, parseInt(y, 10) || 0);
                updateReadProgress();
                updateReadNavHighlight();
                updateTocHighlight();
                const { sectionId, hash } = getActiveScrollLocation();
                const url = buildSiteUrl(sectionId, hash);
                lastScrollSyncUrl = url;
                window.history.replaceState(
                    { section: sectionId || 'hero', hash: hash || undefined, mode: sectionId ? 'read' : 'play' },
                    '',
                    url,
                );
                suspendScrollUrlSync(600);
            });
        }
    } catch (_) { /* ignore */ }
}

function buildReadingUrl(sectionId, hash) {
    return buildSiteUrl(sectionId, hash);
}

async function navigateToThesis({ sectionId, hash, pushState = true, restoreScroll = false } = {}) {
    if (sectionId === 'video') {
        openYouTubeModal();
        return;
    }
    if (sectionId === 'menu') {
        toggleThesisMenu(true);
        return;
    }

    toggleThesisMenu(false);

    if (sectionId && sectionId !== 'intro') {
        await ensureThesisContentLoaded();
    }

    if (restoreScroll) {
        restoreReadingScrollPosition();
    } else if (sectionId || hash) {
        requestAnimationFrame(() => {
            scrollToThesisTarget({ sectionId, hash });
            updateReadProgress();
            updateReadNavHighlight();
        });
    }

    if (pushState) {
        const url = buildSiteUrl(sectionId, hash);
        window.history.pushState(
            { section: sectionId || 'read', hash: hash || undefined, mode: 'read' },
            '',
            url,
        );
        syncScrollUrlState(url);
    } else {
        syncScrollUrlState();
    }
}

/** @deprecated alias — continuous scroll, no mode switch */
async function enterReadingMode(options = {}) {
    return navigateToThesis(options);
}

function exitReadingMode({ pushState = true } = {}) {
    toggleThesisMenu(false);
    if (document.body.classList.contains('hero-dismissed')) {
        exitTrainBuilder();
    }
    scrollToElement(document.getElementById('hero-overlay'), { offset: 0, immediate: false });
    if (pushState) {
        window.history.pushState({ section: 'hero', mode: 'play' }, '', '/');
        syncScrollUrlState('/');
    } else {
        syncScrollUrlState('/');
    }
}

async function scrollToThesisSection(sectionId, { hash, pushState = true } = {}) {
    if (sectionId && sectionId !== 'intro') {
        await ensureThesisContentLoaded();
    }
    scrollToThesisTarget({ sectionId, hash });
    updateReadNavHighlight();

    if (pushState) {
        const url = buildSiteUrl(sectionId, hash);
        window.history.pushState(
            { section: sectionId, hash: hash || undefined, mode: 'read' },
            '',
            url,
        );
        syncScrollUrlState(url);
    } else {
        syncScrollUrlState();
    }
}

function openThesisSection(sectionId, options = {}) {
    if (sectionId === 'trains') {
        exitReadingMode(options);
        return;
    }
    navigateToThesis({ sectionId, hash: options.hash, pushState: options.pushState !== false });
}

function handleThesisRouting() {
    syncScrollUrlState();
    const path = window.location.pathname;
    const hash = window.location.hash?.slice(1) || '';

    if (path === '/read') {
        const resolved = resolveThesisHash(hash);
        navigateToThesis({
            sectionId: resolved.sectionId || 'intro',
            hash: resolved.hash || undefined,
            pushState: false,
            restoreScroll: !hash,
        });
        return;
    }

    const legacySection = PATH_TO_SECTION[path];
    if (legacySection) {
        const resolved = resolveThesisHash(hash);
        navigateToThesis({
            sectionId: legacySection,
            hash: resolved.sectionId === legacySection ? (resolved.hash || undefined) : (hash || undefined),
            pushState: false,
        });
        return;
    }

    if (path === '/' || path === '') {
        if (!document.body.classList.contains('hero-loaded')) {
            scrollToTopImmediate();
            lockSiteScrollForLoading();
        }
    }
}

function closeAllThesisOverlays() {
    toggleThesisMenu(false);
}

function openVisualDesignForCatalogId(catalogId) {
    if (document.body.classList.contains('hero-dismissed')) {
        exitTrainBuilder();
    }
    const anchor = getVisualAnchorForCatalogId(catalogId);
    scrollToThesisSection('new_visual', { hash: anchor || undefined });
}

function getFirstLinkableCatalogIdInConsist() {
    for (const el of document.querySelectorAll('#current_train .consist-car')) {
        if (el.id && getVisualAnchorForCatalogId(el.id)) return el.id;
    }
    return null;
}

function updateBuilderReadLink() {
    const btn = document.getElementById('builder-car-read');
    if (!btn) return;
    const catalogId = getFirstLinkableCatalogIdInConsist();
    if (catalogId) {
        btn.hidden = false;
        btn.dataset.catalogId = catalogId;
    } else {
        btn.hidden = true;
        delete btn.dataset.catalogId;
    }
}

function updateGlobalThesisNav() {
    /* play-mode nav hooks */
}

function initSiteFooter() {
    const footer = document.getElementById('site-footer');
    if (!footer) return;

    footer.addEventListener('click', (e) => {
        const link = e.target.closest('[data-footer-action]');
        if (!link) return;
        e.preventDefault();

        const action = link.dataset.footerAction;
        if (action === 'video') {
            openYouTubeModal();
            return;
        }
        if (action === 'builder') {
            dismissHeroToBuilder();
            return;
        }
        if (action === 'top') {
            if (document.body.classList.contains('hero-dismissed')) {
                exitTrainBuilder();
            }
            scrollToElement(document.getElementById('hero-overlay'), { offset: 0 });
            return;
        }
        if (THESIS_SECTIONS[action]) {
            scrollToThesisSection(action);
        }
    });
}

function initThesisNavigation() {
    initSiteFooter();
    indexTocAnchors();

    thesisNavAdjustHeight = function adjustStoryHeight() {
        const $story = $('#bakalarka_text');
        $story.css('height', 'auto');
    };

    $('#menu a').each(function (index) {
        $(this).css('transition-delay', `${index * 0.08}s`);
    });

    document.getElementById('site-menu-btn')?.addEventListener('click', () => toggleThesisMenu());

    $('#watch_video').on('click', (e) => { e.preventDefault(); openYouTubeModal(); toggleThesisMenu(false); });
    $('#new_visual').on('click', (e) => { e.preventDefault(); scrollToThesisSection('new_visual'); toggleThesisMenu(false); });
    $('#thanks').on('click', (e) => { e.preventDefault(); scrollToThesisSection('thanks'); toggleThesisMenu(false); });
    $('#History').on('click', (e) => { e.preventDefault(); scrollToThesisSection('history'); toggleThesisMenu(false); });
    $('#navigation_design').on('click', (e) => { e.preventDefault(); scrollToThesisSection('navigation_design'); toggleThesisMenu(false); });
    $('#abroad').on('click', (e) => { e.preventDefault(); scrollToThesisSection('abroad'); toggleThesisMenu(false); });
    $('#sources').on('click', (e) => { e.preventDefault(); scrollToThesisSection('sources'); toggleThesisMenu(false); });
    $('#3dtrains').on('click', (e) => {
        e.preventDefault();
        toggleThesisMenu(false);
        dismissHeroToBuilder();
    });

    document.getElementById('read-watch-video')?.addEventListener('click', openYouTubeModal);
    document.getElementById('thesis-intro-watch')?.addEventListener('click', openYouTubeModal);

    document.querySelectorAll('.read-nav-link').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            scrollToThesisSection(link.dataset.section);
        });
    });

    document.querySelectorAll('.thesis-chapter .TOC a[href*="#"]').forEach((link) => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const hash = getHashFromHref(link.getAttribute('href'));
            const sectionId = sectionIdFromAnchor(link.closest('.thesis-chapter')?.id);
            if (!sectionId || !hash) return;
            await scrollToThesisSection(sectionId, { hash, pushState: true });
        });
    });

    document.getElementById('hero-video-card')?.addEventListener('click', openYouTubeModal);
    document.getElementById('hero-video-card')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openYouTubeModal();
        }
    });

    document.getElementById('video-pill')?.addEventListener('click', openYouTubeModal);
    document.querySelector('.video-modal-close')?.addEventListener('click', closeYouTubeModal);
    document.querySelector('.video-modal-backdrop')?.addEventListener('click', closeYouTubeModal);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeYouTubeModal();
    });

    document.getElementById('builder-car-read')?.addEventListener('click', () => {
        const catalogId = getFirstLinkableCatalogIdInConsist();
        if (catalogId) openVisualDesignForCatalogId(catalogId);
    });

    function onScroll() {
        const hero = document.getElementById('hero-overlay');
        const pastHero = hero && window.scrollY > hero.offsetHeight - 80;
        document.body.classList.toggle('site-scrolled', Boolean(pastHero));
        updatePageTopClass();
        updateReadProgress();
        updateReadNavHighlight();
        updateTocHighlight();
        scheduleUrlFromScroll();
        clearTimeout(readScrollSaveTimer);
        readScrollSaveTimer = setTimeout(saveReadingScrollPosition, 200);
    }

    siteScrollHandler = onScroll;
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    window.onpopstate = () => handleThesisRouting();

    ensureThesisContentLoaded();
    handleThesisRouting();
    maybeShowVideoPill();
    updateGlobalThesisNav();

    new MutationObserver(updateGlobalThesisNav).observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
    });
}

// UI — train builder initialized after module-scope helpers below

$(document).ready(function() {
    initCustomCursor();
    initThesisNavigation();

    function updateLangSwitchLabel() {
        const btn = document.getElementById('lang-switch');
        if (!btn) return;
        const isEn = $('body').hasClass('lang-en');
        btn.textContent = isEn ? 'SK' : 'EN';
        btn.setAttribute('aria-pressed', isEn ? 'false' : 'true');
    }

    const savedLang = localStorage.getItem('language');
    if (savedLang === 'sk') {
        $('body').removeClass('lang-en');
    } else {
        $('body').addClass('lang-en');
        if (!savedLang) localStorage.setItem('language', 'en');
    }

    updateLangSwitchLabel();
    applySiteI18n();

    document.getElementById('lang-switch')?.addEventListener('click', () => {
        if ($('body').hasClass('lang-en')) {
            $('body').removeClass('lang-en');
            localStorage.setItem('language', 'sk');
        } else {
            $('body').addClass('lang-en');
            localStorage.setItem('language', 'en');
        }
        updateLangSwitchLabel();
        applySiteI18n();
    });

    $('.language-toggle').click(function() {
        document.getElementById('lang-switch')?.click();
    });
});







// my train — see initTrainBuilderUI() at module scope



// ---------------------------------------------------------------------------
// Module-scope train-building helpers
// These must live outside $(document).ready so loadDefaultTrain (called from
// init()) can reach them before jQuery's ready callback fires.
// ---------------------------------------------------------------------------
function loadAndPositionModel(id) {
    const generation = trainGeneration;
    trainLoadQueue = trainLoadQueue.then(async () => {
        if (generation !== trainGeneration) return;
        await addTrainModel(id, generation);
    }).catch((error) => {
        console.error('An error happened while loading the model:', error);
    });
    return trainLoadQueue;
}

async function addTrainModel(id, generation) {
    try {
        const unit = await createTrainUnit(id);
        if (generation !== trainGeneration) {
            removeUnitFromScene(unit);
            return;
        }
        addUnitToScene(unit);
        train.push(unit);
        logHeroTrainDisplay('main.js:addTrainModel', `train car added: ${id}`, 'D', true);
        // First car loaded — start the station dwell countdown now.
        stationWaitingForTrain = false;
        placeMainTrainCars();
    } catch (error) {
        console.error('An error happened while loading the model:', error);
    }
}

function copyTrainSelectionToCurrentTrain(id) {
    appendConsistCarUI(id);
}

// ---------------------------------------------------------------------------
// Default trains loaded on page startup
// Three hand-picked configurations randomly selected on first load.
// Edit these to your liking — they use the same model IDs as the builder.
// ---------------------------------------------------------------------------
const DEFAULT_TRAIN_CONFIGS = [
    ['lok380', 'ampeer', 'wrrm', 'bds', 'bmz', 'bmpeer', 'bmpeer', 'bmz', 'bmz', 'bmz', 'bmz'],
    ['KissPredok', 'KissStred', 'KissStred', 'KissStred', 'KissStred', 'KissCumakKoniec'],
    ['panterPredok', 'panterStred', 'panterStred', 'panterStred', 'panterZadok'],
];

// ---------------------------------------------------------------------------
// Train builder UI (Option A — consist editor)
// ---------------------------------------------------------------------------
const TRAIN_CATEGORY = {
    lok383: 'locos', lok380: 'locos', lok350: 'locos', lok363: 'locos',
    lok240: 'locos', lok754: 'locos', lok210: 'locos',
    KissPredok: 'emu', KissStred: 'emu', KissCumakKoniec: 'emu',
    panterPredok: 'emu', panterStred: 'emu', panterZadok: 'emu',
    janosikriadiaci: 'emu', janosikstred: 'emu', janosikpredok: 'emu',
    dmu861zaciatok: 'emu', dmu861stred: 'emu', dmu861koniec: 'emu',
    delfin: 'emu', tatra: 'emu', dmu810: 'emu',
    ampeer: 'coaches', bmpeer: 'coaches', bmz: 'coaches', bds: 'coaches',
    wrrm: 'special', wlab: 'special',
};

const BUILDER_PRESETS = [
    { label: 'InterCity', config: DEFAULT_TRAIN_CONFIGS[0] },
    { label: 'Kiss EMU', config: DEFAULT_TRAIN_CONFIGS[1] },
    { label: 'Panter EMU', config: DEFAULT_TRAIN_CONFIGS[2] },
];

const RANDOM_TRAIN_CONFIGS = [
    ['KissPredok', 'KissStred', 'KissStred', 'KissStred', 'KissStred', 'KissCumakKoniec'],
    ['panterPredok', 'panterStred', 'panterStred', 'panterStred', 'panterZadok'],
    ['panterPredok', 'panterStred', 'panterStred', 'panterZadok'],
    ['dmu861zaciatok', 'dmu861stred', 'dmu861koniec'],
    ['dmu810', 'dmu810'],
    ['tatra', 'tatra'],
    ['janosikpredok', 'janosikstred', 'janosikriadiaci'],
    ['lok240', 'wlab', 'wlab', 'bmz', 'bmz', 'bmz'],
    ['lok210', 'wlab', 'wlab', 'bmz', 'bmz', 'bmz'],
    ['lok380', 'ampeer', 'wrrm', 'bds', 'bmz', 'bmpeer', 'bmz', 'bmz'],
    ['lok350', 'ampeer', 'wrrm', 'bds', 'bmz', 'bmpeer', 'bmz', 'bmz'],
];

// Delay between each car step when presets / surprise / presentation swap trains.
const TRAIN_TRANSITION_STEP_MS = 150;

let lenisConsist = null;
let lenisCatalog = null;
let isClearingTrains = false;
let isTrainTransitioning = false;
let transitionGeneration = 0;
let presentationLoopActive = false;

function resizeBuilderScroll() {
    lenisConsist?.resize();
    lenisCatalog?.resize();
}

function isBuilderLocked() {
    return isTrainTransitioning || isClearingTrains;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function setTransitionSpinner(active) {
    document.getElementById('builder-transition-spinner')?.classList.toggle('active', active);
    document.getElementById('control')?.classList.toggle('builder-locked', active);
}

function buildConsistCarElement(id) {
    const template = $(`#train_menu .train_selection#${CSS.escape(id)}`).first();
    if (!template.length) return null;

    const car = template.clone()
        .removeClass('catalog-car hidden')
        .addClass('consist-car');
    car.find('.select_box').remove();
    if (!isTrainTransitioning) {
        car.append(
            '<button type="button" class="consist-remove" data-i18n-aria-en="Remove car" data-i18n-aria-sk="Odstrániť vagón" data-tip-en="Remove this car" data-tip-sk="Odstrániť vozidlo">&times;</button>',
        );
    }
    return car;
}

function isLocomotiveCatalogId(id) {
    return TRAIN_CATEGORY[id] === 'locos';
}

/** UI index among .consist-car tiles: after leading locomotives, or 0 if none. */
function getLocomotiveInsertIndex() {
    const cars = document.querySelectorAll('#current_train .consist-car');
    for (let i = 0; i < cars.length; i++) {
        if (!isLocomotiveCatalogId(cars[i].id)) return i;
    }
    return cars.length;
}

function consistCarIndexToTrainIndex(carIndex) {
    const container = document.getElementById('current_train');
    if (!container) return carIndex;

    let carCount = 0;
    let trainIndex = 0;
    for (const child of container.children) {
        if (child.classList.contains('consist-car')) {
            if (carCount === carIndex) return trainIndex;
            carCount++;
            trainIndex++;
        } else if (child.classList.contains('consist-gap')) {
            trainIndex++;
        }
    }
    return trainIndex;
}

function resolveCatalogInsertIndex(id, preferredCarIndex = null, snapLocoToFront = false) {
    if (snapLocoToFront && isLocomotiveCatalogId(id)) return getLocomotiveInsertIndex();
    if (typeof preferredCarIndex === 'number') return preferredCarIndex;
    return document.querySelectorAll('#current_train .consist-car').length;
}

function addCatalogCarToConsist(id, preferredCarIndex = null, snapLocoToFront = false) {
    if (!isCatalogLogicalId(id)) return;
    const carIndex = resolveCatalogInsertIndex(id, preferredCarIndex, snapLocoToFront);
    const trainIndex = consistCarIndexToTrainIndex(carIndex);
    insertConsistCarUIAt(id, carIndex);
    loadAndInsertModel(id, trainIndex);
}

function appendConsistCarUI(id) {
    insertConsistCarUIAt(id, resolveCatalogInsertIndex(id, null, true));
}

function createGapPlaceholder(length) {
    const group = new THREE.Group();
    group.userData.isGapPlaceholder = true;
    group.userData.length = length;
    return group;
}

function createConsistGapUI(widthPx) {
    return $('<div class="consist-gap"></div>').css('min-width', `${Math.max(widthPx, 32)}px`);
}

async function swapConsistAt(index, newId, gen) {
    const existing = train[index];
    if (existing && !existing.isGapPlaceholder && existing.logicalId === newId) {
        return;
    }

    removeUnitFromScene(existing);

    const unit = await createTrainUnit(newId);
    if (gen !== transitionGeneration) {
        removeUnitFromScene(unit);
        return;
    }

    addUnitToScene(unit);
    train[index] = unit;
    placeMainTrainCars();

    const car = buildConsistCarElement(newId);
    const $container = $('#current_train');
    if (car) {
        if (index < $container.children().length) {
            $container.children().eq(index).replaceWith(car);
        } else {
            $container.append(car);
        }
    }
    resizeBuilderScroll();
}

async function insertConsistAt(index, newId, gen) {
    const unit = await createTrainUnit(newId);
    if (gen !== transitionGeneration) {
        removeUnitFromScene(unit);
        return;
    }

    addUnitToScene(unit);

    if (index >= train.length) {
        train.push(unit);
    } else {
        train.splice(index, 0, unit);
    }
    placeMainTrainCars();

    const car = buildConsistCarElement(newId);
    const $container = $('#current_train');
    if (car) {
        if (index >= $container.children().length) {
            $container.append(car);
        } else {
            $container.children().eq(index).before(car);
        }
    }
    resizeBuilderScroll();
}

function deleteConsistAtWithGap(index) {
    const existing = train[index];
    if (!existing) return;

    const refSeg = getUnitLeadSegment(existing);
    const refScale = refSeg?.scale?.x ?? 0.5;
    const gapLength = getUnitTotalLength(existing) / refScale;
    const $slot = $('#current_train').children().eq(index);
    const gapWidth = $slot.outerWidth() || 48;

    removeUnitFromScene(existing);

    const gapUnit = createGapUnit(gapLength, existing);
    train[index] = gapUnit;
    placeMainTrainCars();

    $slot.replaceWith(createConsistGapUI(gapWidth));
    resizeBuilderScroll();
}

function collapseConsistAfterTransition() {
    for (let i = train.length - 1; i >= 0; i--) {
        if (train[i]?.isGapPlaceholder) {
            removeUnitFromScene(train[i]);
            train.splice(i, 1);
        }
    }
    $('#current_train .consist-gap').remove();
    placeMainTrainCars();
    resizeBuilderScroll();
}

async function transitionToTrainConfiguration(configIds) {
    if (isTrainTransitioning) return;
    const gen = ++transitionGeneration;
    isTrainTransitioning = true;
    setTransitionSpinner(true);

    const targetIds = configIds.filter((id) => isCatalogLogicalId(id));
    const steps = Math.max(train.length, targetIds.length);

    try {
        for (let i = 0; i < steps; i++) {
            if (gen !== transitionGeneration) break;

            const inTarget = i < targetIds.length;
            const inCurrent = i < train.length;

            if (inTarget && inCurrent) {
                const cur = train[i];
                if (cur.isGapPlaceholder || cur.logicalId !== targetIds[i]) {
                    await swapConsistAt(i, targetIds[i], gen);
                }
            } else if (inTarget && !inCurrent) {
                await insertConsistAt(i, targetIds[i], gen);
            } else if (!inTarget && inCurrent) {
                deleteConsistAtWithGap(i);
            }

            if (gen !== transitionGeneration) break;
            if (i < steps - 1) await delay(TRAIN_TRANSITION_STEP_MS);
        }

        if (gen === transitionGeneration) {
            collapseConsistAfterTransition();
            restoreConsistRemoveButtons();
            updateBuilderReadLink();
        }
    } finally {
        if (gen === transitionGeneration) {
            isTrainTransitioning = false;
            setTransitionSpinner(false);
        }
    }
}

function restoreConsistRemoveButtons() {
    $('#current_train .consist-car').each(function () {
        if (!this.querySelector('.consist-remove')) {
            $(this).append(
                '<button type="button" class="consist-remove" data-i18n-aria-en="Remove car" data-i18n-aria-sk="Odstrániť vagón" data-tip-en="Remove this car" data-tip-sk="Odstrániť vozidlo">&times;</button>',
            );
        }
    });
    applySiteI18n();
}

function removeConsistCarAtCarIndex(carIndex) {
    const trainIndex = consistCarIndexToTrainIndex(carIndex);
    const unitToRemove = train[trainIndex];
    if (!unitToRemove || unitToRemove.isGapPlaceholder) return;
    removeUnitFromScene(unitToRemove);
    train.splice(trainIndex, 1);
    placeMainTrainCars();
    $('#current_train .consist-car').eq(carIndex).remove();
    resizeBuilderScroll();
    updateBuilderReadLink();
}

function removeConsistCarAt(index) {
    removeConsistCarAtCarIndex(index);
}

function removeLastConsistCar() {
    const carCount = document.querySelectorAll('#current_train .consist-car').length;
    if (carCount === 0) return;
    removeConsistCarAtCarIndex(carCount - 1);
}

const CONSIST_KEYBOARD_SCROLL_STEP = 140;

function scrollConsistBy(delta) {
    if (!lenisConsist) return;
    lenisConsist.scrollTo(lenisConsist.scroll + delta, { programmatic: true });
}

function isBuilderKeyboardTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function initBuilderKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (!document.body.classList.contains('hero-dismissed')) return;
        if (isBuilderLocked()) return;
        if (document.body.classList.contains('video-modal-open')) return;
        if (isBuilderKeyboardTarget(e.target)) return;

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            scrollConsistBy(-CONSIST_KEYBOARD_SCROLL_STEP);
            return;
        }
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            scrollConsistBy(CONSIST_KEYBOARD_SCROLL_STEP);
            return;
        }
        if (e.key === 'Delete') {
            e.preventDefault();
            removeLastConsistCar();
        }
    });
}

function reorderConsist(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= train.length || toIndex >= train.length) {
        return;
    }
    if (train[fromIndex]?.isGapPlaceholder || train[toIndex]?.isGapPlaceholder) {
        return;
    }

    const [unit] = train.splice(fromIndex, 1);
    train.splice(toIndex, 0, unit);
    placeMainTrainCars();

    const container = document.getElementById('current_train');
    const items = [...container.querySelectorAll('.consist-car')];
    const [el] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, el);
    items.forEach((item) => container.appendChild(item));
    resizeBuilderScroll();
    updateBuilderReadLink();
}

function getConsistDropIndex(container, fromIndex, clientX) {
    const cars = [...container.querySelectorAll('.consist-car')];
    if (cars.length <= 1) return 0;

    for (let i = 0; i < cars.length; i++) {
        const rect = cars[i].getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        if (clientX < mid) return i;
    }
    return cars.length - 1;
}

/** Like getConsistDropIndex but returns 0..N (N = append at end) for catalog inserts. */
function getConsistInsertIndex(container, clientX) {
    const cars = [...container.querySelectorAll('.consist-car')];
    if (cars.length === 0) return 0;
    for (let i = 0; i < cars.length; i++) {
        const rect = cars[i].getBoundingClientRect();
        if (clientX < rect.left + rect.width / 2) return i;
    }
    return cars.length;
}

function updateCatalogDropMarker(container, clientX) {
    const index = getConsistInsertIndex(container, clientX);
    const cars = [...container.querySelectorAll('.consist-car')];
    cars.forEach((el, i) => {
        el.classList.toggle('consist-drop-before', i === index);
    });
    container.classList.toggle('catalog-drop-after-last', index === cars.length && cars.length > 0);
    return index;
}

function clearCatalogDropMarkers(container) {
    container.querySelectorAll('.consist-car').forEach((el) => {
        el.classList.remove('consist-drop-before');
    });
    container.classList.remove('catalog-drop-after-last');
}

function insertConsistCarUIAt(id, index) {
    const car = buildConsistCarElement(id);
    if (!car) return;
    const $container = $('#current_train');
    const $cars = $container.find('.consist-car');
    if (index >= $cars.length) {
        car.appendTo($container);
    } else {
        car.insertBefore($cars.eq(index));
    }
    applySiteI18n();
    resizeBuilderScroll();
    updateBuilderReadLink();
}

async function addTrainModelAt(id, generation, index) {
    try {
        const unit = await createTrainUnit(id);
        if (generation !== trainGeneration) {
            removeUnitFromScene(unit);
            return;
        }
        addUnitToScene(unit);
        train.splice(index, 0, unit);
        stationWaitingForTrain = false;
        placeMainTrainCars();
    } catch (error) {
        console.error('Error loading model for insert:', error);
    }
}

function loadAndInsertModel(id, index) {
    const generation = trainGeneration;
    trainLoadQueue = trainLoadQueue.then(async () => {
        if (generation !== trainGeneration) return;
        await addTrainModelAt(id, generation, index);
    }).catch((error) => {
        console.error('Error inserting model:', error);
    });
    return trainLoadQueue;
}

function clearConsistDragMarkers(container) {
    container.querySelectorAll('.consist-car').forEach((el) => {
        el.classList.remove('consist-dragging', 'consist-drop-before');
    });
}

function updateConsistDropMarker(container, fromIndex, clientX) {
    const targetIndex = getConsistDropIndex(container, fromIndex, clientX);
    container.querySelectorAll('.consist-car').forEach((el, i) => {
        el.classList.toggle('consist-drop-before', i === targetIndex && i !== fromIndex);
    });
    return targetIndex;
}

function initConsistDragReorder() {
    const container = document.getElementById('current_train');
    if (!container) return;

    let dragIndex = null;
    let ghost = null;

    function createConsistGhost(sourceEl) {
        const srcRect = sourceEl.getBoundingClientRect();
        const el = document.createElement('div');
        el.className = 'catalog-drag-ghost';
        el.style.width = `${srcRect.width}px`;
        el.style.height = `${srcRect.height}px`;
        const img = sourceEl.querySelector('img');
        if (img) {
            const clone = img.cloneNode(true);
            clone.style.cssText = 'width:auto;height:100%;display:block;pointer-events:none';
            el.appendChild(clone);
        }
        document.body.appendChild(el);
        return el;
    }

    function moveGhost(el, x, y) {
        el.style.left = `${x - el.offsetWidth / 2}px`;
        el.style.top = `${y - el.offsetHeight / 2}px`;
    }

    function removeConsistGhost() {
        ghost?.remove();
        ghost = null;
    }

    container.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || isBuilderLocked()) return;
        const car = e.target.closest('.consist-car');
        if (!car || e.target.closest('.consist-remove')) return;

        dragIndex = [...container.querySelectorAll('.consist-car')].indexOf(car);
        car.setPointerCapture(e.pointerId);
        car.classList.add('consist-dragging');
        ghost = createConsistGhost(car);
        moveGhost(ghost, e.clientX, e.clientY);
        lenisConsist?.stop();
    });

    container.addEventListener('pointermove', (e) => {
        if (dragIndex === null) return;
        if (ghost) moveGhost(ghost, e.clientX, e.clientY);
        updateConsistDropMarker(container, dragIndex, e.clientX);
    });

    function finishDrag(e) {
        if (dragIndex === null) return;

        const car = container.querySelector('.consist-car.consist-dragging');
        const from = dragIndex;
        const to = getConsistDropIndex(container, from, e.clientX);

        if (car?.hasPointerCapture(e.pointerId)) {
            car.releasePointerCapture(e.pointerId);
        }

        removeConsistGhost();
        clearConsistDragMarkers(container);
        dragIndex = null;
        lenisConsist?.start();

        reorderConsist(from, to);
    }

    container.addEventListener('pointerup', finishDrag);
    container.addEventListener('pointercancel', (e) => {
        if (dragIndex === null) return;
        const car = container.querySelector('.consist-car.consist-dragging');
        if (car?.hasPointerCapture(e.pointerId)) {
            car.releasePointerCapture(e.pointerId);
        }
        removeConsistGhost();
        clearConsistDragMarkers(container);
        dragIndex = null;
        lenisConsist?.start();
    });
}

function initCatalogDrag() {
    const catalog = document.getElementById('train_menu');
    const consistContainer = document.getElementById('current_train');
    if (!catalog || !consistContainer) return;

    const DRAG_THRESHOLD = 8;
    let dragId = null;
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let ghost = null;

    function createGhost(sourceEl) {
        const srcRect = sourceEl.getBoundingClientRect();
        const el = document.createElement('div');
        el.className = 'catalog-drag-ghost';
        el.style.width = `${srcRect.width}px`;
        el.style.height = `${srcRect.height}px`;
        const img = sourceEl.querySelector('img');
        if (img) {
            const clone = img.cloneNode(true);
            clone.style.cssText = 'width:auto;height:100%;display:block;pointer-events:none';
            el.appendChild(clone);
        }
        document.body.appendChild(el);
        return el;
    }

    function moveGhost(el, x, y) {
        el.style.left = `${x - el.offsetWidth / 2}px`;
        el.style.top = `${y - el.offsetHeight / 2}px`;
    }

    function removeGhost() {
        ghost?.remove();
        ghost = null;
    }

    function isOverConsist(clientX, clientY) {
        const scrollEl = consistContainer.closest('#consist_scroll') || consistContainer;
        const rect = scrollEl.getBoundingClientRect();
        return (
            clientX >= rect.left - 24 && clientX <= rect.right + 24 &&
            clientY >= rect.top - 52 && clientY <= rect.bottom + 52
        );
    }

    catalog.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || isBuilderLocked()) return;
        const car = e.target.closest('.catalog-car:not(.hidden)');
        if (!car) return;
        const id = car.id;
        if (!isCatalogLogicalId(id)) return;

        dragId = id;
        startX = e.clientX;
        startY = e.clientY;
        isDragging = false;
        car.setPointerCapture(e.pointerId);
    });

    catalog.addEventListener('pointermove', (e) => {
        if (!dragId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging) {
            if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
            isDragging = true;
            const sourceEl = catalog.querySelector(`.catalog-car#${CSS.escape(dragId)}`);
            if (sourceEl) {
                ghost = createGhost(sourceEl);
                moveGhost(ghost, e.clientX, e.clientY);
            }
            lenisCatalog?.stop();
        }

        if (ghost) moveGhost(ghost, e.clientX, e.clientY);

        if (isOverConsist(e.clientX, e.clientY)) {
            updateCatalogDropMarker(consistContainer, e.clientX);
        } else {
            clearCatalogDropMarkers(consistContainer);
        }
    });

    function finishCatalogDrag(e) {
        if (!dragId) return;
        const id = dragId;
        const wasDragging = isDragging;
        const clientX = e.clientX;
        const clientY = e.clientY;

        const sourceEl = catalog.querySelector(`.catalog-car#${CSS.escape(id)}`);
        if (sourceEl?.hasPointerCapture(e.pointerId)) {
            sourceEl.releasePointerCapture(e.pointerId);
        }

        removeGhost();
        clearCatalogDropMarkers(consistContainer);
        dragId = null;
        isDragging = false;
        lenisCatalog?.start();

        if (isBuilderLocked() || !isCatalogLogicalId(id)) return;

        if (wasDragging && isOverConsist(clientX, clientY)) {
            const dropIndex = getConsistInsertIndex(consistContainer, clientX);
            addCatalogCarToConsist(id, dropIndex);
        } else if (!wasDragging) {
            addCatalogCarToConsist(id, null, true);
        }
    }

    catalog.addEventListener('pointerup', finishCatalogDrag);
    catalog.addEventListener('pointercancel', (e) => {
        if (!dragId) return;
        const sourceEl = catalog.querySelector(`.catalog-car#${CSS.escape(dragId)}`);
        if (sourceEl?.hasPointerCapture(e.pointerId)) sourceEl.releasePointerCapture(e.pointerId);
        removeGhost();
        clearCatalogDropMarkers(consistContainer);
        dragId = null;
        isDragging = false;
        lenisCatalog?.start();
    });
}

function clearCurrentTrains(callback) {
    if (isClearingTrains) return;
    isClearingTrains = true;
    trainGeneration++;

    train.forEach((unit) => {
        removeUnitFromScene(unit);
    });
    train.length = 0;
    resetCameraOriginTracking();
    $('#current_train').empty();
    isClearingTrains = false;
    resizeBuilderScroll();
    updateBuilderReadLink();
    callback?.();
}

function clearCurrentTrainsAsync() {
    return new Promise((resolve) => {
        clearCurrentTrains(resolve);
    });
}

async function loadTrainConfiguration(configIds) {
    await transitionToTrainConfiguration(configIds);
}

function loadRandomTrainConfiguration() {
    const config = RANDOM_TRAIN_CONFIGS[
        Math.floor(Math.random() * RANDOM_TRAIN_CONFIGS.length)
    ];
    return transitionToTrainConfiguration(config);
}

function initBuilderLenisScroll() {
    const consistWrapper = document.getElementById('consist_scroll');
    const consistContent = document.getElementById('consist_scroll_content');
    const catalogWrapper = document.getElementById('catalog_scroll');
    const catalogContent = document.getElementById('catalog_scroll_content');

    if (consistWrapper && consistContent) {
        lenisConsist = new Lenis({
            wrapper: consistWrapper,
            content: consistContent,
            orientation: 'horizontal',
            gestureOrientation: 'both',
            smoothWheel: true,
            lerp: 0.16,
            wheelMultiplier: 1,
        });
    }

    if (catalogWrapper && catalogContent) {
        lenisCatalog = new Lenis({
            wrapper: catalogWrapper,
            content: catalogContent,
            orientation: 'horizontal',
            gestureOrientation: 'both',
            smoothWheel: true,
            lerp: 0.16,
            wheelMultiplier: 1,
        });
    }

    function lenisRaf(time) {
        lenisConsist?.raf(time);
        lenisCatalog?.raf(time);
        requestAnimationFrame(lenisRaf);
    }
    requestAnimationFrame(lenisRaf);
}

const CATALOG_CAR_NAMES = {
    lok383: { en: 'Class 383 Vectron', sk: 'Rad 383 Vectron' },
    lok380: { en: 'Class 380 Škoda Emil Zátopek', sk: 'Rad 380 Škoda Emil Zátopek' },
    lok350: { en: 'Class 350 Gorila', sk: 'Rad 350 Gorila' },
    lok363: { en: 'Class 363', sk: 'Rad 363' },
    lok240: { en: 'Class 240 Laminátka', sk: 'Rad 240 Laminátka' },
    lok754: { en: 'Class 754 Bardotka', sk: 'Rad 754 Bardotka' },
    lok210: { en: 'Class 210 – the Iron', sk: 'Rad 210 Žehlička' },
    KissPredok: { en: 'Stadler KISS — front car', sk: 'Stadler KISS — čelný vozeň' },
    KissStred: { en: 'Stadler KISS — middle car', sk: 'Stadler KISS — stredný vozeň' },
    KissCumakKoniec: { en: 'Stadler KISS — rear car', sk: 'Stadler KISS — zadný vozeň' },
    panterPredok: { en: 'Škoda RegioPanter — front car', sk: 'Škoda RegioPanter — čelný vozeň' },
    panterStred: { en: 'Škoda RegioPanter — middle car', sk: 'Škoda RegioPanter — stredný vozeň' },
    panterZadok: { en: 'Škoda RegioPanter — rear car', sk: 'Škoda RegioPanter — zadný vozeň' },
    janosikpredok: { en: 'ČKD Jánošík — front car', sk: 'ČKD Jánošík — predný vozeň' },
    janosikstred: { en: 'ČKD Jánošík — middle car', sk: 'ČKD Jánošík — stredný vozeň' },
    janosikriadiaci: { en: 'ČKD Jánošík — driving trailer', sk: 'ČKD Jánošík — riadiaci vozeň' },
    dmu861zaciatok: { en: 'Class 861 DMU — front', sk: 'Rad 861 — predok' },
    dmu861stred: { en: 'Class 861 DMU — middle', sk: 'Rad 861 — stred' },
    dmu861koniec: { en: 'Class 861 DMU — rear', sk: 'Rad 861 — zadok' },
    delfin: { en: 'Class 840 Delfín', sk: 'Rad 840 Delfín' },
    tatra: { en: 'Tatra tram', sk: 'Tatranská električka' },
    dmu810: { en: 'Class 810 railbus', sk: 'Motorový vozeň rad 810' },
    ampeer: { en: 'Ampeer — 1st/2nd class coach', sk: 'Ampeer — vozeň 1./2. triedy' },
    bmpeer: { en: 'Bmpeer — 2nd class coach', sk: 'Bmpeer — vozeň 2. triedy' },
    bmz: { en: 'Bmz — 2nd class coach', sk: 'Bmz — vozeň 2. triedy' },
    bds: { en: 'Bds — baggage car', sk: 'Bds — batožinový vozeň' },
    wrrm: { en: 'WRRm — restaurant car', sk: 'WRRm — reštauračný vozeň' },
    wlab: { en: 'WLAb — sleeper car', sk: 'WLAb — lôžkový vozeň' },
};

function initBuilderTooltips() {
    const tip = document.createElement('div');
    tip.id = 'builder-tooltip';
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);

    let showTimer = null;
    let activeTarget = null;

    function positionAndShow(el) {
        tip.classList.remove('visible');
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const topEdge = rect.top;

        // Temporarily show off-screen to measure
        tip.style.left = '-999px';
        tip.style.top = '-999px';
        tip.classList.add('visible');

        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        const gap = 8;

        let left = Math.max(gap, Math.min(cx - tw / 2, window.innerWidth - tw - gap));
        let top = topEdge - th - gap;
        if (top < gap) top = rect.bottom + gap; // flip below if off-screen

        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    }

    function showTip(el) {
        const en = isLangEn();
        const main = el.dataset[en ? 'tipEn' : 'tipSk'];
        if (!main) return;
        const sub = el.dataset[en ? 'tipSubEn' : 'tipSubSk'];
        tip.innerHTML = main + (sub ? `<span class="tip-sub">${sub}</span>` : '');
        positionAndShow(el);
    }

    function hideTip() {
        clearTimeout(showTimer);
        showTimer = null;
        activeTarget = null;
        tip.classList.remove('visible');
    }

    const container = document.getElementById('controlcontainer');
    if (!container) return;

    container.addEventListener('pointerenter', (e) => {
        const el = e.target.closest('[data-tip-en]');
        if (!el || el === activeTarget) return;
        clearTimeout(showTimer);
        activeTarget = el;
        showTimer = setTimeout(() => {
            if (activeTarget === el) showTip(el);
        }, 480);
    }, true);

    container.addEventListener('pointerleave', (e) => {
        if (!e.target.closest || !e.target.closest('[data-tip-en]')) return;
        const leaving = e.target.closest('[data-tip-en]');
        if (leaving && (e.relatedTarget === null || !leaving.contains(e.relatedTarget))) {
            hideTip();
        }
    }, true);

    container.addEventListener('pointerdown', hideTip, true);
    container.addEventListener('scroll', hideTip, true);
}

function initTrainBuilderUI() {
    $('#train_menu .train_selection').each(function () {
        const id = this.id;
        const name = CATALOG_CAR_NAMES[id];
        $(this)
            .addClass('catalog-car')
            .attr('data-category', TRAIN_CATEGORY[id] || 'special')
            .attr('data-tip-en', name?.en || id)
            .attr('data-tip-sk', name?.sk || id)
            .attr('data-tip-sub-en', 'Click to add · Drag to position')
            .attr('data-tip-sub-sk', 'Kliknúť pridá · Pretiahnuť na miesto');
    });

    initBuilderLenisScroll();
    initConsistDragReorder();
    initCatalogDrag();
    initBuilderKeyboardShortcuts();
    initBuilderTooltips();

    // Catalog tab filter
    $('.builder-tab').on('click', function () {
        if (isBuilderLocked()) return;
        const tab = $(this).data('tab');
        $('.builder-tab').removeClass('active');
        $(this).addClass('active');
        $('#train_menu .catalog-car').each(function () {
            $(this).toggleClass('hidden', $(this).data('category') !== tab);
        });
        resizeBuilderScroll();
    });

    // Remove car from consist
    $('#current_train').on('click', '.consist-remove', function (e) {
        if (isBuilderLocked()) return;
        e.stopPropagation();
        const index = $('#current_train .consist-car').index($(this).closest('.consist-car'));
        removeConsistCarAtCarIndex(index);
    });

    // Presets
    $('.builder-preset[data-preset]').on('click', function () {
        if (isBuilderLocked()) return;
        const preset = BUILDER_PRESETS[Number($(this).data('preset'))];
        if (preset) transitionToTrainConfiguration(preset.config);
    });

    $('#surprise_train').on('click', () => {
        if (isBuilderLocked()) return;
        loadRandomTrainConfiguration();
    });

    $('#builder_cam_follow').on('click', function () {
        const active = !$(this).hasClass('active');
        $(this).toggleClass('active', active).attr('aria-pressed', active);
        setCameraRotationEnabled(active);
    });

    $('#builder_showcase').on('click', function () {
        if (isBuilderLocked() && !presentationLoopActive) return;
        const active = !$(this).hasClass('active');
        $(this).toggleClass('active', active).attr('aria-pressed', active);
        if (active) {
            startBuilderPresentationMode();
        } else {
            stopBuilderPresentationMode();
        }
    });

    $('#builder-back').on('click', () => {
        exitTrainBuilder();
        scrollToElement(document.getElementById('hero-overlay'), { offset: 0 });
    });

    document.getElementById('trainspot-random')?.addEventListener('click', () => {
        if (isBuilderLocked()) return;
        loadRandomTrainConfiguration();
    });

    // Show locomotives tab by default
    $('#train_menu .catalog-car').each(function () {
        $(this).toggleClass('hidden', $(this).data('category') !== 'locos');
    });
    updateBuilderReadLink();
}

function startBuilderPresentationMode() {
    $('#control').addClass('disabled');
    $('#builder_showcase').addClass('active').attr('aria-pressed', 'true');
    presentationLoopActive = true;
    if (!isHeroAutoRotateEnabled()) {
        stopAutoRotate();
        clearTimeout(interactionTimeout);
    }
    runBuilderPresentationLoop();
}

function stopBuilderPresentationMode() {
    presentationLoopActive = false;
    transitionGeneration++;
    collapseConsistAfterTransition();
    restoreConsistRemoveButtons();
    $('#control').removeClass('disabled');
    $('#builder_showcase').removeClass('active').attr('aria-pressed', 'false');
    setTransitionSpinner(false);
    isTrainTransitioning = false;
}

async function runBuilderPresentationLoop() {
    while (presentationLoopActive && $('#builder_showcase').hasClass('active')) {
        const config = RANDOM_TRAIN_CONFIGS[
            Math.floor(Math.random() * RANDOM_TRAIN_CONFIGS.length)
        ];
        await transitionToTrainConfiguration(config);
        if (!presentationLoopActive || !$('#builder_showcase').hasClass('active')) break;
        await delay(10000);
    }
}


// ---------------------------------------------------------------------------
// Hero / loading-screen progress helpers
// These drive the progress bar and status line while the default train loads.
// ---------------------------------------------------------------------------
const _HERO_MODEL_LABELS = {
    lok380: { en: 'Locomotive 380', sk: 'Lokomotíva 380' },
    lok383: { en: 'Locomotive 383', sk: 'Lokomotíva 383' },
    lok350: { en: 'Locomotive 350', sk: 'Lokomotíva 350' },
    lok363: { en: 'Locomotive 363', sk: 'Lokomotíva 363' },
    lok240: { en: 'Locomotive 240', sk: 'Lokomotíva 240' },
    lok754: { en: 'Locomotive 754', sk: 'Lokomotíva 754' },
    lok210: { en: 'Locomotive 210', sk: 'Lokomotíva 210' },
    lokofix: { en: 'Locomotive frame', sk: 'Rám lokomotívy' },
    KissPredok: { en: 'Kiss — cab car', sk: 'Kiss — čelný vozň' },
    KissStred: { en: 'Kiss — middle car', sk: 'Kiss — stredný vozň' },
    KissCumakKoniec: { en: 'Kiss — end car', sk: 'Kiss — koncový vozň' },
    panterPredok: { en: 'Panter — front', sk: 'Panter — čelo' },
    panterStred: { en: 'Panter — middle', sk: 'Panter — stred' },
    panterZadok: { en: 'Panter — rear', sk: 'Panter — zadok' },
    janosikriadiaci: { en: 'Jánošík — cab', sk: 'Jánošík — riadiaci' },
    janosikstred: { en: 'Jánošík — coach', sk: 'Jánošík — stredný vozň' },
    janosikpredok: { en: 'Jánošík — front', sk: 'Jánošík — čelo' },
    dmu861zaciatok: { en: 'DMU 861 — front', sk: 'Motorová jednotka 861 — čelo' },
    dmu861stred: { en: 'DMU 861 — middle', sk: 'Motorová jednotka 861 — stred' },
    dmu861koniec: { en: 'DMU 861 — rear', sk: 'Motorová jednotka 861 — zadok' },
    ampeer: { en: 'Ampeer coach', sk: 'Vozň Ampeer' },
    bmpeer: { en: 'Bmpeer coach', sk: 'Vozň Bmpeer' },
    bmz: { en: 'BMZ coach', sk: 'Vozň BMZ' },
    bds: { en: 'BDs coach', sk: 'Vozň BDs' },
    wrrm: { en: 'WRRm dining car', sk: 'Jedáleň WRRm' },
    wlab: { en: 'WLab sleeping car', sk: 'Lôžkový vozň WLab' },
    delfin: { en: 'Delfín EMU', sk: 'Motorová jednotka Delfín' },
    tatra: { en: 'Tatra electric tram', sk: 'Tatranská električka' },
    dmu810: { en: 'DMU 810', sk: 'Motorová jednotka 810' },
};

function _heroLabelPair(id) {
    return _HERO_MODEL_LABELS[id] || { en: id, sk: id };
}

function _heroSetStatus(msg) {
    const el = document.getElementById('hero-status');
    if (!el) return;
    if (msg && typeof msg === 'object' && 'en' in msg && 'sk' in msg) {
        el.innerHTML = `<span class="en">${msg.en}</span><span class="sk">${msg.sk}</span>`;
        return;
    }
    const text = String(msg);
    el.innerHTML = `<span class="en">${text}</span><span class="sk">${text}</span>`;
}

function _heroSetProgress(loaded, total) {
    const pct = total > 0 ? Math.min(94, Math.round((loaded / total) * 94)) : 0;
    const fill = document.getElementById('hero-bar-fill');
    if (fill) fill.style.width = pct + '%';
}

function dismissHeroToBuilder() {
    if (isMobileTrainspottingViewport()) {
        dismissHeroToTrainspotting();
        return;
    }

    document.body.classList.add('hero-dismissed');
    document.getElementById('hero-overlay')?.classList.add('dismissed');
    stopGlobalLenis();
    enterTrainBuilder();
    updateBuilderReadLink();
    updateGlobalThesisNav();
}

function _heroReveal() {
    // Fill bar to 100% then trigger the expansion animation after a brief pause
    const fill = document.getElementById('hero-bar-fill');
    if (fill) fill.style.width = '100%';
    _heroSetStatus({ en: 'Ready', sk: 'Pripravené' });

    setTimeout(() => {
        document.body.classList.add('hero-loaded');
        const overlay = document.getElementById('hero-overlay');
        if (!overlay) return;
        overlay.classList.add('loaded');

        document.getElementById('hero-cta')?.addEventListener('click', dismissHeroToBuilder);

        document.getElementById('hero-random')?.addEventListener('click', () => {
            loadRandomTrainConfiguration();
        });

        unlockSiteScrollAfterLoading();
        enableSmoothSiteScroll();
    }, 350);
}

function loadDefaultTrain() {
    const config = DEFAULT_TRAIN_CONFIGS[Math.floor(Math.random() * DEFAULT_TRAIN_CONFIGS.length)];
    const validIds = config.filter(id => isCatalogLogicalId(id));
    const totalCount = validIds.length;

    if (totalCount === 0) {
        // Nothing to load — reveal immediately
        requestAnimationFrame(_heroReveal);
        return;
    }

    _heroSetStatus({ en: 'Preparing 3D scene…', sk: 'Príprava 3D scény…' });
    _heroSetProgress(0, totalCount);

    let loadedCount = 0;

    validIds.forEach((id) => {
        const gen = trainGeneration;
        trainLoadQueue = trainLoadQueue.then(async () => {
            if (gen !== trainGeneration) return;
            const label = _heroLabelPair(id);
            _heroSetStatus({
                en: 'Downloading ' + label.en + '…',
                sk: 'Sťahovanie – ' + label.sk + '…',
            });
            await addTrainModel(id, gen);
            loadedCount++;
            _heroSetProgress(loadedCount, totalCount);
            copyTrainSelectionToCurrentTrain(id);
            if (loadedCount >= totalCount) {
                _heroSetStatus({ en: 'Rendering scene…', sk: 'Vykresľovanie scény…' });
                // Wait 3 frames so at least one complete render has occurred
                requestAnimationFrame(() =>
                    requestAnimationFrame(() =>
                        requestAnimationFrame(_heroReveal)));
            }
        }).catch(e => console.error('[hero] model load error:', e));
    });
}

// ---------------------------------------------------------------------------
// No-train placeholder
// When no car has been added an outlined bounding box rides the route like a
// real car so the camera always has something to follow and orbit around.
// ---------------------------------------------------------------------------
let noTrainPlaceholder = null;

function ensureNoTrainPlaceholder() {
    if (train.length > 0) {
        // Cars present — remove placeholder if it exists.
        if (noTrainPlaceholder) {
            scene.remove(noTrainPlaceholder);
            noTrainPlaceholder.traverse((node) => {
                if (node.geometry) node.geometry.dispose();
                if (node.material) node.material.dispose();
            });
            noTrainPlaceholder = null;
            heroDebugLog('main.js:ensureNoTrainPlaceholder', 'placeholder removed — real train present', getHeroTrainDisplayState(), 'A');
        }
        return;
    }

    if (noTrainPlaceholder) return; // already in scene

    heroDebugLog('main.js:ensureNoTrainPlaceholder', 'placeholder created — outline bbox', getHeroTrainDisplayState(), 'A');

    // Approximate locomotive dimensions (width × height × length in world units)
    const W = 1.5;
    const H = 2.2;
    const L = 14;

    const group = new THREE.Group();

    const boxGeo = new THREE.BoxGeometry(W, H, L);
    const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeo),
        new THREE.LineBasicMaterial({
            color: 0xb8c4d4,
            transparent: true,
            opacity: 0.75,
        }),
    );
    boxGeo.dispose();
    outline.position.y = H / 2; // sit on ground when group root is at y = 0
    group.add(outline);

    const fakeBox = new THREE.Box3(
        new THREE.Vector3(-W / 2, 0, -L / 2),
        new THREE.Vector3(W / 2, H, L / 2),
    );
    const fakeCenterLocal = new THREE.Vector3(0, H / 2, 0);
    group.userData.geometryMetrics = { length: L, centerLocal: fakeCenterLocal, localBox: fakeBox };
    group.userData.length = L;

    scene.add(group);
    noTrainPlaceholder = group;
}


// passing trains

const trainConfigurations = [
    ['lokofix','bmz', 'bmz', 'bmz', 'bmpeer', 'bmpeer', 'bmz', 'bds', 'wrrm', 'ampeer','lok380','lokofix'],//metropolitan
    ['lokofix', 'bmz', 'bmz', 'aeer','lok363','lokofix'],//hornad
    ['lokofix','ampeer', 'bmpeer', 'bmpeer', 'bmpeer','lok363','lokofix'],//urpin
    ['lokofix','bmz','bmz','bmpeer','bmpeer','bmpeer','bmpeer','bds', 'wrrm', 'aeer', 'ampeer','lok350','lokofix'],//tatran
    ['lokofix','bmz','bmz','bmz','bmz','bmpeer','bmpeer','bmz', 'bmz', 'bds', 'aeer','lok350','lokofix'],//sarisan
    ['lokofix','dmu861koniec','dmu861stred', 'dmu861zaciatok','lokofix'], //dunihlav dlhy
    ['lokofix','dmu861koniec','dmu861zaciatok','lokofix'], //dunihlav kratky
    ['lokofix','KissCumakKoniec','KissStred','KissStred','KissStred','KissStred', 'KissPredok','lokofix'], //Stadler KISS
    ['lokofix','panterZadok','panterStred','panterStred','panterStred','panterPredok','lokofix'], //panter dlhy (fictional)
    ['lokofix','panterZadok','panterStred','panterStred','panterPredok','lokofix'], //panter kratky
    ['lokofix','panterZadok','panterStred','panterStred','panterPredok','panterZadok','panterStred','panterStred','panterPredok','lokofix'], //panter kratky
    ['lokofix','bmz','bmz','bmz', 'wlab', 'wlab', 'wlab','lok754','lokofix'],//polana
    ['lokofix','bmz','bmz','bmz','bmz','bmpeer','bmpeer','wlab','wlab', 'wlab', 'wlab', 'wlab','lok754','lokofix'],//zemplin
    ['lokofix','bmz', 'bmz', 'bmz', 'bmz','lok754','lokofix'],//bojnice
    ['lokofix','bmz', 'bmz', 'bmz','lok754','lokofix'],//gemeran
    ['lokofix','dmu810', 'dmu810','lokofix'],
    ['lokofix','dmu810','lokofix'],
    ['lokofix','tatra', 'tatra','lokofix'],
    ['lokofix','janosikriadiaci', 'janosikstred', 'janosikpredok','lokofix'],
    ['lokofix','janosikriadiaci', 'janosikstred', 'janosikpredok', 'janosikriadiaci', 'janosikstred', 'janosikpredok','lokofix'],
    ['lokofix','janosikriadiaci', 'janosikstred', 'janosikpredok','lokofix'],
    ['lokofix','janosikriadiaci', 'janosikstred', 'janosikpredok', 'janosikriadiaci', 'janosikstred', 'janosikpredok','lokofix'],
    ['lokofix','lok240', 'janosikstred', 'janosikstred', 'janosikpredok','lokofix'],
    ['lokofix','lok363', 'janosikstred', 'janosikstred', 'janosikpredok','lokofix'],
    ['lokofix','wlab', 'wlab', 'wlab', 'bmz', 'bmz', 'bmz','lok240','lokofix'],
    ['lokofix','wlab', 'wlab', 'wlab', 'bmz', 'bmz', 'bmz','lok210','lokofix'],
    ['lokofix','wlab','lok210','lokofix'],
    ['lokofix','lok210','lokofix'],
];

async function loadFullTrain(configIndex, trainInstance, spawnAhead = PASSING_TRAIN_SPAWN_AHEAD) {
    const config = trainConfigurations[configIndex];
    console.log("Loading configuration:", config);

    // Passing trains spawn behind the main train on the route and travel
    // toward higher route distance on the opposite track.
    const headDistance = clampRouteDistance(
        mainHeadDistance - spawnAhead,
    );

    for (const modelKey of config) {
        const segmentIds = getSegmentIdsForLogicalId(modelKey, true);
        for (const segId of segmentIds) {
            try {
                const model = await createTrainModel(segId);
                configureTrainModel(model, { castShadow: true, receiveShadow: true });
                model.userData.logicalId = modelKey;
                scene.add(model);
                trainInstance.push(model);
            } catch (error) {
                console.error("Model URL not found for key:", segId, error);
            }
        }
    }

    animateTrainMovement(trainInstance, headDistance);
}

function animateTrainMovement(trainInstance, headDistance) {
    const halfLength = trainInstance.reduce(
        (s, m) => s + (m.userData.length || 0) * m.scale.x, 0
    ) / 2;
    passingTrains.push({
        models: trainInstance,
        headDistance,
        speed: TRAIN_SPEED,
        halfLength,
        // Station stopping state for this passing train.
        stState:     'cruise',   // 'cruise' | 'braking' | 'stopped' | 'departing'
        stDwell:     0,
        stTargetD:   null,
        stStopD:     null,       // head stop point = stTargetD - halfLength
    });
    placeTrainCarsOnRoute(headDistance, trainInstance, PASSING_TRACK_OFFSET, +1);
}

function getTrainTotalLength(cars) {
    return cars.reduce((total, car) => total + (car.userData.length || 0), 0);
}

// Passing trains run in the +headDistance direction so "ahead" for them means
// the next station with a HIGHER route distance value.
function findNextPassingStationAhead(pt) {
    let best = null, bestDelta = Infinity;
    for (const sd of stationDistances) {
        let delta = sd - pt.headDistance;
        if (delta < 0) delta += routeTotalLength;
        if (delta > 0 && delta < bestDelta) { bestDelta = delta; best = sd; }
    }
    return best;
}

function passingStationDistanceAhead(pt, stationD) {
    let d = stationD - pt.headDistance;
    if (d < 0) d += routeTotalLength;
    return d;
}

function updatePassingTrainStation(pt, delta) {
    if (stationDistances.length === 0) { pt.speed = TRAIN_SPEED; return; }

    switch (pt.stState) {
        case 'cruise': {
            pt.speed = TRAIN_SPEED;
            const next = findNextPassingStationAhead(pt);
            if (next !== null) {
                // Stop with the train CENTRE at the station, not the head.
                const stopPt = clampRouteDistance(next - pt.halfLength);
                const dist = passingStationDistanceAhead(pt, stopPt);
                if (dist > 0 && dist <= STATION_BRAKE_DISTANCE) {
                    pt.stState   = 'braking';
                    pt.stTargetD = next;
                    pt.stStopD   = stopPt;
                }
            }
            break;
        }
        case 'braking': {
            const dist = passingStationDistanceAhead(pt, pt.stStopD);
            const overshot = dist > routeTotalLength / 2;
            if (dist <= 0.05 || overshot) {
                pt.headDistance = clampRouteDistance(pt.stStopD);
                pt.speed   = 0;
                pt.stState = 'stopped';
                pt.stDwell = 0;
            } else {
                pt.speed = Math.max(0, Math.min(pt.speed, Math.sqrt(2 * STATION_DECEL_RATE * dist)));
            }
            break;
        }
        case 'stopped': {
            pt.speed = 0;
            pt.stDwell += delta;
            if (pt.stDwell >= STATION_DWELL_TIME) pt.stState = 'departing';
            break;
        }
        case 'departing': {
            pt.speed = Math.min(TRAIN_SPEED, pt.speed + STATION_ACCEL_RATE * delta);
            if (pt.speed >= TRAIN_SPEED) {
                pt.speed     = TRAIN_SPEED;
                pt.stState   = 'cruise';
                pt.stTargetD = null;
                pt.stStopD   = null;
            }
            break;
        }
    }
}

function updatePassingTrains(delta) {
    for (let i = passingTrains.length - 1; i >= 0; i--) {
        const passingTrain = passingTrains[i];

        updatePassingTrainStation(passingTrain, delta);

        passingTrain.headDistance += passingTrain.speed * delta;
        placeTrainCarsOnRoute(
            passingTrain.headDistance,
            passingTrain.models,
            PASSING_TRACK_OFFSET,
            +1,
        );

        // Despawn once far enough ahead of the main train (not from spawn point —
        // spawn is SPAWN_AHEAD behind main, so a fixed travel cap removed trains
        // before they even reached the pass).
        const aheadOfMain = routeDistanceForward(mainHeadDistance, passingTrain.headDistance);
        if (aheadOfMain > PASSING_TRAIN_DESPAWN_AHEAD && aheadOfMain < routeTotalLength / 2) {
            passingTrain.models.forEach(removeTrainModel);
            passingTrain.models.length = 0;
            passingTrains.splice(i, 1);
            startPassingTrains();
        }
    }
}








// function startPassingTrains() {
//     const configIndex = Math.floor(Math.random() * trainConfigurations.length);
//     const trainInstance = [];

//     loadFullTrain(configIndex, trainInstance).then(() => {
//         animateTrainMovement(trainInstance);
//     });
// }


function startPassingTrains() {
    const configIndex = Math.floor(Math.random() * trainConfigurations.length);
    const trainInstance = [];

    const spawnAhead = hasSpawnedFirstPassingTrain
        ? PASSING_TRAIN_SPAWN_AHEAD
        : PASSING_TRAIN_FIRST_SPAWN_AHEAD;
    hasSpawnedFirstPassingTrain = true;

    loadFullTrain(configIndex, trainInstance, spawnAhead);
}

//prefetch htmls

let cachedHTML = {}; // To store the preloaded HTML content

// Preload multiple HTML files
function preloadHTML(urls) {
    urls.forEach(url => {
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to preload ${url}: ${response.statusText}`);
                }
                return response.text();
            })
            .then(html => {
                cachedHTML[url] = html; // Cache the HTML content
            })
            .catch(error => console.error('Error preloading HTML:', error));
    });
}

// Use the preloaded HTML when needed
function loadOverlay(url, targetElement) {
    if (cachedHTML[url]) {
        targetElement.innerHTML = cachedHTML[url]; // Use cached HTML content
    } else {
        // Fallback if not preloaded (shouldn't happen if preload succeeds)
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load ${url}: ${response.statusText}`);
                }
                return response.text();
            })
            .then(html => {
                targetElement.innerHTML = html;
            })
            .catch(error => console.error('Error loading overlay:', error));
    }
}

// Preload multiple files on page load
const overlayFiles = ['../content_abroad.html', '../content_history.html', '../content_navigation_design.html', '../content_new_visual.html',, '../content_sources.html']; // Add more files here
preloadHTML(overlayFiles);

$(document).ready(function () {
    initTrainBuilderUI();
});

initHeroLayoutProfile();
init();


