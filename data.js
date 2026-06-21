import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js';
import { REGIONS_METADATA, STORES_DATA } from './data.js';

// --- SYSTEM CONFIG & ARCHITECTURE STATE MATRIX ---
const APP_STATE = {
    currentLevel: 'global', // 'global' | 'group' | 'region' | 'store'
    selectedGroup: null,     // 'Luzon' | 'Visayas' | 'Mindanao'
    selectedRegionId: null,
    selectedStoreId: null,
    simulationMonth: 5,     // 0=Jan, 1=Feb, 2=Mar, 3=Apr, 4=May, 5=Jun
    geoBounds: { minLon: 116, maxLon: 127, minLat: 4, maxLat: 22, centerLon: 121.5, centerLat: 13, scaleX: 1, scaleZ: 1 },
    mapScaleFactor: 24,
    domElements: {}
};

// Custom Camera System Variables
const cameraControl = {
    target: new THREE.Vector3(0, 0, 0),
    radius: 19, theta: Math.PI / 2, phi: Math.PI / 3.4,
    minRadius: 3, maxRadius: 35, minPhi: 0.05, maxPhi: Math.PI / 2 - 0.02,
    isDragging: false, prevX: 0, prevY: 0, animation: null
};

// Global Pipeline Containers
let scene, camera, renderer, clock;
let terrainGroups = { "Luzon": new THREE.Group(), "Visayas": new THREE.Group(), "Mindanao": new THREE.Group() };
let hitMeshes = []; 
let pinInstances = [];
let sharedGlowTexture = null;
let oceanUniforms = { uTime: { value: 0 } };

// --- RUNTIME BOOT ENTRY INITIALIZATION PIPELINE ---
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    initClock();
    build3DContextEngine();
    executeAsyncDataFetch();
    bindUIEvents();
});

function cacheDOMElements() {
    const d = APP_STATE.domElements;
    d.bootOverlay = document.getElementById('boot-overlay');
    d.bootBar = document.getElementById('boot-loader-bar');
    d.bootText = document.getElementById('boot-status-text');
    d.bootPercent = document.getElementById('boot-status-percentage');
    d.uiLayer = document.getElementById('ui-layer');
    d.sysClock = document.getElementById('sys-clock');
    d.timeScrubber = document.getElementById('time-scrubber');
    d.drilldownList = document.getElementById('drilldown-list');
    d.drilldownTitle = document.getElementById('drilldown-title');
    d.hierarchyLabel = document.getElementById('hierarchy-label');
    d.btnBackGlobal = document.getElementById('btn-back-global');
    d.detailDrawer = document.getElementById('detail-drawer');
    d.drawerContent = document.getElementById('drawer-content-target');
    d.btnCloseDrawer = document.getElementById('btn-close-drawer');
    
    // Breadcrumbs
    d.bcRoot = document.getElementById('bc-root');
    d.bcGroup = document.getElementById('bc-group');
    d.bcRegion = document.getElementById('bc-region');
    d.bcStore = document.getElementById('bc-store');
    d.bcSep1 = document.getElementById('bc-sep1');
    d.bcSep2 = document.getElementById('bc-sep2');
    d.bcSep3 = document.getElementById('bc-sep3');
    
    // Lightbox
    d.lightbox = document.getElementById('lightbox-modal');
    d.lightboxClose = document.getElementById('btn-close-lightbox');
    d.lightboxTitle = document.getElementById('lightbox-store-title');
    d.lightboxTabLabel = document.getElementById('lightbox-tab-label');
    
    // Metric Numerical Readouts
    d.mTotal = document.getElementById('m-total');
    d.mApproved = document.getElementById('m-approved');
    d.mPending = document.getElementById('m-pending');
    d.mIssue = document.getElementById('m-issue');
}

function updateBootProgress(percentage, statusText) {
    const d = APP_STATE.domElements;
    if (!d.bootOverlay) return;
    d.bootBar.style.width = `${percentage}%`;
    d.bootText.innerText = statusText;
    d.bootPercent.innerText = `${Math.round(percentage)}%`;
    if (percentage >= 100) {
        setTimeout(() => {
            d.bootOverlay.style.transition = 'opacity 0.6s ease-in-out';
            d.bootOverlay.style.opacity = '0';
            d.uiLayer.style.display = 'grid';
            setTimeout(() => d.bootOverlay.remove(), 600);
        }, 400);
    }
}

function initClock() {
    setInterval(() => {
        const now = new Date();
        APP_STATE.domElements.sysClock.innerText = now.toUTCString().replace('GMT', 'UTC');
    }, 1000);
}

// --- 3D ENGINE CORE INFRASTRUCTURE ASSEMBLY ---
function build3DContextEngine() {
    const container = document.getElementById('canvas-container');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06090f);
    scene.fog = new THREE.FogExp2(0x06090f, 0.022);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    clock = new THREE.Clock();
    sharedGlowTexture = generatePreRenderedGlowTexture();

    // Lighting Assembly Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x2fd9ff, 0.8);
    dirLight.position.set(5, 20, 10);
    scene.add(dirLight);

    // Structural Atmosphere Additions
    generateAtmosphericStarfield();
    buildOceanFloorMatrix();
    
    // Inject Island Groups containers into global scene
    Object.values(terrainGroups).forEach(g => scene.add(g));

    // Handle Resize Matrix Shift
    window.addEventListener('resize', onWindowResize);
    setupManualCameraInteractions(renderer.domElement);
    
    updateCameraPosition();
}

function generatePreRenderedGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
}

function generateAtmosphericStarfield() {
    const count = 1800;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    
    for (let i = 0; i < count; i++) {
        const u = Math.random(); const v = Math.random();
        const theta = u * 2.0 * Math.PI; const phi = Math.acos(2.0 * v - 1.0);
        const r = 90 + Math.random() * 30;
        positions[i*3] = r * Math.sin(phi) * Math.sin(theta);
        positions[i*3+1] = Math.abs(r * Math.cos(phi)) * 0.6; // Keep mostly above sea level plane hemisphere
        positions[i*3+2] = r * Math.sin(phi) * Math.cos(theta);
        
        colors[i*3] = 0.18; colors[i*3+1] = 0.75; colors[i*3+2] = 1.0; // Uniform cyan starry tint
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geometry, material);
    scene.add(points);
}

