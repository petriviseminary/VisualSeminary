// ═══════════════════════════════════════════
// §9 - INITIALIZATION (Milestone-based)
// ═══════════════════════════════════════════

// ── Deterministic progress tracker ──
const InitProgress = {
 milestones: {
 fonts: { weight: 10, done: false, label: 'Loading typefaces' },
 threejs: { weight: 10, done: false, label: 'Loading 3D engine' },
 data: { weight: 25, done: false, label: 'Indexing doctrine data' },
 ui: { weight: 20, done: false, label: 'Building interface' },
 engine: { weight: 25, done: false, label: 'Initializing renderer' },
 render: { weight: 10, done: false, label: 'First render' },
 },
 _fill: null,
 _step: null,
 _bar: null,

 init() {
 this._fill = document.getElementById('loading-fill');
 this._step = document.getElementById('loading-step');
 this._bar = document.querySelector('.loading-bar');
 },

 complete(key) {
 if (!this.milestones[key] || this.milestones[key].done) return;
 this.milestones[key].done = true;
 this._update();
 },

 _update() {
 let pct = 0;
 let lastPendingLabel = null;
 for (const [, m] of Object.entries(this.milestones)) {
 if (m.done) pct += m.weight;
 else if (!lastPendingLabel) lastPendingLabel = m.label;
 }
 pct = Math.min(pct, 100);
 if (this._fill) {
 this._fill.style.width = pct + '%';
 }
 if (this._bar) {
 this._bar.setAttribute('aria-valuenow', String(pct));
 }
 if (this._step) {
 this._step.textContent = pct >= 100 ? 'Ready' : (lastPendingLabel || 'Finishing up') + '\u2026';
 }
 if (pct >= 100) this._dismiss();
 },

 _dismiss() {
 setTimeout(() => {
 const ls = document.getElementById('loading-screen');
 ls.classList.add('hidden');
 // Remove from DOM after transition to stop infinite CSS animations
 setTimeout(() => ls.remove(), 900);
 document.getElementById('onboarding-screen').classList.remove('hidden');
 }, 350);
 }
};

// Helper: yield to browser so the progress bar can repaint between sync steps
function yieldThen(fn) {
 return new Promise(resolve => {
 requestAnimationFrame(() => { fn(); resolve(); });
 });
}

async function initialize() {
 try {
 await _initializeInner();
 } catch (err) {
 console.error('[Init] Fatal initialization error:', err);
 // Force-dismiss the loading screen so the user isn't stuck staring at it
 const ls = document.getElementById('loading-screen');
 if (ls) ls.classList.add('hidden');
 showDegradationBanner(
 'The application encountered an error during startup. ' +
 'Some features may be unavailable. Please refresh to try again.'
 );
 }
}

async function _initializeInner() {
 InitProgress.init();

 // ── Resolve async asset milestones that may already be settled ──
 // Fonts
 if (window.__fontsLoaded === true) {
 InitProgress.complete('fonts');
 } else if (window.__fontsLoaded === false) {
 InitProgress.complete('fonts'); // failed but resolved - we have fallbacks
 } else {
 // Still pending - listen for resolution
 const fontDone = () => InitProgress.complete('fonts');
 document.addEventListener('fonts-load-failed', fontDone, { once: true });
 if (document.fonts && document.fonts.ready) {
 document.fonts.ready.then(() => {
 document.fonts.load('400 16px "Cinzel"').then(fontDone).catch(fontDone);
 });
 }
 // Safety timeout - don't block forever
 setTimeout(fontDone, 6000);
 }

 // Three.js
 if (window.__threeAvailable === true || window.__threeAvailable === false) {
 InitProgress.complete('threejs');
 } else {
 const threeDone = () => InitProgress.complete('threejs');
 document.addEventListener('three-load-success', threeDone, { once: true });
 document.addEventListener('three-load-failed', threeDone, { once: true });
 setTimeout(threeDone, 6000);
 }

 // ── Synchronous steps with yields for repaint ──
 await yieldThen(() => {
 buildDataIndex();
 buildRelatedTopicsIndex();
 loadProgress();
 updateProgressBadge();
 InitProgress.complete('data');
 });

 await yieldThen(() => {
 buildLegend();
 buildPathsPopup();
 wireUI();
 InitProgress.complete('ui');
 });

 // ── Render engine (3D only) ──
 await yieldThen(() => {
 if (window.__threeAvailable) {
 try {
 ThreeEngine.init();
 threeInitialized = true;
 } catch (e) {
 console.error('[Init] Three.js init failed:', e);
 window.__threeAvailable = false;
 showDegradationBanner('3D rendering failed to initialize. Please refresh or try a different browser.');
 }
 } else {
 console.error('[Init] Three.js not available. 3D cosmos cannot render.');
 showDegradationBanner('3D engine could not be loaded. Please check your connection and refresh.');
 }
 InitProgress.complete('engine');
 });

 // ── First render - wait for an actual frame to paint ──
 requestAnimationFrame(() => {
 requestAnimationFrame(() => {
 InitProgress.complete('render');
 });
 });

 // Handle deep link
 setTimeout(handleDeepLink, 800);
}

