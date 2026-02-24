// ═══════════════════════════════════════════
// §7 - 3D ENGINE (Three.js)
// Fixed layout, no auto-orbit, depth-fading,
// billboarded labels, proper click detection.
// Spatial indexing via Octree + EdgeAdjacency.
// ═══════════════════════════════════════════
const ThreeEngine = {
 scene: null, camera: null, renderer: null,
 container: null, width: 0, height: 0,
 nodes: [], edges: [], nodeMap: new Map(),
 meshToId: new Map(),
 raycaster: null, pointer: null,
 hoveredNodeId: null, selectedNodeId: null,
 filterCategory: null,
 isDragging: false, dragStart: {x:0,y:0}, dragDist: 0,
 _activePointerId: null, // Track which pointer owns the drag
 _lastPointer: null, // Track previous pointer position for delta calculation
 // Orbit state (with idle auto-rotation)
 spherical: { theta: Math.PI*0.35, phi: Math.PI*0.30, radius: 55 },
 targetSpherical: { theta: Math.PI*0.35, phi: Math.PI*0.30, radius: 55 },
 // Auto-rotation state
 _autoRotate: true,
 _autoRotateSpeed: 0.02, // radians per second - museum-grade slow
 _autoRotateResumeTimer: null,
 orbitTarget: null,
 targetOrbitTarget: null,
 lastPointerScreen: {x:0,y:0},
 pinchStartDist: 0, pinchStartR: 55,
 // Shared assets
 glowTex: null, sharedGeo: null, sharedSubGeo: null,
 edgeMesh: null, glowSprites: [],
 labelSprites: [],
 // ── Improvement #21: Arrow cone meshes for directed edges ──
 arrowMeshes: [], // { mesh, fromId, toId, edgeIdx }
 arrowGroup: null, // THREE.Group container
 sharedArrowGeo: null, // shared ConeGeometry
 // ── Improvement #23: Flythrough state ──
 flythrough: {
 active: false, paused: false,
 pathIds: [], currentIdx: 0, progress: 0,
 dwellTime: 5, transitionTime: 2.5,
 pathName: '', pathColor: '#e0c050',
 nodeSet: null, // Set of all path node IDs for muting
 focusId: null, // Currently focused node ID
 prevFocusId: null, // Previous focus (for transition edge animation)
 transitionEdgeAlpha: 0, // 0→1 during transitions for the connecting edge
 arrivalGlow: 0, // Bloom burst on node arrival
 },
 animFrame: null, time: 0, clock: null,
 // ── Visibility & dirty-state animation control ──
 _paused: false, // true when tab is hidden
 _dirty: true, // true when scene needs re-rendering
 _dirtyFrames: 0, // count down extra frames after last change (settle lerps)
 _settleFrames: DeviceCapabilities.quality.settleFrames,
 _lastFilterCategory: null,
 _lastSelectedNodeId: null,
 _lastHoveredNodeId: null,
 _lastFlythroughFocusId: null,
 // ── Spatial indexing ──
 octree: new Octree(),
 adjacency: new EdgeAdjacency(),
 _frustum: null, // THREE.Frustum - lazy init
 _frustumMatrix: null, // THREE.Matrix4 - lazy init
 _rayOrigin: null, // THREE.Vector3 - reusable
 _rayDir: null, // THREE.Vector3 - reusable
 _hoverConnsCache: null, // cached Set for current highlight
 _hoverConnsCacheId: null, // which nodeId the cache is for
 _hoverThrottleFrame: 0, // skip hover raycast on odd frames
 _hasReviewDueNodes: false, // true only when review-due pulsation is needed
 _projVec: null, // reusable Vector3 for projection (avoid clone())
 _lerpVec: null, // reusable Vector3 for lerp in flythrough

 init() {
 // ── r152+ Color Management ──
 // Enable proper sRGB color management for vibrant, accurate colors.
 // With r170, ColorManagement + SRGBColorSpace produces correct, vivid output.
 THREE.ColorManagement.enabled = true;

 // Deferred THREE.Vector3 initialization (safe - only called when THREE is confirmed available)
 if (!this.orbitTarget) this.orbitTarget = new THREE.Vector3(0,0,0);
 if (!this.targetOrbitTarget) this.targetOrbitTarget = new THREE.Vector3(0,0,0);

 this.container = document.getElementById('three-container');
 this.width = this.container.clientWidth;
 this.height = this.container.clientHeight;

 // Scene
 this.scene = new THREE.Scene();
 this.scene.fog = new THREE.FogExp2(0x000000, 0.004);

 // Camera
 this.camera = new THREE.PerspectiveCamera(50, this.width/this.height, 0.1, 500);
 this.updateCameraFromSpherical();

 // Renderer
 const q = DeviceCapabilities.quality;
 this.renderer = new THREE.WebGLRenderer({
 antialias: !DeviceCapabilities.isLowEnd,
 alpha: false,
 powerPreference: DeviceCapabilities.isMobile ? 'low-power' : 'high-performance',
 // ── Fail gracefully if WebGL2 not available ──
 failIfMajorPerformanceCaveat: false,
 });
 this.renderer.setSize(this.width, this.height);
 this.renderer.setPixelRatio(q.pixelRatio);
 this.renderer.setClearColor(0x000000, 1);
 // r152+ SRGBColorSpace for correct, vibrant color output
 this.renderer.outputColorSpace = THREE.SRGBColorSpace;
 this.renderer.toneMapping = THREE.NoToneMapping;
 this.container.appendChild(this.renderer.domElement);

 // Raycaster
 this.raycaster = new THREE.Raycaster();
 this.raycaster.params.Points = { threshold: 1.5 };
 this.pointer = new THREE.Vector2();

 // ── Spatial index temp objects ──
 Octree._tmpBox = new THREE.Box3();
 Octree._tmpSphere = new THREE.Sphere();
 this._frustum = new THREE.Frustum();
 this._frustumMatrix = new THREE.Matrix4();
 this._rayOrigin = new THREE.Vector3();
 this._rayDir = new THREE.Vector3();

 // Glow texture (shared, cached)
 this.glowTex = this.createGlowTexture();

 // Shared geometries (adaptive detail)
 const qGeo = DeviceCapabilities.quality;
 this.sharedGeo = new THREE.SphereGeometry(1, qGeo.sphereSegments[0], qGeo.sphereSegments[1]);
 this.sharedSubGeo = new THREE.SphereGeometry(1, qGeo.subSphereSegments[0], qGeo.subSphereSegments[1]);

 // Ambient + point lights - refined for cinematic warmth
 // Note: r155+ defaults PointLight decay to 2 (physically correct).
 // We set decay=1 to preserve the r128 visual appearance.
 this.scene.add(new THREE.AmbientLight(0x445566, 0.8));
 const keyLight = new THREE.PointLight(0xdcc15a, 1.0, 350, 1);
 keyLight.position.set(0, 35, 25);
 this.scene.add(keyLight);
 const fillLight = new THREE.PointLight(0x5588bb, 0.45, 350, 1);
 fillLight.position.set(-35, -10, -25);
 this.scene.add(fillLight);
 const rimLight = new THREE.PointLight(0x8855aa, 0.25, 280, 1);
 rimLight.position.set(25, -25, 35);
 this.scene.add(rimLight);
 // ── Pure Black Void Background ──
 this.scene.background = new THREE.Color(0x000000);

 this.buildGraph();
 this.bindEvents();
 this.clock = new THREE.Clock();
 // ── Visibility-aware animation loop ──
 this._boundVisibility = () => this._onVisibilityChange();
 document.addEventListener('visibilitychange', this._boundVisibility);
 this.markDirty(); // kick off the first frame
 },

 createGlowTexture() {
 const c = document.createElement('canvas');
 c.width = 64; c.height = 64;
 const ctx = c.getContext('2d');
 const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
 g.addColorStop(0, 'rgba(255,255,255,0.7)');
 g.addColorStop(0.2, 'rgba(255,255,255,0.3)');
 g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
 g.addColorStop(1, 'rgba(255,255,255,0)');
 ctx.fillStyle = g;
 ctx.fillRect(0, 0, 64, 64);
 return new THREE.CanvasTexture(c);
 },

 createLabelTexture(text, color) {
 const canvasW = DeviceCapabilities.quality.labelCanvasWidth;
 const canvasH = Math.round(canvasW / 8);
 const fontSize = Math.round(canvasW / 21);
 const c = document.createElement('canvas');
 c.width = canvasW; c.height = canvasH;
 const ctx = c.getContext('2d');
 ctx.font = fontSize + 'px Cormorant Garamond, Georgia, serif';
 ctx.textAlign = 'center';
 ctx.textBaseline = 'middle';
 ctx.fillStyle = color || '#d8d4c8';
 ctx.globalAlpha = 1.0;
 let displayText = text;
 const maxLabelWidth = canvasW * 0.85;
 while (ctx.measureText(displayText).width > maxLabelWidth && displayText.length > 10) {
 displayText = displayText.slice(0, -2);
 }
 if (displayText !== text) displayText += '…';
 ctx.fillText(displayText, canvasW / 2, canvasH / 2);
 const tex = new THREE.CanvasTexture(c);
 // ── Optimize texture filtering for lower-end devices ──
 if (DeviceCapabilities.gpuTier === 'low') {
 tex.minFilter = THREE.LinearFilter;
 tex.generateMipmaps = false;
 }
 return tex;
 },

 buildGraph() {
 try {
 this._buildGraphInner();
 } catch (err) {
 console.error('[ThreeEngine] buildGraph failed:', err);
 throw err; // re-throw so init()'s caller can handle it
 }
 },

 _buildGraphInner() {
 const lociCount = LOCI.length;
 let outerIdx = 0;

 // Layout: Christ at origin, loci on a hemisphere surface
 LOCI.forEach((locus) => {
 const isCenter = locus.o === 0;
 let px, py, pz;
 if (isCenter) {
 px = 0; py = 0; pz = 0;
 } else {
 // Fibonacci hemisphere distribution for even spacing
 const n = lociCount - 1;
 const golden = (1 + Math.sqrt(5)) / 2;
 const theta = 2 * Math.PI * outerIdx / golden;
 const phi = Math.acos(1 - (outerIdx + 0.5) / n);
 const r = 18 + locus.r * 4;
 px = r * Math.sin(phi) * Math.cos(theta);
 py = r * Math.cos(phi) * 0.75 + (locus.r - 1.3) * 2.5;
 pz = r * Math.sin(phi) * Math.sin(theta);
 outerIdx++;
 }

 // Parse color
 const col = new THREE.Color(locus.c);
 const nodeR = isCenter ? 2.2 : 0.5 + locus.r * 0.5;

 // Mesh (shared geometry, unique material for color)
 const mat = new THREE.MeshLambertMaterial({
 color: col, emissive: col, emissiveIntensity: 0.55,
 transparent: true, opacity: 1.0,
 });
 const mesh = new THREE.Mesh(this.sharedGeo, mat);
 mesh.scale.setScalar(nodeR);
 mesh.position.set(px, py, pz);
 this.scene.add(mesh);
 this.meshToId.set(mesh.uuid, locus.id);

 // Glow sprite (skip on low-end devices)
 if (DeviceCapabilities.quality.enableGlow) {
 const spriteMat = new THREE.SpriteMaterial({
 map: this.glowTex, color: col, transparent: true,
 opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false
 });
 const sprite = new THREE.Sprite(spriteMat);
 sprite.scale.setScalar(nodeR * 5.8);
 sprite.position.copy(mesh.position);
 this.scene.add(sprite);

 var nodeSprite = sprite;
 var nodeSpriteMat = spriteMat;
 } else {
 // Dummy sprite material for uniform node shape
 var nodeSprite = null;
 var nodeSpriteMat = { opacity: 0 };
 }

 // Label sprite (billboarded) - respect maxLabelSprites for low-end devices
 const labelCount = this.labelSprites.length;
 let label = null;
 if (labelCount < DeviceCapabilities.quality.maxLabelSprites) {
 const labelTex = this.createLabelTexture(locus.n, locus.c);
 const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, opacity: 0.85, depthTest: true, depthWrite: false });
 label = new THREE.Sprite(labelMat);
 label.scale.set(12, 1.5, 1);
 label.position.set(px, py - nodeR - 1.5, pz);
 this.scene.add(label);
 this.labelSprites.push({ sprite: label, nodeId: locus.id });
 }

 const node3d = {
 id: locus.id, mesh, sprite: nodeSprite, label, mat, spriteMat: nodeSpriteMat,
 pos: new THREE.Vector3(px, py, pz),
 basePos: new THREE.Vector3(px, py, pz),
 radius: nodeR, color: locus.c, category: locus.ct,
 type: 'locus', parentId: null,
 targetOpacity: 1.0, targetGlow: 0.62, targetLabelOpacity: 0.85,
 };
 this.nodes.push(node3d);
 this.nodeMap.set(locus.id, node3d);

 // Sub-topics clustered near parent
 if (locus.s) {
 locus.s.forEach((sub, si) => {
 const subAngle = (si / locus.s.length) * Math.PI * 2;
 const subDist = nodeR + 2.5 + Math.random() * 1;
 const sx = px + Math.cos(subAngle) * subDist;
 const sy = py + Math.sin(subAngle * 0.4) * subDist * 0.3;
 const sz = pz + Math.sin(subAngle) * subDist;

 const subCol = new THREE.Color(locus.c);
 const subMat = new THREE.MeshLambertMaterial({
 color: subCol, emissive: subCol, emissiveIntensity: 0.5,
 transparent: true, opacity: 0.9,
 });
 const subMesh = new THREE.Mesh(this.sharedSubGeo, subMat);
 subMesh.scale.setScalar(0.37);
 subMesh.position.set(sx, sy, sz);
 this.scene.add(subMesh);
 this.meshToId.set(subMesh.uuid, sub.id);

 // Sub glow (smaller) - conditional on device capability
 let subGlow = null, subGlowMat;
 if (DeviceCapabilities.quality.enableGlow) {
 subGlowMat = new THREE.SpriteMaterial({
 map: this.glowTex, color: subCol, transparent: true,
 opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false
 });
 subGlow = new THREE.Sprite(subGlowMat);
 subGlow.scale.setScalar(2.6);
 subGlow.position.copy(subMesh.position);
 this.scene.add(subGlow);
 } else {
 subGlowMat = { opacity: 0 };
 }

 const subNode = {
 id: sub.id, mesh: subMesh, sprite: subGlow, label: null, mat: subMat, spriteMat: subGlowMat,
 pos: new THREE.Vector3(sx, sy, sz),
 basePos: new THREE.Vector3(sx, sy, sz),
 radius: 0.37, color: locus.c, category: sub.ct || locus.ct,
 type: 'sub', parentId: locus.id,
 targetOpacity: 0.9, targetGlow: 0.35, targetLabelOpacity: 0,
 };
 this.nodes.push(subNode);
 this.nodeMap.set(sub.id, subNode);

 // Parent-child edge
 this.edges.push({ from: sub.id, to: locus.id, type: 'parent' });
 });
 }
 });

 // Build ALL edges as a single LineSegments geometry (batch)
 const edgeSet = [...this.edges];
 // Add cross-reference edges with typed relationships (O(1) dedup via Set)
 const edgeKeySet = new Set();
 edgeSet.forEach(e => edgeKeySet.add(e.from < e.to ? e.from + '|' + e.to : e.to + '|' + e.from));
 LOCI.forEach(locus => {
 if (locus.cl) {
 locus.cl.forEach(tid => {
 if (this.nodeMap.has(tid)) {
 const key = locus.id < tid ? locus.id + '|' + tid : tid + '|' + locus.id;
 if (!edgeKeySet.has(key)) {
 edgeKeySet.add(key);
 edgeSet.push({ from: locus.id, to: tid, type: 'cross' });
 }
 }
 });
 }
 });
 this.edges = edgeSet;

 const edgeVerts = [];
 const edgeColors = [];
 edgeSet.forEach(e => {
 const a = this.nodeMap.get(e.from);
 const b = this.nodeMap.get(e.to);
 if (!a || !b) return;
 edgeVerts.push(a.pos.x, a.pos.y, a.pos.z, b.pos.x, b.pos.y, b.pos.z);
 const alpha = e.type === 'parent' ? 0.15 : 0.06;
 edgeColors.push(alpha, alpha, alpha, alpha, alpha, alpha);
 });
 const edgeGeo = new THREE.BufferGeometry();
 edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgeVerts, 3));
 edgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(edgeColors, 3));
 const edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false });
 this.edgeMesh = new THREE.LineSegments(edgeGeo, edgeMat);
 this.scene.add(this.edgeMesh);

 // ── Improvement #21: Directional arrow cones for typed edges ──
 if (!DeviceCapabilities.isLowEnd) {
 this.sharedArrowGeo = new THREE.ConeGeometry(0.18, 0.5, 6);
 this.sharedArrowGeo.rotateX(Math.PI / 2); // point along +Z
 this.arrowGroup = new THREE.Group();
 const _tmpDir = new THREE.Vector3();
 const _tmpUp = new THREE.Vector3(0, 1, 0);
 const _tmpFwd = new THREE.Vector3(0, 0, 1);
 edgeSet.forEach((e, ei) => {
 if (e.type === 'parent') return;
 const a = this.nodeMap.get(e.from);
 const b = this.nodeMap.get(e.to);
 if (!a || !b) return;
 const arrowMat = new THREE.MeshBasicMaterial({
 color: 0x888888, transparent: true, opacity: 0.0, depthWrite: false
 });
 const arrowMesh = new THREE.Mesh(this.sharedArrowGeo, arrowMat);
 const t = 0.82;
 arrowMesh.position.lerpVectors(a.pos, b.pos, t);
 _tmpDir.subVectors(b.pos, a.pos).normalize();
 arrowMesh.quaternion.setFromUnitVectors(_tmpFwd, _tmpDir);
 arrowMesh.scale.setScalar(0.9);
 this.arrowGroup.add(arrowMesh);
 this.arrowMeshes.push({
 mesh: arrowMesh, mat: arrowMat,
 fromId: e.from, toId: e.to, edgeIdx: ei
 });
 });
 this.scene.add(this.arrowGroup);
 }

 // ── Build spatial index ──
 // The octree accelerates raycast from O(n) to O(log n).
 // Items are the node3d objects which already have pos and radius.
 this.octree.build(this.nodes);
 this.adjacency.build(this.edges);
 console.log(`[Spatial] Octree built for ${this.nodes.length} nodes, adjacency for ${this.edges.length} edges`);
 },

 updateCameraFromSpherical() {
 const s = this.spherical;
 this.camera.position.set(
 s.radius * Math.sin(s.phi) * Math.sin(s.theta) + this.orbitTarget.x,
 s.radius * Math.cos(s.phi) + this.orbitTarget.y,
 s.radius * Math.sin(s.phi) * Math.cos(s.theta) + this.orbitTarget.z
 );
 this.camera.lookAt(this.orbitTarget);
 },

 bindEvents() {
 const dom = this.renderer.domElement;

 // ── Unified pointer handling (works for mouse AND touch) ──
 dom.addEventListener('pointerdown', e => {
 // Prevent multi-touch pointer conflicts
 if (this._activePointerId !== null && this._activePointerId !== e.pointerId) return;
 this._activePointerId = e.pointerId;
 dom.setPointerCapture(e.pointerId);
 this.isDragging = true;
 this._autoRotate = false;
 this.dragStart = { x: e.clientX, y: e.clientY };
 this._lastPointer = { x: e.clientX, y: e.clientY };
 this.dragDist = 0;
 dom.style.cursor = 'grabbing';
 this.markDirty();
 });

 window.addEventListener('pointermove', e => {
 const rect = dom.getBoundingClientRect();
 this.lastPointerScreen = { x: e.clientX, y: e.clientY };
 this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
 this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
 this.markDirty(10); // wake for hover raycast

 if (this.isDragging && this._activePointerId === e.pointerId) {
 const dx = e.clientX - this.dragStart.x;
 const dy = e.clientY - this.dragStart.y;
 this.dragDist = Math.hypot(dx, dy);
 // ── Use calculated delta instead of movementX/Y (more reliable on touch) ──
 const movX = e.clientX - (this._lastPointer ? this._lastPointer.x : e.clientX);
 const movY = e.clientY - (this._lastPointer ? this._lastPointer.y : e.clientY);
 this._lastPointer = { x: e.clientX, y: e.clientY };
 // ── Adaptive orbit sensitivity: touch needs more responsiveness ──
 const sensitivity = DeviceCapabilities.hasTouch ? 0.008 : 0.005;
 this.targetSpherical.theta -= movX * sensitivity;
 this.targetSpherical.phi = Math.max(0.2, Math.min(Math.PI - 0.2,
 this.targetSpherical.phi + movY * sensitivity
 ));
 }
 });

 window.addEventListener('pointerup', (e) => {
 if (this._activePointerId === e.pointerId) {
 this.isDragging = false;
 this._activePointerId = null;
 this._lastPointer = null;
 this.renderer.domElement.style.cursor = 'grab';
 // Resume auto-rotation from current position after drag
 if (!this.selectedNodeId) {
  clearTimeout(this._autoRotateResumeTimer);
  this._autoRotateResumeTimer = setTimeout(() => {
   if (!this.selectedNodeId && !this.hoveredNodeId && !this.isDragging) {
    this._autoRotate = true;
    this.markDirty();
   }
  }, 3000);
 }
 this.markDirty();
 }
 });
 window.addEventListener('pointercancel', (e) => {
 if (this._activePointerId === e.pointerId) {
 this.isDragging = false;
 this._activePointerId = null;
 this._lastPointer = null;
 this.renderer.domElement.style.cursor = 'grab';
 }
 });

 dom.addEventListener('wheel', e => {
 e.preventDefault();
 this.targetSpherical.radius = Math.max(15, Math.min(120,
 this.targetSpherical.radius + e.deltaY * 0.04
 ));
 this.markDirty();
 }, { passive: false });

 dom.addEventListener('click', e => {
 if (this.dragDist > 5) return; // Was a drag, not a click
 // ── Octree-accelerated click raycast ──
 this.raycaster.setFromCamera(this.pointer, this.camera);
 const ray = this.raycaster.ray;
 const hits = this.octree.raycast(ray.origin, ray.direction, 500);
 if (hits.length) {
 // Only consider visible nodes (opacity > 0.1)
 for (let i = 0; i < hits.length; i++) {
 const node = hits[i].item;
 if (node.mat.opacity > 0.1) {
 openPanel(node.id);
 break;
 }
 }
 }
 });

 // ── Touch pinch zoom (two-finger only) ──
 let pinchStartDist = 0, pinchStartR = 55;
 dom.addEventListener('touchstart', e => {
 if (e.touches.length === 2) {
 pinchStartDist = Math.hypot(
 e.touches[0].clientX - e.touches[1].clientX,
 e.touches[0].clientY - e.touches[1].clientY
 );
 pinchStartR = this.spherical.radius;
 }
 this.markDirty();
 }, { passive: true });
 dom.addEventListener('touchmove', e => {
 if (e.touches.length === 2) {
 e.preventDefault();
 const d = Math.hypot(
 e.touches[0].clientX - e.touches[1].clientX,
 e.touches[0].clientY - e.touches[1].clientY
 );
 const scale = pinchStartDist / d;
 this.targetSpherical.radius = Math.max(15, Math.min(120, pinchStartR * scale));
 this.markDirty();
 }
 }, { passive: false });

 // ── ResizeObserver for container-level resizes (more reliable than window.resize) ──
 if (typeof ResizeObserver !== 'undefined') {
 this._resizeObserver = new ResizeObserver(rafDebounce(() => this.resize()));
 this._resizeObserver.observe(this.container);
 }
 // Fallback for older browsers
 window.addEventListener('resize', rafDebounce(() => this.resize()));
 },

 resize() {
 this.width = this.container.clientWidth;
 this.height = this.container.clientHeight;
 this.camera.aspect = this.width / this.height;
 this.camera.updateProjectionMatrix();
 this.renderer.setSize(this.width, this.height);
 
 this.markDirty();
 },

 focusNode(nodeId, zoom) {
 const node = this.nodeMap.get(nodeId);
 if (!node) return;
 this.targetOrbitTarget.copy(node.pos);
 if (zoom) this.targetSpherical.radius = Math.max(15, 55 / zoom);
 this.markDirty();
 },

 filterByCategory(cat) {
 this.filterCategory = cat;
 this.markDirty();
 },

 projectToScreen(pos) {
 if (!this._projVec) this._projVec = new THREE.Vector3();
 this._projVec.copy(pos).project(this.camera);
 return {
 x: (this._projVec.x * 0.5 + 0.5) * this.width,
 y: (-this._projVec.y * 0.5 + 0.5) * this.height,
 };
 },

 // ── Dirty-state & visibility management ──
 markDirty(extraFrames) {
 this._dirty = true;
 this._dirtyFrames = Math.max(this._dirtyFrames, extraFrames || this._settleFrames);
 // If paused (tab hidden), don't restart - animate() will resume on visibility change
 if (!this._paused && !this.animFrame) {
 this.animFrame = requestAnimationFrame(() => this.animate());
 }
 },

 _onVisibilityChange() {
 if (document.hidden) {
 this._paused = true;
 if (this.animFrame) {
 cancelAnimationFrame(this.animFrame);
 this.animFrame = null;
 }
 } else {
 this._paused = false;
 // Clamp clock delta on wake to prevent huge time jumps
 if (this.clock) this.clock.getDelta();
 this.markDirty();
 }
 },

 animate() {
 this.animFrame = null; // clear so markDirty() can re-schedule

 // ── Tab hidden: stop the loop entirely ──
 if (document.hidden || this._paused) return;

 try {
 this._animateFrame();
 } catch (err) {
 console.error('[ThreeEngine] Runtime error in animate loop:', err);
 // Let ActiveEngine handle degradation (shows banner, disables 3D)
 if (!ActiveEngine._runtimeFailed) {
 ActiveEngine._handleRuntimeFailure(err);
 }
 return; // stop the loop
 }
 },

 /** Inner animation body - separated so try-catch is tight */
 _animateFrame() {
 const orbitSettled =
 Math.abs(this.targetSpherical.theta - this.spherical.theta) < 0.0001 &&
 Math.abs(this.targetSpherical.phi - this.spherical.phi) < 0.0001 &&
 Math.abs(this.targetSpherical.radius - this.spherical.radius) < 0.001 &&
 this.orbitTarget.distanceTo(this.targetOrbitTarget) < 0.001;

 const stateChanged =
 this._lastFilterCategory !== this.filterCategory ||
 this._lastSelectedNodeId !== this.selectedNodeId ||
 this._lastHoveredNodeId !== this.hoveredNodeId ||
 this._lastFlythroughFocusId !== (this.flythrough.active ? this.flythrough.focusId : null);

 if (stateChanged) {
 this._lastFilterCategory = this.filterCategory;
 this._lastSelectedNodeId = this.selectedNodeId;
 this._lastHoveredNodeId = this.hoveredNodeId;
 this._lastFlythroughFocusId = this.flythrough.active ? this.flythrough.focusId : null;
 this._dirtyFrames = this._settleFrames;
 }

 // Count down settle frames
 if (this._dirtyFrames > 0) this._dirtyFrames--;

 // If orbit is settled, no state change, and settle frames exhausted - stop looping
 // Exception: flythrough mode or nodes with pulsation need continuous updates
 const inFlythrough = this.flythrough.active;
 // Only keep looping for pulsation if there are review-due nodes (not all studied nodes)
 const hasPulsatingNodes = this._hasReviewDueNodes;
 const isAutoRotating = this._autoRotate && !this.isDragging && !this.hoveredNodeId && !this.selectedNodeId && !inFlythrough;
 if (orbitSettled && !stateChanged && this._dirtyFrames <= 0 && !this.isDragging && !inFlythrough && !hasPulsatingNodes && !isAutoRotating) {
 this._dirty = false;
 return; // animation loop stops; markDirty() will restart it
 }
 // ── Use real delta time from Clock for frame-rate independence ──
 const dt = this.clock ? Math.min(this.clock.getDelta(), 0.05) : 0.016;
 this.time += dt;
 
 this._hoverThrottleFrame++;

 // ── Auto-rotation when idle ──
 if (this._autoRotate && !this.isDragging && !this.hoveredNodeId && !this.selectedNodeId && !this.flythrough.active) {
 this.targetSpherical.theta += this._autoRotateSpeed * dt;
 this.spherical.theta += this._autoRotateSpeed * dt;
 this._dirty = true;
 this._dirtyFrames = Math.max(this._dirtyFrames, 2);
 }

 // Smooth orbit interpolation (fast convergence)
 this.spherical.theta += (this.targetSpherical.theta - this.spherical.theta) * 0.12;
 this.spherical.phi += (this.targetSpherical.phi - this.spherical.phi) * 0.12;
 this.spherical.radius += (this.targetSpherical.radius - this.spherical.radius) * 0.12;
 this.orbitTarget.lerp(this.targetOrbitTarget, 0.09);
 this.updateCameraFromSpherical();

 // ── Hover detection via Octree (throttled adaptively per device) ──
 const hoverThrottle = DeviceCapabilities.quality.hoverThrottle;
 if (!this.isDragging && (this._hoverThrottleFrame % hoverThrottle) === 0) {
 this.raycaster.setFromCamera(this.pointer, this.camera);
 const ray = this.raycaster.ray;
 const hits = this.octree.raycast(ray.origin, ray.direction, 500);

 let newHover = null;
 // Find the nearest *visible* hit
 for (let i = 0; i < hits.length; i++) {
 const node = hits[i].item;
 if (node.mat.opacity > 0.1) {
 newHover = node.id;
 break;
 }
 }

 if (this.hoveredNodeId !== newHover) {
 this.hoveredNodeId = newHover;
 if (newHover) this._autoRotate = false;
 this._hoverConnsCache = null; // invalidate adjacency cache
 this._hoverConnsCacheId = null;
 const dom = this.renderer.domElement;
 dom.style.cursor = newHover ? 'pointer' : 'grab';
 if (newHover) {
 const node = this.nodeMap.get(newHover);
 if (node) {
 const sp = this.projectToScreen(node.pos);
 updateTooltip(newHover, sp);
 }
 } else {
 updateTooltip(null);
 // Resume auto-rotation if nothing selected
 if (!this.selectedNodeId) {
 clearTimeout(this._autoRotateResumeTimer);
 this._autoRotateResumeTimer = setTimeout(() => {
 if (!this.selectedNodeId && !this.hoveredNodeId && !this.isDragging) {
 this._autoRotate = true;
 this.markDirty();
 }
 }, 3000);
 }
 }
 } else if (newHover) {
 const node = this.nodeMap.get(newHover);
 if (node) {
 const sp = this.projectToScreen(node.pos);
 updateTooltip(newHover, sp);
 }
 }
 }

 // ── Connection highlight via EdgeAdjacency (O(1) lookup, cached) ──
 // During flythrough, the focused node acts as the highlight target
 const ftFocusId = this.flythrough.active ? this.flythrough.focusId : null;
 const highlightId3d = ftFocusId || this.hoveredNodeId || this.selectedNodeId;
 let hoverConns;
 if (highlightId3d) {
 // Cache the adjacency set - only rebuild when highlight target changes
 if (this._hoverConnsCacheId !== highlightId3d) {
 this._hoverConnsCache = this.adjacency.getHighlightSet(highlightId3d);
 this._hoverConnsCacheId = highlightId3d;
 }
 hoverConns = this._hoverConnsCache;
 } else {
 hoverConns = null;
 this._hoverConnsCache = null;
 this._hoverConnsCacheId = null;
 }

 const pathIds = activePath ? new Set(activePath.ids) : null;
 // Flythrough provides its own path-like set for keeping path nodes visible
 const ftNodeSet = (this.flythrough.active && this.flythrough.nodeSet) ? this.flythrough.nodeSet : null;

 // ── Frustum culling: compute camera frustum ──
 this._frustumMatrix.multiplyMatrices(
 this.camera.projectionMatrix, this.camera.matrixWorldInverse
 );
 this._frustum.setFromProjectionMatrix(this._frustumMatrix);

 // ── Update node visuals (with frustum awareness) ──
 const nodes = this.nodes;
 const nodesLen = nodes.length;
 for (let i = 0; i < nodesLen; i++) {
 const node = nodes[i];

 // Quick frustum check - skip opacity lerping for fully off-screen nodes
 // unless they're being filtered/highlighted (which needs to decay)
 const inFrustum = this._frustum.containsPoint(node.pos);

 // Early-out: if off-screen and already converged, skip entirely
 if (!inFrustum && !stateChanged) {
 const oD = Math.abs(node.mat.opacity - (node.type === 'locus' ? 1.0 : 0.9));
 if (oD < 0.01) continue;
 }

 let tO = node.type === 'locus' ? 1.0 : 0.9;
 let tG = node.type === 'locus' ? 0.62 : 0.35;
 let tL = node.type === 'locus' ? 0.85 : 0;

 // Category filter
 if (this.filterCategory) {
 const nd = nodeIndex.get(node.id);
 if (nd && nd.ct !== this.filterCategory) { tO = 0.04; tG = 0.02; tL = 0; }
 else { tG = 0.5; }
 }

 // Hover/selection (uses cached adjacency set)
 if (hoverConns) {
 if (hoverConns.has(node.id)) {
 tG = node.id === highlightId3d ? 0.85 : 0.6;
 tO = 1; tL = node.type === 'locus' ? 1 : 0;
 } else if (!this.filterCategory) {
 tO = 0.08; tG = 0.02; tL = 0.1;
 }
 }

 // Path
 if (pathIds) {
 if (pathIds.has(node.id)) {
 const isCurrent = activePath.ids[activePathIndex] === node.id;
 tG = isCurrent ? 0.85 : 0.45; tO = 1; tL = 0.9;
 } else { tO = 0.04; tG = 0.01; tL = 0; }
 }

 // Search
 if (searchHighlightIds) {
 if (searchHighlightIds.has(node.id)) { tG = 0.75; tO = 1; tL = 0.9; }
 else { tO = 0.04; tG = 0.01; tL = 0; }
 }

 // ── Flythrough highlighting ──
 // Path nodes stay visible, focused node glows brightly, everything else muted
 if (ftNodeSet) {
 if (ftNodeSet.has(node.id)) {
 const isFocused = node.id === this.flythrough.focusId;
 const isPrev = node.id === this.flythrough.prevFocusId;
 if (isFocused) {
 // Arrival bloom: burst of glow that decays
 const bloom = Math.max(0, this.flythrough.arrivalGlow);
 tG = 0.85 + bloom * 0.4;
 tO = 1; tL = 1;
 // Scale boost during arrival
 if (bloom > 0.1 && node.mesh) {
 const s = node.radius * (1 + bloom * 0.15);
 node.mesh.scale.setScalar(s);
 }
 } else if (isPrev) {
 tG = 0.4; tO = 0.85; tL = 0.6;
 } else {
 // Other path nodes: dim but present
 tG = 0.15; tO = 0.5; tL = 0.35;
 }
 } else {
 // Non-path nodes: deeply muted
 tO = 0.03; tG = 0.008; tL = 0;
 }
 }

 // Studied glow boost + Learning State Pulsation (Improvement #22)
 if (studiedNodes.has(node.id)) {
 const learnState = getNodeLearningState(node.id);
 if (learnState === 'review-due') {
 // Subtle amber pulsation for review-due nodes
 const pulse = 0.25 + 0.15 * Math.sin(this.time * 2.2 + node.pos.x * 0.5);
 tG = Math.max(tG, pulse);
 // Slightly modulate mesh emissive for visible pulse
 if (node.mat) node.mat.emissive.setHex(0xcc8833);
 } else if (learnState === 'connected') {
 // Slow, satisfied glow for recently studied
 const glow = 0.35 + 0.08 * Math.sin(this.time * 0.8 + node.pos.y * 0.3);
 tG = Math.max(tG, glow);
 if (node.mat) node.mat.emissive.set(node.color);
 } else {
 tG = Math.max(tG, 0.3);
 }
 }

 // Smooth lerp - skip for off-screen nodes that are already at target
 // (allows values to settle even when off-screen, but avoid work when stable)
 if (inFrustum || Math.abs(node.mat.opacity - tO) > 0.005) {
 node.mat.opacity += (tO - node.mat.opacity) * 0.15;
 }
 // ── Only lerp glow if sprites exist (skipped on low-end) ──
 if (node.sprite && (inFrustum || Math.abs(node.spriteMat.opacity - tG) > 0.005)) {
 node.spriteMat.opacity += (tG - node.spriteMat.opacity) * 0.15;
 }
 node.mat.emissiveIntensity += ((tG > 0.3 ? 0.8 : 0.45) - node.mat.emissiveIntensity) * 0.15;
 if (node.label) {
 if (inFrustum || Math.abs(node.label.material.opacity - tL) > 0.005) {
 node.label.material.opacity += (tL - node.label.material.opacity) * 0.15;
 }
 }
 }

 // ── Update edge colors (highlight-aware, change-gated) ──
 // During flythrough, update every frame for smooth edge animation
 const edgeUpdateNeeded = stateChanged || this.flythrough.active;
 if (this.edgeMesh && edgeUpdateNeeded) {
 const colors = this.edgeMesh.geometry.attributes.color;
 const edges = this.edges;
 const edgesLen = edges.length;
 const ftFocus = this.flythrough.active ? this.flythrough.focusId : null;
 const ftPrev = this.flythrough.active ? this.flythrough.prevFocusId : null;
 const ftTransAlpha = this.flythrough.active ? this.flythrough.transitionEdgeAlpha : 0;
 for (let ei = 0; ei < edgesLen; ei++) {
 const e = edges[ei];
 let alpha = e.type === 'parent' ? 0.15 : 0.06;
 if (highlightId3d) {
 if (e.from === highlightId3d || e.to === highlightId3d) {
 const a = this.nodeMap.get(e.from), b = this.nodeMap.get(e.to);
 if (a && b && a.mat.opacity > 0.05 && b.mat.opacity > 0.05) alpha = 0.4;
 else alpha = 0.005;
 } else alpha = 0.005;
 }
 if (pathIds) {
 alpha = (pathIds.has(e.from) && pathIds.has(e.to)) ? 0.3 : 0.003;
 }
 if (searchHighlightIds) {
 alpha = (searchHighlightIds.has(e.from) && searchHighlightIds.has(e.to)) ? 0.25 : 0.003;
 }
 // ── Flythrough edge highlighting ──
 if (ftNodeSet) {
 if (ftNodeSet.has(e.from) && ftNodeSet.has(e.to)) {
 // Edges within the path
 const isToFocus = (e.from === ftFocus || e.to === ftFocus);
 const isTransition = (
 (e.from === ftFocus && e.to === ftPrev) ||
 (e.to === ftFocus && e.from === ftPrev)
 );
 if (isTransition) {
 // Animated transition edge: pulses brightly during transition
 alpha = 0.15 + ftTransAlpha * 0.55;
 } else if (isToFocus) {
 alpha = 0.45;
 } else {
 alpha = 0.08;
 }
 } else {
 alpha = 0.003;
 }
 }
 if (this.filterCategory) {
 const aD = nodeIndex.get(e.from), bD = nodeIndex.get(e.to);
 if (!aD || !bD || aD.ct !== this.filterCategory || bD.ct !== this.filterCategory) alpha = 0.003;
 }
 const idx6 = ei * 6;
 colors.array[idx6] = colors.array[idx6+1] = colors.array[idx6+2] = alpha;
 colors.array[idx6+3] = colors.array[idx6+4] = colors.array[idx6+5] = alpha;
 }
 colors.needsUpdate = true;
 }

 // ── Improvement #21: Update arrow cone visibility ──
 if (this.arrowMeshes.length > 0 && edgeUpdateNeeded) {
 for (let ai = 0; ai < this.arrowMeshes.length; ai++) {
 const arrow = this.arrowMeshes[ai];
 let targetAlpha = 0.0;
 if (highlightId3d) {
 if (arrow.fromId === highlightId3d || arrow.toId === highlightId3d) {
 targetAlpha = 0.7;
 }
 }
 if (pathIds && pathIds.has(arrow.fromId) && pathIds.has(arrow.toId)) {
 targetAlpha = 0.5;
 }
 // Flythrough: show arrows for edges to focused node
 if (ftNodeSet) {
 if (ftNodeSet.has(arrow.fromId) && ftNodeSet.has(arrow.toId)) {
 const isToFocus = (arrow.fromId === ftFocusId || arrow.toId === ftFocusId);
 targetAlpha = isToFocus ? 0.65 : 0.15;
 } else {
 targetAlpha = 0;
 }
 }
 arrow.mat.opacity += (targetAlpha - arrow.mat.opacity) * 0.15;
 }
 }

 // ── Improvement #23: Flythrough camera animation with cosmos correspondence ──
 if (this.flythrough.active && !this.flythrough.paused) {
 const ft = this.flythrough;
 ft.progress += dt;
 const totalPhaseTime = ft.dwellTime + ft.transitionTime;

 // Decay arrival glow
 if (ft.arrivalGlow > 0) ft.arrivalGlow -= dt * 1.5;

 if (ft.progress >= totalPhaseTime) {
 ft.progress = 0;
 ft.prevFocusId = ft.focusId;
 ft.currentIdx++;
 if (ft.currentIdx >= ft.pathIds.length) {
 this.stopFlythrough();
 } else {
 ft.focusId = ft.pathIds[ft.currentIdx];
 ft.arrivalGlow = 1.0; // Bloom burst on arrival
 ft.transitionEdgeAlpha = 0;
 // Invalidate adjacency cache for new focus
 this._hoverConnsCache = null;
 this._hoverConnsCacheId = null;
 updateFlythroughUI(ft.focusId, ft.currentIdx, ft.pathIds.length, ft.pathName);
 }
 }
 if (ft.active) {
 const currentNode = this.nodeMap.get(ft.focusId);
 if (currentNode) {
 if (ft.progress < ft.dwellTime) {
 // Dwell phase: slowly orbit around current node with gentle movement
 const orbitSpeed = 0.12;
 this.targetSpherical.theta += orbitSpeed * dt;
 this.targetOrbitTarget.lerp(currentNode.pos, 0.04);
 this.targetSpherical.radius += (28 - this.targetSpherical.radius) * 0.02;
 ft.transitionEdgeAlpha *= 0.95; // Decay transition edge
 } else {
 // Transition phase: move toward next node with animated connecting edge
 const nextIdx = Math.min(ft.currentIdx + 1, ft.pathIds.length - 1);
 const nextNode = this.nodeMap.get(ft.pathIds[nextIdx]);
 if (nextNode) {
 const t = (ft.progress - ft.dwellTime) / ft.transitionTime;
 const easedT = t * t * (3 - 2 * t); // smoothstep
 // Animate transition edge alpha
 ft.transitionEdgeAlpha = Math.sin(t * Math.PI); // peaks at 0.5, zero at 0 and 1
 // Camera tracks between nodes (pooled vector)
 if (!this._lerpVec) this._lerpVec = new THREE.Vector3();
 this._lerpVec.copy(currentNode.pos).lerp(nextNode.pos, easedT);
 this.targetOrbitTarget.lerp(this._lerpVec, 0.06);
 // Pull back slightly during transition for wider view
 this.targetSpherical.radius += (36 - this.targetSpherical.radius) * 0.025;
 }
 }
 }
 // Restore scale on non-focused nodes (only check nodes that might have been scaled)
 if (ft.prevFocusId) {
 const prevNode = this.nodeMap.get(ft.prevFocusId);
 if (prevNode && prevNode.mesh) {
 const tgtS = prevNode.radius;
 const cur = prevNode.mesh.scale.x;
 if (Math.abs(cur - tgtS) > 0.005) {
 prevNode.mesh.scale.setScalar(cur + (tgtS - cur) * 0.12);
 }
 }
 }
 }
 // Keep animation alive during flythrough
 this._dirtyFrames = Math.max(this._dirtyFrames, 5);
 } else if (this.flythrough.active && this.flythrough.paused) {
 // Even when paused, keep flythrough state influencing visuals
 this._dirtyFrames = Math.max(this._dirtyFrames, 2);
 }

 // Render scene
 this.renderer.render(this.scene, this.camera);
 // ── Schedule next frame only if not paused ──
 if (!this._paused && !document.hidden) {
 this.animFrame = requestAnimationFrame(() => this.animate());
 }
 },

 // ── Improvement #23: Flythrough Methods ──
 startFlythrough(pathIds, pathName, pathColor) {
 if (!pathIds || pathIds.length < 2) return;
 // Filter to only nodes that exist in the 3D scene
 const validIds = pathIds.filter(id => this.nodeMap.has(id));
 if (validIds.length < 2) return;
 const nodeSet = new Set(validIds);
 this.flythrough = {
 active: true, paused: false,
 pathIds: validIds, currentIdx: 0, progress: 0,
 dwellTime: 5.5, transitionTime: 2.5,
 pathName: pathName || '', pathColor: pathColor || '#e0c050',
 nodeSet: nodeSet,
 focusId: validIds[0],
 prevFocusId: null,
 transitionEdgeAlpha: 0,
 arrivalGlow: 1.0,
 };
 // Clear other highlights
 this.selectedNodeId = null;
 this.hoveredNodeId = null;
 this.filterCategory = null;
 this._hoverConnsCache = null;
 this._hoverConnsCacheId = null;
 // Start at first node
 const firstNode = this.nodeMap.get(validIds[0]);
 if (firstNode) {
 this.targetOrbitTarget.copy(firstNode.pos);
 this.targetSpherical.radius = 28;
 }
 this.markDirty();
 // UI
 const overlay = document.getElementById('flythrough-overlay');
 if (overlay) overlay.classList.add('active');
 // Hide legend and bottombar to avoid obstructing flythrough view
 const legend = document.getElementById('legend');
 if (legend) legend.style.display = 'none';
 const bottombar = document.getElementById('bottombar');
 if (bottombar) bottombar.style.display = 'none';
 updateFlythroughUI(validIds[0], 0, validIds.length, pathName);
 },

 stopFlythrough() {
 // Restore any scaled nodes back to normal
 if (this.flythrough.active) {
 for (let i = 0; i < this.nodes.length; i++) {
 const n = this.nodes[i];
 if (n.mesh) n.mesh.scale.setScalar(n.radius);
 }
 }
 this.flythrough.active = false;
 this.flythrough.paused = false;
 this.flythrough.focusId = null;
 this.flythrough.prevFocusId = null;
 this.flythrough.nodeSet = null;
 this._hoverConnsCache = null;
 this._hoverConnsCacheId = null;
 const overlay = document.getElementById('flythrough-overlay');
 if (overlay) overlay.classList.remove('active');
 // Restore legend and bottombar
 const legend = document.getElementById('legend');
 if (legend) legend.style.display = '';
 const bottombar = document.getElementById('bottombar');
 if (bottombar) bottombar.style.display = '';
 const text = document.getElementById('flythrough-text');
 if (text) text.classList.remove('visible');
 this.markDirty();
 },

 toggleFlythroughPause() {
 this.flythrough.paused = !this.flythrough.paused;
 const btn = document.getElementById('flythrough-pause');
 if (btn) btn.textContent = this.flythrough.paused ? 'Resume' : 'Pause';
 this.markDirty();
 },




 destroy() {
 if (this.animFrame) cancelAnimationFrame(this.animFrame);
 if (this._boundVisibility) document.removeEventListener('visibilitychange', this._boundVisibility);
 if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
 if (this.renderer) {
 this.renderer.dispose();
 if (this.renderer.domElement && this.renderer.domElement.parentNode) {
 this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
 }
 }
 this.nodes = []; this.edges = []; this.nodeMap.clear(); this.meshToId.clear();
 this.arrowMeshes = [];
 if (this.arrowGroup) { this.scene.remove(this.arrowGroup); this.arrowGroup = null; }
 this.flythrough = { active: false, paused: false, pathIds: [], currentIdx: 0, progress: 0, dwellTime: 5.5, transitionTime: 2.5, pathName: '', pathColor: '#e0c050', nodeSet: null, focusId: null, prevFocusId: null, transitionEdgeAlpha: 0, arrivalGlow: 0 };
 this.octree = new Octree();
 this.adjacency = new EdgeAdjacency();
 this._hoverConnsCache = null;
 this._hoverConnsCacheId = null;
 this._activePointerId = null;
 this._lastPointer = null;
 }
};