function buildOceanFloorMatrix() {
    const geo = new THREE.PlaneGeometry(120, 120, 48, 48);
    geo.rotateX(-Math.PI / 2);

    const oceanMat = new THREE.ShaderMaterial({
        vertexShader: `
            uniform float uTime;
            varying vec3 vWorldPos;
            varying vec2 vUv;
            void main() {
                vUv = uv;
                vec3 pos = position;
                float w1 = sin(pos.x * 0.08 + uTime * 0.45) * 0.18;
                float w2 = cos(pos.z * 0.08 + uTime * 0.35) * 0.18;
                pos.y += w1 + w2 - 0.5; // Offset slightly below terrain baseline zero axis
                vWorldPos = pos;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            varying vec3 vWorldPos;
            varying vec2 vUv;
            void main() {
                vec3 baseOcean = vec3(0.023, 0.035, 0.059);
                float scan = sin(vWorldPos.x * 1.5 + uTime * 1.2) * cos(vWorldPos.z * 1.5 + uTime * 0.8);
                scan = smoothstep(0.88, 1.0, scan) * 0.038;
                float d = length(vUv - vec2(0.5));
                float vig = smoothstep(0.85, 0.15, d);
                vec3 outCol = (baseOcean + vec3(0.18, 0.85, 1.0) * scan) * vig;
                gl_FragColor = vec4(outCol, 1.0);
            }
        `,
        uniforms: oceanUniforms,
        transparent: false
    });

    const ocean = new THREE.Mesh(geo, oceanMat);
    scene.add(ocean);

    // Decorative Soft Glowing Sub-Basement Disk Halo Matrix
    const haloGeo = new THREE.PlaneGeometry(35, 35);
    haloGeo.rotateX(-Math.PI/2);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x114663, map: sharedGlowTexture, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.position.y = -0.48;
    scene.add(haloMesh);
}

// --- GEOGRAPHIC DATA PARSING ENGINE & MAP CONSTRUCTION ---
function executeAsyncDataFetch() {
    updateBootProgress(15, "Requesting administrative geographic mapping boundary file...");
    
    // Explicit structural constraint: Served via local relative pathway origin pipeline asset bounds
    fetch('geo/ph-regions.json')
        .then(res => {
            if (!res.ok) throw new Error(`HTTP network response fault status code: ${res.status}`);
            return res.json();
        })
        .then(geoJson => {
            updateBootProgress(40, "Geographic file downloaded. Calculating bounding coordinates data coordinates...");
            computeRuntimeGeoProjectionBounds(geoJson);
            updateBootProgress(55, "Constructing regional topological surface geometries...");
            generateTopologyMeshes(geoJson);
            updateBootProgress(85, "Mapping localized store coordinates array vectors...");
            buildStorePinMatrices();
            updateBootProgress(95, "Syncing analytics metrics...");
            refreshGlobalStateInterface();
            updateBootProgress(100, "System fully active.");
        })
        .catch(err => {
            console.error("Critical core setup initialization failure state intercepted:", err);
            updateBootProgress(0, `CRITICAL SYSTEM BOOT FAULT: ${err.message}. Please launch local static server.`);
        });
}

function computeRuntimeGeoProjectionBounds(geoJson) {
    let lons = []; let lats = [];
    geoJson.features.forEach(f => {
        if (!f.geometry) return;
        const processRing = ring => {
            ring.forEach(pt => { lons.push(pt[0]); lats.push(pt[1]); });
        };
        if (f.geometry.type === 'Polygon') {
            f.geometry.coordinates.forEach(processRing);
        } else if (f.geometry.type === 'MultiPolygon') {
            f.geometry.coordinates.forEach(poly => poly.forEach(processRing));
        }
    });

    const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
    
    APP_STATE.geoBounds = {
        minLon, maxLon, minLat, maxLat,
        centerLon: (minLon + maxLon) / 2,
        centerLat: (minLat + maxLat) / 2,
        scaleX: maxLon - minLon,
        scaleZ: maxLat - minLat
    };
}

function convertGeoToWorldXZ(lon, lat) {
    const b = APP_STATE.geoBounds;
    // Map linearly into balanced coordinates tracking aspect ratios efficiently
    const ratio = b.scaleX / b.scaleZ;
    const x = ((lon - b.centerLon) / b.scaleX) * APP_STATE.mapScaleFactor * ratio;
    const z = -((lat - b.centerLat) / b.scaleZ) * APP_STATE.mapScaleFactor; // Invert latitude vector to align standard north direction layout
    return { x, z };
}

// Deterministic Procedural Pseudo-Noise Function Generator
function pseudoHeightNoise(x, z) {
    return Math.sin(x * 0.9) * Math.cos(z * 0.9) * 0.12 + 
           Math.sin(x * 0.3) * 0.18 + 
           Math.cos(z * 0.4) * 0.10;
}

