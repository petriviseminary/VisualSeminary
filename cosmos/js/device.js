// ═══════════════════════════════════════════════════════════
// SYSTEMATIC THEOLOGY 4.0 - THEOLOGICAL COSMOS ENGINE
// Clean architecture. Descriptive names. Modular design.
// ═══════════════════════════════════════════════════════════
"use strict";

// ═══════════════════════════════════════════
// §0a - DEVICE CAPABILITY DETECTION
// Detects hardware capabilities and sets quality
// presets for adaptive rendering across devices.
// ═══════════════════════════════════════════
const DeviceCapabilities = {
 isMobile: false,
 isTablet: false,
 isLowEnd: false,
 hasTouch: false,
 pixelRatio: 1,
 gpuTier: 'high', // 'high' | 'mid' | 'low'
 maxTextureSize: 4096,
 prefersReducedMotion: false,

 detect() {
 const ua = navigator.userAgent || '';
 const w = window.innerWidth;
 this.hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
 this.isMobile = this.hasTouch && w <= 768;
 this.isTablet = this.hasTouch && w > 768 && w <= 1200;
 this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.isMobile ? 2 : 2.5);
 this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

 // Hardware concurrency check (cores)
 const cores = navigator.hardwareConcurrency || 2;
 // Device memory check (GB, Chrome only)
 const memory = navigator.deviceMemory || 4;

 // GPU tier estimation
 if (this.isMobile && (cores <= 4 || memory <= 2)) {
 this.gpuTier = 'low';
 this.isLowEnd = true;
 } else if (this.isMobile || this.isTablet || cores <= 4) {
 this.gpuTier = 'mid';
 } else {
 this.gpuTier = 'high';
 }

 // WebGL capability probe
 try {
 const c = document.createElement('canvas');
 const gl = c.getContext('webgl2') || c.getContext('webgl');
 if (gl) {
 this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
 const dbg = gl.getExtension('WEBGL_debug_renderer_info');
 if (dbg) {
 const renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL).toLowerCase();
 // Detect known low-end GPUs
 if (renderer.includes('mali-4') || renderer.includes('adreno 3') ||
 renderer.includes('sgx') || renderer.includes('swiftshader')) {
 this.gpuTier = 'low';
 this.isLowEnd = true;
 } else if (renderer.includes('mali-g5') || renderer.includes('adreno 5') ||
 renderer.includes('apple gpu') || renderer.includes('intel')) {
 this.gpuTier = this.gpuTier === 'high' ? 'mid' : this.gpuTier;
 }
 }
 // Clean up context
 const ext = gl.getExtension('WEBGL_lose_context');
 if (ext) ext.loseContext();
 }
 } catch(e) { /* ignore probe failures */ }

 console.log(`[Device] tier=${this.gpuTier} mobile=${this.isMobile} tablet=${this.isTablet} dpr=${this.pixelRatio} cores=${cores} mem=${memory}GB`);
 return this;
 },

 // Adaptive quality presets consumed by the render engine
 get quality() {
 switch (this.gpuTier) {
 case 'low': return {
 pixelRatio: Math.min(this.pixelRatio, 1.5),
 sphereSegments: [12, 8], // [width, height] for locus spheres
 subSphereSegments: [6, 4],
 labelCanvasWidth: 256,
 settleFrames: 45, // half the desktop value
 hoverThrottle: 3, // raycast every 3rd frame
 enableGlow: false,
 enableConfetti: false,
 maxLabelSprites: 8,
 };
 case 'mid': return {
 pixelRatio: Math.min(this.pixelRatio, 2),
 sphereSegments: [18, 12],
 subSphereSegments: [8, 6],
 labelCanvasWidth: 384,
 settleFrames: 30,
 hoverThrottle: 2,
 enableGlow: true,
 enableConfetti: true,
 maxLabelSprites: 20,
 };
 default: return {
 pixelRatio: Math.min(this.pixelRatio, 2.5),
 sphereSegments: [18, 12],
 subSphereSegments: [10, 6],
 labelCanvasWidth: 512,
 settleFrames: 40,
 hoverThrottle: 2,
 enableGlow: true,
 enableConfetti: true,
 maxLabelSprites: 999,
 };
 }
 }
}.detect();

// ═══════════════════════════════════════════
// §0b - PERFORMANCE UTILITIES
// Reusable performance primitives
// ═══════════════════════════════════════════

// Pooled Levenshtein - reuses a single flat array instead of allocating per call
const _levBuf = new Uint16Array(256 * 256);
function levenshteinPooled(a, b) {
 const m = a.length, n = b.length;
 if (m === 0) return n;
 if (n === 0) return m;
 const stride = n + 1;
 for (let j = 0; j <= n; j++) _levBuf[j] = j;
 for (let i = 1; i <= m; i++) {
 _levBuf[i * stride] = i;
 for (let j = 1; j <= n; j++) {
 _levBuf[i * stride + j] = a[i-1] === b[j-1]
 ? _levBuf[(i-1) * stride + (j-1)]
 : 1 + Math.min(
 _levBuf[(i-1) * stride + j],
 _levBuf[i * stride + (j-1)],
 _levBuf[(i-1) * stride + (j-1)]
 );
 }
 }
 return _levBuf[m * stride + n];
}

// Debounced requestAnimationFrame (coalesces rapid calls)
function rafDebounce(fn) {
 let id = null;
 return function(...args) {
 if (id !== null) cancelAnimationFrame(id);
 id = requestAnimationFrame(() => { id = null; fn.apply(this, args); });
 };
}

// ═══════════════════════════════════════════
// §0 - ACCESSIBILITY UTILITIES
// ═══════════════════════════════════════════
const A11y = {
 // Track what element had focus before panel opened
 panelTrigger: null,
 // Track active search result index (-1 = none)
 searchActiveIndex: -1,

 // Announce a message to screen readers via aria-live region
 announce(message) {
 const el = document.getElementById('search-live');
 if (el) { el.textContent = ''; requestAnimationFrame(() => { el.textContent = message; }); }
 },

 // Get all focusable elements within a container
 getFocusable(container) {
 return [...container.querySelectorAll(
 'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), ' +
 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), ' +
 '[role="tab"][tabindex="0"], [role="option"], [role="listitem"][tabindex="0"]'
 )].filter(el => el.offsetParent !== null);
 },

 // Trap focus within panel when open
 trapFocusHandler: null,
 enableFocusTrap(container) {
 // Safety: remove any existing trap before adding new one
 this.disableFocusTrap();
 this.trapFocusHandler = (e) => {
 if (e.key !== 'Tab') return;
 const focusable = this.getFocusable(container);
 if (focusable.length === 0) return;
 const first = focusable[0];
 const last = focusable[focusable.length - 1];
 if (e.shiftKey) {
 if (document.activeElement === first || !container.contains(document.activeElement)) {
 e.preventDefault(); last.focus();
 }
 } else {
 if (document.activeElement === last || !container.contains(document.activeElement)) {
 e.preventDefault(); first.focus();
 }
 }
 };
 document.addEventListener('keydown', this.trapFocusHandler);
 },

 disableFocusTrap() {
 if (this.trapFocusHandler) {
 document.removeEventListener('keydown', this.trapFocusHandler);
 this.trapFocusHandler = null;
 }
 },

 // Reset search active descendant state
 resetSearchIndex() {
 this.searchActiveIndex = -1;
 const input = document.getElementById('search-input');
 if (input) input.setAttribute('aria-activedescendant', '');
 document.querySelectorAll('#search-results [role="option"]').forEach(el => {
 el.setAttribute('aria-selected', 'false');
 });
 }
};