// ═══════════════════════════════════════════
// §7b - ENGINE BRIDGE (Error Boundary)
// All UI code accesses ThreeEngine exclusively through
// ActiveEngine. Every call is guarded with try-catch and
// an `threeInitialized` gate so that:
// 1. If Three.js never loaded, calls are harmless no-ops.
// 2. If ThreeEngine throws at runtime (WebGL context lost,
// shader compilation failure, OOM), the error is caught,
// a degradation banner is shown, and the rest of the app
// (search, panels, study paths, keyboard nav) continues.
// 3. A single `_runtimeFailed` latch prevents repeated
// banner spam after the first crash.
// ═══════════════════════════════════════════
let threeInitialized = false;

const ActiveEngine = {
 _runtimeFailed: false,

 /** Safely execute a ThreeEngine method. Returns undefined on failure. */
 _guard(label, fn) {
 if (!threeInitialized || this._runtimeFailed) return;
 try {
 return fn();
 } catch (err) {
 console.error(`[ActiveEngine] ${label} failed:`, err);
 this._handleRuntimeFailure(err);
 }
 },

 _handleRuntimeFailure(err) {
 if (this._runtimeFailed) return; // already degraded
 this._runtimeFailed = true;
 threeInitialized = false;
 // Attempt cleanup - but don't let cleanup itself throw
 try { ThreeEngine.destroy(); } catch (e) { /* swallow */ }
 showDegradationBanner(
 '3D rendering encountered an error and has been disabled. ' +
 'Search, study panels, and paths remain fully functional.'
 );
 },

 focusNode(id, zoom) {
 this._guard('focusNode', () => ThreeEngine.focusNode(id, zoom));
 },
 filterByCategory(cat) {
 this._guard('filterByCategory', () => ThreeEngine.filterByCategory(cat));
 },
 setSelectedNode(id) {
 this._guard('setSelectedNode', () => { ThreeEngine.selectedNodeId = id; ThreeEngine._autoRotate = false; });
 },
 clearSelectedNode() {
 this._guard('clearSelectedNode', () => { ThreeEngine.selectedNodeId = null; });
 },
 markDirty() {
 this._guard('markDirty', () => ThreeEngine.markDirty());
 },
 resize() {
 this._guard('resize', () => ThreeEngine.resize());
 }
};