function generateTopologyMeshes(geoJson) {
    // Dynamic temporary bin processing dictionaries
    const groupGeometries = { "Luzon": [], "Visayas": [], "Mindanao": [] };
    
    geoJson.features.forEach(feature => {
        const props = feature.properties;
        if (!props) return;
        
        // Map administrative key relationships
        const psgcCode = props.adm1_psgc;
        const nameEN = props.adm1_en;
        
        // Identify matching metadata record config
        let matchedMeta = Object.values(REGIONS_METADATA).find(r => r.psgc === psgcCode);
        if (!matchedMeta) return; // Unhandled background fillers regions
        
        const islandGroup = matchedMeta.islandGroup;
        const regionId = matchedMeta.id;
        
        const regionFlatGeoms = [];
        
        // Normalize geometric mixed variations (Polygons vs MultiPolygons)
        let polygonSets = [];
        if (feature.geometry.type === 'Polygon') {
            polygonSets = [feature.geometry.coordinates];
        } else if (feature.geometry.type === 'MultiPolygon') {
            polygonSets = feature.geometry.coordinates;
        }
        
        let targetLargestPoly = null;
        let maxPointCount = 0;

        polygonSets.forEach(polyCoords => {
            if (polyCoords.length === 0) return;
            
            // Outer Ring Definition Boundary Loop Path
            const outerRing = polyCoords[0];
            if (outerRing.length > maxPointCount) {
                maxPointCount = outerRing.length;
                targetLargestPoly = outerRing;
            }
            
            const shapePoints = outerRing.map(pt => {
                const w = convertGeoToWorldXZ(pt[0], pt[1]);
                return new THREE.Vector2(w.x, w.z);
            });
            
            const shape = new THREE.Shape(shapePoints);
            
            // Handle Inner Topology Hole Profiles Intersections
            for (let i = 1; i < polyCoords.length; i++) {
                const holePoints = polyCoords[i].map(pt => {
                    const w = convertGeoToWorldXZ(pt[0], pt[1]);
                    return new THREE.Vector2(w.x, w.z);
                });
                shape.holes.push(new THREE.Path(holePoints));
            }
            
            // Using ShapeGeometry strictly as constrained to secure contiguous unbroken vertex patterns
            const flatGeom = new THREE.ShapeGeometry(shape);
            regionFlatGeoms.push(flatGeom);
            
            // Generate Outer Boundary Contours Vector Line paths
            const linePoints = [];
            outerRing.forEach(pt => {
                const w = convertGeoToWorldXZ(pt[0], pt[1]);
                linePoints.push(new THREE.Vector3(w.x, 0.01, w.z)); // Set micro elevation offset to dodge overlapping surface fragments
            });
            const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
            const lineMat = new THREE.LineBasicMaterial({ color: 0x2fd9ff, transparent: true, opacity: 0.16 });
            const lineLoop = new THREE.LineLoop(lineGeo, lineMat);
            terrainGroups[islandGroup].add(lineLoop);
        });
        
        if (regionFlatGeoms.length === 0) return;
        
        // Consolidate separate region island bits into single non-indexed BufferGeometries arrays
        const rawMergedRegionGeom = manualGeometryConcatenation(regionFlatGeoms);
        
        // Displace Vertices height mapping alongside spatial pseudo-noises
        applyDisplacementAndColorization(rawMergedRegionGeom);
        
        // Create Visual Render Mesh
        const visibleMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.45,
            metalness: 0.2,
            flatShading: true,
            side: THREE.DoubleSide
        });
        
        const regionMesh = new THREE.Mesh(rawMergedRegionGeom, visibleMaterial);
        regionMesh.name = `terrain_${regionId}`;
        terrainGroups[islandGroup].add(regionMesh);
        
        // Build Invisible Overlay Target Collision Hit Surface Mesh
        const flatMergedHitGeom = manualGeometryConcatenation(regionFlatGeoms);
        const hitMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
        const hitMesh = new THREE.Mesh(flatMergedHitGeom, hitMaterial);
        hitMesh.userData = { regionId: regionId, islandGroup: islandGroup };
        hitMesh.name = `hit_${regionId}`;
        scene.add(hitMesh);
        hitMeshes.push(hitMesh);
        
        // Anchor HUD Boundary Corner Decorations on Largest Main Landmass Polygon to avoid object explosion pollution
        if (targetLargestPoly) {
            sampleHUDPinnedDecorations(targetLargestPoly, islandGroup);
        }
    });
    
    // Perform manual final compilation merging of whole Island Groups clusters to minimize global pipeline draw-calls
    // Separated here for clarity of operational regional asset separation structure requirements.
}

function manualGeometryConcatenation(geometriesArray) {
    let totalPositionsCount = 0;
    
    const unindexedGeometries = geometriesArray.map(g => {
        const ug = g.index ? g.toNonIndexed() : g.clone();
        totalPositionsCount += ug.attributes.position.count;
        return ug;
    });
    
    const combinedPositionsArray = new Float32Array(totalPositionsCount * 3);
    let positionOffset = 0;
    
    unindexedGeometries.forEach(ug => {
        const posAttrArray = ug.attributes.position.array;
        combinedPositionsArray.set(posAttrArray, positionOffset);
        positionOffset += posAttrArray.length;
        ug.dispose();
    });
    
    const outputBufferGeometry = new THREE.BufferGeometry();
    outputBufferGeometry.setAttribute('position', new THREE.BufferAttribute(combinedPositionsArray, 3));
    return outputBufferGeometry;
}

function applyDisplacementAndColorization(geometry) {
    const posAttr = geometry.attributes.position;
    const count = posAttr.count;
    
    const colorsArray = new Float32Array(count * 3);
    
    for (let i = 0; i < count; i++) {
        let x = posAttr.getX(i);
        let z = posAttr.getZ(i);
        
        // Execute elevation modification transformations
        let heightDisplacement = pseudoHeightNoise(x, z);
        if (heightDisplacement < 0) heightDisplacement *= 0.15; // Flatten sub-sea level artifact valleys
        
        posAttr.setY(i, heightDisplacement);
        
        // Build Procedural Dynamic Hypsometric Tinting Layout Matrix Map Channels
        // Gradient Transitions: Coastal teal (#0d5c75) -> Vegetated green (#114f2c) -> Upland (#3f5e3b) -> Pale ridge highlight (#a3b899)
        let r = 0.05, g = 0.36, b = 0.45; // Base Coastal Teal
        
        if (heightDisplacement > 0.05 && heightDisplacement <= 0.18) {
            // Vegetated Canopy Dark Green
            let t = (heightDisplacement - 0.05) / 0.13;
            r = THREE.MathUtils.lerp(0.05, 0.06, t);
            g = THREE.MathUtils.lerp(0.36, 0.31, t);
            b = THREE.MathUtils.lerp(0.45, 0.17, t);
        } else if (heightDisplacement > 0.18 && heightDisplacement <= 0.28) {
            // Intermediate Uplands Transition
            let t = (heightDisplacement - 0.18) / 0.10;
            r = THREE.MathUtils.lerp(0.06, 0.24, t);
            g = THREE.MathUtils.lerp(0.31, 0.36, t);
            b = THREE.MathUtils.lerp(0.17, 0.23, t);
        } else if (heightDisplacement > 0.28) {
            // Pale Mountain Ridge Crest Profiles
            let t = Math.min((heightDisplacement - 0.28) / 0.15, 1.0);
            r = THREE.MathUtils.lerp(0.24, 0.63, t);
            g = THREE.MathUtils.lerp(0.36, 0.72, t);
            b = THREE.MathUtils.lerp(0.23, 0.60, t);
        }
        
        colorsArray[i*3] = r;
        colorsArray[i*3+1] = g;
        colorsArray[i*3+2] = b;
    }
    
    geometry.setAttribute('color', new THREE.BufferAttribute(colorsArray, 3));
    geometry.computeVertexNormals();
}