// ── Degradation Banner Helper ──
function showDegradationBanner(message) {
 const banner = document.getElementById('degradation-banner');
 if (banner) {
 document.getElementById('banner-message').textContent = message;
 banner.classList.add('visible');
 }
}

// ── Listen for asset load failures and show appropriate messages ──
document.addEventListener('three-load-failed', function() {
 console.error('[Three.js] All CDN sources failed. 3D cosmos will not be available.');
 showDegradationBanner('3D engine could not be loaded. Please check your connection and refresh.');
});

document.addEventListener('fonts-load-failed', function() {
 // Silent degradation: CSS already specifies Georgia as fallback in all font stacks.
 // No user-facing banner needed - the fallback is visually seamless.
 console.log('[Fonts] Using system fallback fonts (Georgia, serif).');
});

// ── Global error handler - catch unhandled errors that could freeze the app ──
window.addEventListener('error', function(event) {
 // Only intervene for WebGL / Three.js errors (not general JS bugs)
 const msg = (event.message || '').toLowerCase();
 const isGLError = msg.includes('webgl') || msg.includes('three') ||
 msg.includes('gl_') || msg.includes('shader') ||
 msg.includes('context');
 if (isGLError && threeInitialized && !ActiveEngine._runtimeFailed) {
 console.error('[Global] Caught WebGL/Three.js error:', event.message);
 ActiveEngine._handleRuntimeFailure(new Error(event.message));
 }
});

// ── WebGL Context Lost / Restored ──
// If the GPU reclaims the WebGL context (e.g. system sleep, driver crash),
// Three.js will throw on the next draw call. We catch it proactively.
document.addEventListener('DOMContentLoaded', function() {
 // Deferred: canvas won't exist until ThreeEngine.init()
 const observer = new MutationObserver(function(mutations) {
 const canvas = document.querySelector('#three-container canvas');
 if (canvas) {
 observer.disconnect();
 canvas.addEventListener('webglcontextlost', function(e) {
 e.preventDefault();
 console.error('[WebGL] Context lost');
 if (!ActiveEngine._runtimeFailed) {
 ActiveEngine._handleRuntimeFailure(new Error('WebGL context lost'));
 }
 });
 canvas.addEventListener('webglcontextrestored', function() {
 console.log('[WebGL] Context restored - reload may be needed for full recovery');
 });
 }
 });
 const container = document.getElementById('three-container');
 if (container) observer.observe(container, { childList: true });
});

// ── Boot: wait for Three.js loader to resolve, or start after a timeout ──
(function boot() {
 // If Three.js is already confirmed available or failed, start immediately
 if (window.__threeAvailable === true || window.__threeAvailable === false) {
 initialize();
 return;
 }
 // Wait briefly for async script loader, then start regardless
 var bootTimeout = setTimeout(function() {
 document.removeEventListener('three-load-success', onReady);
 document.removeEventListener('three-load-failed', onReady);
 initialize();
 }, 3000);

 function onReady() {
 clearTimeout(bootTimeout);
 document.removeEventListener('three-load-success', onReady);
 document.removeEventListener('three-load-failed', onReady);
 initialize();
 }
 document.addEventListener('three-load-success', onReady);
 document.addEventListener('three-load-failed', onReady);
})();