function sampleHUDPinnedDecorations(polygonCoordsArray, targetGroup) {
    // Select fixed sample slice arrays without overloading geometry systems pipeline instances
    const stepInterval = Math.max(Math.floor(polygonCoordsArray.length / 5), 1);
    
    for (let i = 0; i < polygonCoordsArray.length; i += stepInterval) {
        const pt = polygonCoordsArray[i];
        const w = convertGeoToWorldXZ(pt[0], pt[1]);
        
        // Generate Minimal Decorative Sci-Fi Boundary Point Node Elements
        const meshGeo = new THREE.BufferGeometry();
        meshGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([w.x, 0.02, w.z]), 3));
        const meshMat = new THREE.PointsMaterial({ color: 0x2fd9ff, size: 0.06, transparent: true, opacity: 0.3 });
        const marker = new THREE.Points(meshGeo, meshMat);
        terrainGroups[targetGroup].add(marker);
    }
}

// --- RETAIL SITE LOCATIONS PLACEMENT MATRIX ENGINE ---
function buildStorePinMatrices() {
    STORES_DATA.forEach(store => {
        const w = convertGeoToWorldXZ(store.lon, store.lat);
        const resolvedBaseY = pseudoHeightNoise(w.x, w.z);
        
        // Parent Site Anchor Node Context Mount Container Group
        const pinGroup = new THREE.Group();
        pinGroup.position.set(w.x, Math.max(resolvedBaseY, 0), w.z);
        pinGroup.userData = { storeId: store.id, regionId: store.region };
        scene.add(pinGroup);
        
        // 1. Vertical Cyber Data Light Beam Pillar (Thin translucent open cylinder geometry mesh)
        const beamGeo = new THREE.CylinderGeometry(0.012, 0.028, 1.4, 6, 1, true);
        beamGeo.translate(0, 0.7, 0); // Translate base up to stand straight on floor connection face coordinates
        const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
        const beamMesh = new THREE.Mesh(beamGeo, beamMat);
        pinGroup.add(beamMesh);
        
        // 2. Central Pulse Core Cluster Sphere
        const coreGeo = new THREE.SphereGeometry(0.05, 8, 8);
        coreGeo.translate(0, 1.4, 0); // Position core at top peak of light beam pipeline extension terminal
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);
        pinGroup.add(coreMesh);
        
        // 3. Camera-Facing Additive Flare Sprite Nodes
        const spriteMat = new THREE.SpriteMaterial({ map: sharedGlowTexture, color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
        const glowSprite = new THREE.Sprite(spriteMat);
        glowSprite.position.set(0, 1.4, 0);
        glowSprite.scale.set(0.45, 0.45, 1);
        pinGroup.add(glowSprite);
        
        // 4. Ground Flat Projection Radial Base Glow Decal Disc Layer (NOT a sprite to dodge camera rotation tilt errors)
        const decalGeo = new THREE.PlaneGeometry(0.48, 0.48);
        decalGeo.rotateX(-Math.PI / 2);
        const decalMat = new THREE.MeshBasicMaterial({ map: sharedGlowTexture, color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
        const decalMesh = new THREE.Mesh(decalGeo, decalMat);
        decalMesh.position.y = 0.005;
        pinGroup.add(decalMesh);
        
        // 5. Ground Expansive Pulsing Radar Ring
        const ringGeo = new THREE.RingGeometry(0.02, 0.24, 16);
        ringGeo.rotateX(-Math.PI/2);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.y = 0.006;
        pinGroup.add(ringMesh);
        
        // Track instance dataset references for runtime loop manipulations tracking
        pinInstances.push({
            storeId: store.id,
            regionId: store.region,
            rootGroup: pinGroup,
            beam: beamMesh,
            core: coreMesh,
            sprite: glowSprite,
            decal: decalMesh,
            ring: ringMesh,
            baseY: Math.max(resolvedBaseY, 0)
        });
    });
    
    evaluateStorePinsColorStates(false);
}

function evaluateStorePinsColorStates(triggerFlashAnimation = false) {
    const targetMonth = APP_STATE.simulationMonth;
    const hexColorStatusMap = { 'approved': 0x4ade80, 'pending': 0xfbbf24, 'issue': 0xf87171 };
    
    pinInstances.forEach(pin => {
        const dataRecord = STORES_DATA.find(s => s.id === pin.storeId);
        if (!dataRecord) return;
        
        // Fetch snapshot historical log configuration record
        const historyState = dataRecord.history.find(h => h.month === targetMonth);
        const resolvedStatus = historyState ? historyState.status : dataRecord.status;
        const targetHexColor = hexColorStatusMap[resolvedStatus] || 0xffffff;
        
        // Apply color vectors shifts down targeted subcomponents tree structures
        pin.beam.material.color.setHex(targetHexColor);
        pin.core.material.color.setHex(targetHexColor);
        pin.sprite.material.color.setHex(targetHexColor);
        pin.decal.material.color.setHex(targetHexColor);
        pin.ring.material.color.setHex(targetHexColor);
        
        // Handle localized Visibility adjustments dependent on active exploration navigation filters context rules
        let visibleFlag = true;
        if (APP_STATE.currentLevel === 'group' && REGIONS_METADATA[pin.regionId].islandGroup !== APP_STATE.selectedGroup) visibleFlag = false;
        if (APP_STATE.currentLevel === 'region' && pin.regionId !== APP_STATE.selectedRegionId) visibleFlag = false;
        if (APP_STATE.currentLevel === 'store' && pin.storeId !== APP_STATE.selectedStoreId) visibleFlag = false;
        
        pin.rootGroup.visible = visibleFlag;
        
        if (visibleFlag && triggerFlashAnimation) {
            // Kickstart explosive temporal expansion flare sequence overrides
            pin.sprite.scale.set(1.1, 1.1, 1);
            pin.ring.scale.set(0.1, 0.1, 0.1);
            pin.ring.material.opacity = 1.0;
        }
    });
}

// --- CONTROL LAYER NAVIGATION FLY-TO LOGIC & DRONE INTERPOLATION MAPPING ---
function executeSwoopTransitionAnimation(targetX, targetZ, endRadius, endTheta, endPhi) {
    cameraControl.animation = {
        startTarget: cameraControl.target.clone(),
        endTarget: new THREE.Vector3(targetX, 0, targetZ),
        startRadius: cameraControl.radius,
        endRadius: endRadius,
        startTheta: cameraControl.theta,
        endTheta: endTheta,
        startPhi: cameraControl.phi,
        endPhi: endPhi,
        elapsed: 0,
        duration: 1.45 // Execution speed limit bounds
    };
}

function processFrameInterpolation(deltaTime) {
    const anim = cameraControl.animation;
    if (!anim) return;
    
    anim.elapsed += deltaTime;
    let progressRatio = Math.min(anim.elapsed / anim.duration, 1.0);
    
    // Cubic Ease-In-Out Profile Acceleration Curve Mapping
    let easeFactor = progressRatio < 0.5 ? 4 * progressRatio * progressRatio * progressRatio : 1 - Math.pow(-2 * progressRatio + 2, 3) / 2;
    
    // Linearly combine vector positions target shifts
    cameraControl.target.lerpVectors(anim.startTarget, anim.endTarget, easeFactor);
    cameraControl.radius = THREE.MathUtils.lerp(anim.startRadius, anim.endRadius, easeFactor);
    
    // Manage Angular wrapping rotations constraints checks
    cameraControl.theta = THREE.MathUtils.lerp(anim.startTheta, anim.endTheta, easeFactor);
    
    // Drone-Like Flight Altitude Dip mechanics integration logic
    let flatInterpolatedPhi = THREE.MathUtils.lerp(anim.startPhi, anim.endPhi, easeFactor);
    let microAltitudeDipArc = Math.sin(progressRatio * Math.PI) * 0.16; // Level out downward camera gaze slightly during linear velocity peaks
    cameraControl.phi = THREE.MathUtils.clamp(flatInterpolatedPhi + microAltitudeDipArc, cameraControl.minPhi, cameraControl.maxPhi);
    
    updateCameraPosition();
    
    if (progressRatio >= 1.0) {
        cameraControl.animation = null; // Flush active thread processing safely
    }
}

function updateCameraPosition() {
    camera.position.x = cameraControl.target.x + cameraControl.radius * Math.sin(cameraControl.phi) * Math.sin(cameraControl.theta);
    camera.position.y = cameraControl.target.y + cameraControl.radius * Math.cos(cameraControl.phi);
    camera.position.z = cameraControl.target.z + cameraControl.radius * Math.sin(cameraControl.phi) * Math.cos(cameraControl.theta);
    camera.lookAt(cameraControl.target);
}

// --- INTERACTION HANDLING SUB-ROUTINES (BOUNDING MOUSE INTERCEPTORS) ---
function setupManualCameraInteractions(targetDomCanvas) {
    const processPointerDown = e => {
        // Blocks structural controls changes if navigation script animations thread locks processing context
        if (cameraControl.animation) return;
        cameraControl.isDragging = true;
        cameraControl.prevX = e.clientX;
        cameraControl.prevY = e.clientY;
    };

    const processPointerMove = e => {
        if (!cameraControl.isDragging || cameraControl.animation) return;
        const deltaX = e.clientX - cameraControl.prevX;
        const deltaY = e.clientY - cameraControl.prevY;
        
        cameraControl.theta -= deltaX * 0.007;
        cameraControl.phi -= deltaY * 0.007;
        cameraControl.phi = THREE.MathUtils.clamp(cameraControl.phi, cameraControl.minPhi, cameraControl.maxPhi);
        
        cameraControl.prevX = e.clientX;
        cameraControl.prevY = e.clientY;
        updateCameraPosition();
    };

    const terminatePointerDrag = () => { cameraControl.isDragging = false; };

    const processWheelZoom = e => {
        if (cameraControl.animation) return;
        cameraControl.radius += e.deltaY * 0.024;
        cameraControl.radius = THREE.MathUtils.clamp(cameraControl.radius, cameraControl.minRadius, cameraControl.maxRadius);
        updateCameraPosition();
    };

    // Desktop Event Bindings Channels
    targetDomCanvas.addEventListener('pointerdown', processPointerDown);
    window.addEventListener('pointermove', processPointerMove);
    window.addEventListener('pointerup', terminatePointerDrag);
    targetDomCanvas.addEventListener('wheel', processWheelZoom, { passive: true });
    
    // Unified Double Click Node Target Raycaster Intersection Matrix Selector Interface
    targetDomCanvas.addEventListener('dblclick', executeViewportRaycastInterception);
}

function executeViewportRaycastInterception(e) {
    if (cameraControl.animation) return;
    
    // Normalized Coordinate Translation Systems Engine Mapping
    const mouseVector = new THREE.Vector2(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
    );
    
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouseVector, camera);
    
    // Level 1: Intercept Interactive Active Visible Retail Store Pin core vectors hits first
    const activeVisiblePinsGroups = pinInstances.filter(p => p.rootGroup.visible).map(p => p.rootGroup);
    const pinIntersections = raycaster.intersectObjects(activeVisiblePinsGroups, true);
    
    if (pinIntersections.length > 0) {
        // Traversed up target subcomponents node mapping layout patterns safely
        let targetGroupNode = pinIntersections[0].object;
        while (targetGroupNode.parent && !targetGroupNode.userData.storeId) {
            targetGroupNode = targetGroupNode.parent;
        }
        if (targetGroupNode.userData.storeId) {
            navigateToHierarchyLevel('store', targetGroupNode.userData.storeId);
            return;
        }
    }
    
    // Level 2: Intercept Secondary Topological Collision Flat Hit Surface Matrix profiles bounds layers
    const hitIntersections = raycaster.intersectObjects(hitMeshes);
    if (hitIntersections.length > 0) {
        const hitData = hitIntersections[0].object.userData;
        
        // Verification validation screening filtering checklist loop checks
        const checkRegionHasSites = Object.values(STORES_DATA).some(s => s.region === hitData.regionId);
        if (!checkRegionHasSites) return; // Deny navigation paths leading to vacant operational regional layouts
        
        if (APP_STATE.currentLevel === 'global') {
            navigateToHierarchyLevel('group', hitData.islandGroup);
        } else if (APP_STATE.currentLevel === 'group') {
            navigateToHierarchyLevel('region', hitData.regionId);
        }
    }
}

// --- DYNAMIC UI DASHBOARD PANEL SYNCHRONIZATION DATA ENGINE ---
function refreshGlobalStateInterface() {
    const d = APP_STATE.domElements;
    const activeMonth = APP_STATE.simulationMonth;
    
    // Filter active store datasets records conforming strictly alongside current drill down parameters filters
    const matchedFilteredStores = STORES_DATA.filter(store => {
        if (APP_STATE.currentLevel === 'group' && REGIONS_METADATA[store.region].islandGroup !== APP_STATE.selectedGroup) return false;
        if (APP_STATE.currentLevel === 'region' && store.region !== APP_STATE.selectedRegionId) return false;
        if (APP_STATE.currentLevel === 'store' && store.id !== APP_STATE.selectedStoreId) return false;
        return true;
    });
    
    // Evaluate operational metrics aggregation snapshots
    let total = matchedFilteredStores.length;
    let approved = 0; let pending = 0; let issue = 0;
    
    matchedFilteredStores.forEach(s => {
        const hist = s.history.find(h => h.month === activeMonth);
        const status = hist ? hist.status : s.status;
        if (status === 'approved') approved++;
        else if (status === 'pending') pending++;
        else if (status === 'issue') issue++;
    });
    
    // Render statistical dashboard display parameters numerical values
    d.mTotal.innerText = String(total).padStart(2, '0');
    d.mApproved.innerText = String(approved).padStart(2, '0');
    d.mPending.innerText = String(pending).padStart(2, '0');
    d.mIssue.innerText = String(issue).padStart(2, '0');
    
    // Synchronize structural UI hierarchy label states
    updateDynamicBreadcrumbsHUD();
    renderContextualDrilldownListHTML();
}

function updateDynamicBreadcrumbsHUD() {
    const d = APP_STATE.domElements;
    
    // Clear display structures defaults
    d.bcGroup.style.display = 'none'; d.bcSep1.style.display = 'none';
    d.bcRegion.style.display = 'none'; d.bcSep2.style.display = 'none';
    d.bcStore.style.display = 'none'; d.bcSep3.style.display = 'none';
    
    if (APP_STATE.currentLevel === 'global') {
        d.hierarchyLabel.innerText = "National Level View";
    }
    if (APP_STATE.currentLevel === 'group' || APP_STATE.selectedGroup) {
        d.bcSep1.style.display = 'inline'; d.bcGroup.style.display = 'inline';
        d.bcGroup.innerText = APP_STATE.selectedGroup.toUpperCase();
        d.hierarchyLabel.innerText = `Island Cluster: ${APP_STATE.selectedGroup}`;
    }
    if (APP_STATE.currentLevel === 'region' || APP_STATE.selectedRegionId) {
        d.bcSep2.style.display = 'inline'; d.bcRegion.style.display = 'inline';
        d.bcRegion.innerText = REGIONS_METADATA[APP_STATE.selectedRegionId].name.toUpperCase();
        d.hierarchyLabel.innerText = `Region: ${REGIONS_METADATA[APP_STATE.selectedRegionId].name}`;
    }
    if (APP_STATE.currentLevel === 'store') {
        d.bcSep3.style.display = 'inline'; d.bcStore.style.display = 'inline';
        const sData = STORES_DATA.find(s => s.id === APP_STATE.selectedStoreId);
        d.bcStore.innerText = sData ? sData.name.toUpperCase() : "";
        d.hierarchyLabel.innerText = "Site Spec Focus";
    }
}

function renderContextualDrilldownListHTML() {
    const d = APP_STATE.domElements;
    d.drilldownList.innerHTML = '';
    const currentMonth = APP_STATE.simulationMonth;
    
    if (APP_STATE.currentLevel === 'global') {
        d.drilldownTitle.innerText = "ISLAND GROUPS DIRECTORY";
        d.btnBackGlobal.style.display = 'none';
        
        ["Luzon", "Visayas", "Mindanao"].forEach(groupName => {
            const count = STORES_DATA.filter(s => REGIONS_METADATA[s.region].islandGroup === groupName).length;
            createDOMItemRow(groupName, `Philippines Main Cluster Group`, `${count} Sites Located`, () => {
                navigateToHierarchyLevel('group', groupName);
            });
        });
    }
    else if (APP_STATE.currentLevel === 'group') {
        d.drilldownTitle.innerText = `${APP_STATE.selectedGroup.toUpperCase()} REGIONAL DIRECTORY`;
        d.btnBackGlobal.style.display = 'block';
        
        Object.values(REGIONS_METADATA)
            .filter(r => r.islandGroup === APP_STATE.selectedGroup)
            .forEach(reg => {
                const regStores = STORES_DATA.filter(s => s.region === reg.id);
                if (regStores.length === 0) return; // Skip empty operational configurations as per specification constraints rules
                
                createDOMItemRow(reg.name, `PSGC Code: ${reg.psgc}`, `${regStores.length} Sites`, () => {
                    navigateToHierarchyLevel('region', reg.id);
                });
            });
    }
    else if (APP_STATE.currentLevel === 'region' || APP_STATE.currentLevel === 'store') {
        d.drilldownTitle.innerText = `SITES IN ${REGIONS_METADATA[APP_STATE.selectedRegionId].name.toUpperCase()}`;
        d.btnBackGlobal.style.display = 'block';
        
        STORES_DATA.filter(s => s.region === APP_STATE.selectedRegionId).forEach(store => {
            const hState = store.history.find(h => h.month === currentMonth);
            const status = hState ? hState.status : store.status;
            
            const badgeElement = document.createElement('span');
            badgeElement.className = `li-badge ${store.id === APP_STATE.selectedStoreId ? 'active-metrics' : ''}`;
            badgeElement.innerText = status.toUpperCase();
            
            createDOMItemRow(store.name, store.city, badgeElement, () => {
                navigateToHierarchyLevel('store', store.id);
            });
        });
    }
}

function createDOMItemRow(primaryText, secondaryText, trailingInfoElement, clickCallbackAction) {
    const d = APP_STATE.domElements;
    const row = document.createElement('div');
    row.className = 'list-item';
    
    const leftBlock = document.createElement('div');
    leftBlock.style.display = 'flex'; leftBlock.style.flexDirection = 'column';
    
    const pLabel = document.createElement('span'); pLabel.className = 'li-primary'; pLabel.innerText = primaryText;
    const sLabel = document.createElement('span'); sLabel.className = 'li-secondary'; sLabel.innerText = secondaryText;
    
    leftBlock.appendChild(pLabel); leftBlock.appendChild(sLabel);
    row.appendChild(leftBlock);
    
    if (typeof trailingInfoElement === 'string') {
        const tLabel = document.createElement('span'); tLabel.className = 'li-badge'; tLabel.innerText = trailingInfoElement;
        row.appendChild(tLabel);
    } else if (trailingInfoElement instanceof HTMLElement) {
        row.appendChild(trailingInfoElement);
    }
    
    row.addEventListener('click', clickCallbackAction);
    d.drilldownList.appendChild(row);
}

// --- DRAWER PROFILE CONTROL MATRIX DISPLAY SYSTEM ---
function displayTargetStoreDrawerDetails(storeId) {
    const d = APP_STATE.domElements;
    const store = STORES_DATA.find(s => s.id === storeId);
    if (!store) return;
    
    const hState = store.history.find(h => h.month === APP_STATE.simulationMonth);
    const resolvedStatus = hState ? hState.status : store.status;
    
    let statusClass = "pill-approved";
    if (resolvedStatus === 'pending') statusClass = "pill-pending";
    if (resolvedStatus === 'issue') statusClass = "pill-issue";
    
    d.drawerContent.innerHTML = `
        <div class="drawer-section drawer-header-meta">
            <span class="status-pill-large ${statusClass}">${resolvedStatus}</span>
            <h2>${store.name}</h2>
            <span class="panel-subtitle">${store.category}</span>
        </div>
        
        <div class="drawer-section">
            <div class="meta-grid">
                <div class="meta-cell"><span class="lbl">CITY NODE</span><span class="val">${store.city}</span></div>
                <div class="meta-cell"><span class="lbl">LAST UPDATE</span><span class="val mono">${store.lastUpdate}</span></div>
                <div class="meta-cell"><span class="lbl">LONGITUDE</span><span class="val mono">${store.lon.toFixed(4)}°E</span></div>
                <div class="meta-cell"><span class="lbl">LATITUDE</span><span class="val mono">${store.lat.toFixed(4)}°N</span></div>
                <div class="meta-cell"><span class="lbl">FOOT TRAFFIC</span><span class="val">${store.footTraffic}</span></div>
                <div class="meta-cell"><span class="lbl">SITE MANAGER</span><span class="val">${store.manager}</span></div>
            </div>
        </div>

        <div class="drawer-section">
            <span class="panel-subtitle" style="margin-bottom:8px;">SECURED LINKED PHOTO CARDS IMAGE STREAM</span>
            <div class="photo-matrix" id="photo-matrix-target"></div>
        </div>

        <div class="drawer-section">
            <span class="panel-subtitle" style="margin-bottom:6px;">STORE LISTING STEP CONTROLS</span>
            <div class="drawer-nav-row">
                <button class="btn-nav-store" id="btn-prev-store">← PREV SITE</button>
                <button class="btn-nav-store" id="btn-next-store">NEXT SITE →</button>
            </div>
        </div>
    `;
    
    // Construct Photo Grid Instances Triggers
    const gridTarget = document.getElementById('photo-matrix-target');
    store.photos.forEach(photo => {
        const card = document.createElement('div');
        card.className = 'photo-card';
        card.innerHTML = `<div class="mock-img-vector"></div><span>${photo.label.toUpperCase()}</span>`;
        card.addEventListener('click', () => triggerLightboxViewportModal(store.name, photo.label));
        gridTarget.appendChild(card);
    });

    // Rebind Inner Context buttons inside dynamic raw html code string frames Injection pipelines
    document.getElementById('btn-prev-store').addEventListener('click', jumpPreviousStoreSequentialIndex);
    document.getElementById('btn-next-store').addEventListener('click', jumpNextStoreSequentialIndex);
    
    d.detailDrawer.classList.add('open');
}

function closeStoreProfileDrawerBlock() {
    APP_STATE.domElements.detailDrawer.classList.remove('open');
    if (APP_STATE.currentLevel === 'store') {
        navigateToHierarchyLevel('region', APP_STATE.selectedRegionId);
    }
}

function jumpPreviousStoreSequentialIndex() {
    const siblingStores = STORES_DATA.filter(s => s.region === APP_STATE.selectedRegionId);
    let idx = siblingStores.findIndex(s => s.id === APP_STATE.selectedStoreId);
    idx = (idx - 1 + siblingStores.length) % siblingStores.length;
    navigateToHierarchyLevel('store', siblingStores[idx].id);
}

function jumpNextStoreSequentialIndex() {
    const siblingStores = STORES_DATA.filter(s => s.region === APP_STATE.selectedRegionId);
    let idx = siblingStores.findIndex(s => s.id === APP_STATE.selectedStoreId);
    idx = (idx + 1) % siblingStores.length;
    navigateToHierarchyLevel('store', siblingStores[idx].id);
}

function triggerLightboxViewportModal(storeTitle, photoLabel) {
    const d = APP_STATE.domElements;
    d.lightboxTitle.innerText = `${storeTitle.toUpperCase()} // INTERIOR TELEMETRY DATASTREAM`;
    d.lightboxTabLabel.innerText = `SOURCE IMAGE STRUCT INTERCEPT: SECURE_FEED_${photoLabel.toUpperCase().replace(/ /g, '_')} // DUMMY PLATFORM VIEWPORT FRAME`;
    d.lightbox.style.display = 'flex';
}

// --- CENTRAL SYSTEM ENGINE NAVIGATION HIERARCHY STATE MANAGER ---
function navigateToHierarchyLevel(targetLevel, argumentId) {
    APP_STATE.currentLevel = targetLevel;
    
    if (targetLevel === 'global') {
        APP_STATE.selectedGroup = null; APP_STATE.selectedRegionId = null; APP_STATE.selectedStoreId = null;
        executeSwoopTransitionAnimation(0, 0, 19, Math.PI/2, Math.PI/3.4);
        APP_STATE.domElements.detailDrawer.classList.remove('open');
    }
    else if (targetLevel === 'group') {
        APP_STATE.selectedGroup = argumentId; APP_STATE.selectedRegionId = null; APP_STATE.selectedStoreId = null;
        APP_STATE.domElements.detailDrawer.classList.remove('open');
        
        // Dynamic center points coordinate re-mapping vectors tracking island core bounds masses
        if (argumentId === 'Luzon') executeSwoopTransitionAnimation(-0.8, -4.5, 11, Math.PI/2, Math.PI/3.8);
        else if (argumentId === 'Visayas') executeSwoopTransitionAnimation(3.5, 1.8, 7.5, Math.PI/1.8, Math.PI/4);
        else if (argumentId === 'Mindanao') executeSwoopTransitionAnimation(4.5, 7.8, 8.5, Math.PI/1.6, Math.PI/4.2);
    }
    else if (targetLevel === 'region') {
        APP_STATE.selectedRegionId = argumentId; APP_STATE.selectedStoreId = null;
        APP_STATE.domElements.detailDrawer.classList.remove('open');
        
        // Find center mass reference points vectors from tracking child store instances metrics
        const regionStores = STORES_DATA.filter(s => s.region === argumentId);
        if (regionStores.length > 0) {
            const w = convertGeoToWorldXZ(regionStores[0].lon, regionStores[0].lat);
            executeSwoopTransitionAnimation(w.x, w.z, 4.2, cameraControl.theta, Math.PI/5);
            APP_STATE.selectedGroup = REGIONS_METADATA[argumentId].islandGroup;
        }
    }
    else if (targetLevel === 'store') {
        APP_STATE.selectedStoreId = argumentId;
        const targetStore = STORES_DATA.find(s => s.id === argumentId);
        if (targetStore) {
            APP_STATE.selectedRegionId = targetStore.region;
            APP_STATE.selectedGroup = REGIONS_METADATA[targetStore.region].islandGroup;
            
            const w = convertGeoToWorldXZ(targetStore.lon, targetStore.lat);
            // Tight focal coordinate target zoom lock fly-to matrices scripts execution
            executeSwoopTransitionAnimation(w.x, w.z, 1.8, cameraControl.theta + 0.4, Math.PI/6);
            displayTargetStoreDrawerDetails(argumentId);
        }
    }
    
    evaluateStorePinsColorStates(false);
    refreshGlobalStateInterface();
}

// --- INTERACTIVE UI DOM EVENT LINKING ENGINE BINDINGS ---
function bindUIEvents() {
    const d = APP_STATE.domElements;
    
    // Breadcrumbs Clicks Linking Navigation Handlers
    d.bcRoot.addEventListener('click', () => navigateToHierarchyLevel('global'));
    d.bcGroup.addEventListener('click', () => navigateToHierarchyLevel('group', APP_STATE.selectedGroup));
    d.bcRegion.addEventListener('click', () => navigateToHierarchyLevel('region', APP_STATE.selectedRegionId));
    
    // Up Level Escapes Action Control Interface Button Triggers
    d.btnBackGlobal.addEventListener('click', () => {
        if (APP_STATE.currentLevel === 'store') navigateToHierarchyLevel('region', APP_STATE.selectedRegionId);
        else if (APP_STATE.currentLevel === 'region') navigateToHierarchyLevel('group', APP_STATE.selectedGroup);
        else if (APP_STATE.currentLevel === 'group') navigateToHierarchyLevel('global');
    });
    
    d.btnCloseDrawer.addEventListener('click', closeStoreProfileDrawerBlock);
    d.lightboxClose.addEventListener('click', () => d.lightbox.style.display = 'none');
    
    // Tab Button Switching Engine Simulation Emulation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            d.lightboxTabLabel.innerText = `SOURCE IMAGE STRUCT INTERCEPT: SECURE_FEED_${e.target.dataset.tab.toUpperCase()} // SIMULATED ENVIRONMENT READ`;
        });
    });

    // Timeline Range Slider Input Scrubber Event Interceptor
    d.timeScrubber.addEventListener('input', e => {
        const val = parseInt(e.target.value);
        APP_STATE.simulationMonth = val;
        
        // Re-toggle highlight tickers visual flags matching target selection node index arrays
        document.querySelectorAll('.tl-tick').forEach(tick => {
            if (parseInt(tick.dataset.idx) === val) tick.classList.add('active');
            else tick.classList.remove('active');
        });
        
        evaluateStorePinsColorStates(true); // Fire up responsive color flashes
        refreshGlobalStateInterface();
        
        if (APP_STATE.currentLevel === 'store') {
            displayTargetStoreDrawerDetails(APP_STATE.selectedStoreId);
        }
    });
    
    // Initialize slider state styles tick defaults sets
    document.querySelector(`.tl-tick[data-idx="${APP_STATE.simulationMonth}"]`).classList.add('active');

    // Attach Keyboard Control Mappings
    window.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (d.lightbox.style.display === 'flex') {
                d.lightbox.style.display = 'none';
            } else if (d.detailDrawer.classList.contains('open')) {
                closeStoreProfileDrawerBlock();
            } else {
                d.btnBackGlobal.click();
            }
        }
        if (APP_STATE.currentLevel === 'store') {
            if (e.key === 'ArrowLeft') jumpPreviousStoreSequentialIndex();
            if (e.key === 'ArrowRight') jumpNextStoreSequentialIndex();
        }
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- RENDERING PIPELINE CONTINUOUS ANIMATION LOOP LAYER ---
renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();
    
    // Advance uniform clocks references parameter vectors inside custom ocean GLSL fragment shaders
    oceanUniforms.uTime.value = elapsedTime;
    
    // Coordinate camera transitions if automated linear movement paths queues contain sequences loops
    processFrameInterpolation(dt);
    
    // Animate structural elements components inside store pins clusters instances arrays
    const wavePulseAmplitudeScalar = Math.sin(elapsedTime * 4.5);
    
    pinInstances.forEach(pin => {
        if (!pin.rootGroup.visible) return;
        
        // Apply micro floating harmonic oscillation bobs vectors across pin core indicators heights
        pin.core.position.y = 1.4 + wavePulseAmplitudeScalar * 0.035;
        pin.sprite.position.y = pin.core.position.y;
        
        // Expand radial pulse rings out into deep space fields structures over progressive clock intervals loops
        let currentRingScale = pin.ring.scale.x + dt * 0.62;
        let currentRingOpacity = 1.0 - (currentRingScale / 1.0);
        
        if (currentRingScale >= 1.0) {
            currentRingScale = 0.01;
            currentRingOpacity = 0.6;
        }
        
        pin.ring.scale.set(currentRingScale, currentRingScale, 1);
        pin.ring.material.opacity = currentRingOpacity;
        
        // Recover original scaling metrics targets if explosive frame transitions scale shifts triggered sequences anomalies
        if (pin.sprite.scale.x > 0.45) {
            const dec = pin.sprite.scale.x - dt * 1.5;
            pin.sprite.scale.set(Math.max(dec, 0.45), Math.max(dec, 0.45), 1);
        }
    });
    
    renderer.render(scene, camera);
});