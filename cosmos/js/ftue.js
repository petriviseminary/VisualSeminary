// ═══════════════════════════════════════════
// FIRST-TIME USER EXPERIENCE (FTUE)
// Apple HIG-inspired coach marks.
// Fully blocking overlay : no cosmos interaction during tour.
// Spotlight is visual-only via CSS radial-gradient.
// ═══════════════════════════════════════════
window.FTUETour = {
 _active: false,
 _step: 0,
 _els: {},
 _handlers: {},
 // v2 key : avoids collision with v1 that may be cached in user's localStorage
 STORAGE_KEY: 'stc_ftue_v2_done',

 // ── SVG Icons (hand-tuned, not emoji) ──
 icons: {
 orbit: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2a10 10 0 0 1 0 20"/><path d="M12 2a10 10 0 0 0 0 20"/><path d="M2 12h20"/></svg>',
 click: '<svg viewBox="0 0 24 24"><path d="M15 15l-2 5L9 9l11 4-5 2z"/><path d="M5 3L3 5m4-2L5 5m4-2L7 5"/></svg>',
 search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>',
 path: '<svg viewBox="0 0 24 24"><circle cx="5" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M5 8v2a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4V8"/></svg>',
 progress: '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
 },

 steps: [
 {
 icon: 'orbit',
 title: 'Orbit the Cosmos',
 desc: 'Drag to rotate your view. Scroll to zoom in and out.',
 target: function() { return document.getElementById('three-container'); },
 spotSize: { w: 320, h: 280 },
 position: 'center-above',
 },
 {
 icon: 'click',
 title: 'Select a Doctrine',
 desc: 'Each point of light is a doctrine. Click any node to open its study panel.',
 target: function() { return document.getElementById('three-container'); },
 spotSize: { w: 180, h: 180 },
 position: 'center-above',
 },
 {
 icon: 'search',
 title: 'Search Anything',
 desc: function() {
 var isMac = navigator.platform.indexOf('Mac') > -1;
 return 'Find any doctrine, scripture, or keyword. Press ' +
 (isMac ? '<kbd class="ftue-kbd">\u2318K</kbd>' : '<kbd class="ftue-kbd">Ctrl K</kbd>') +
 ' to jump here anytime.';
 },
 target: function() { return document.getElementById('search-input'); },
 spotSize: { w: 400, h: 52 },
 position: 'below-target',
 },
 {
 icon: 'path',
 title: 'Follow Study Paths',
 desc: 'Guided sequences walk you through theology step by step, from foundations to advanced topics.',
 target: function() { return document.getElementById('btn-paths'); },
 spotSize: { w: 120, h: 48 },
 position: 'above-target',
 },
 {
 icon: 'progress',
 title: 'Track Your Journey',
 desc: 'Mark doctrines as reviewed and track which entries you\u2019ve visited. Everything saves automatically.',
 target: function() { return document.getElementById('progress-badge'); },
 spotSize: { w: 80, h: 40 },
 position: 'below-target',
 },
 ],

 shouldShow: function() {
 try { return !localStorage.getItem(this.STORAGE_KEY); } catch(e) { return true; }
 },

 markComplete: function() {
 try { localStorage.setItem(this.STORAGE_KEY, '1'); } catch(e) {}
 },

 /** Public: restart the tour (e.g. from console or a UI button) */
 restart: function() {
 try { localStorage.removeItem(this.STORAGE_KEY); } catch(e) {}
 this.start(true);
 },

 /**
 * @param {boolean} force - If true, ignore localStorage and always show
 */
 start: function(force) {
 console.log('[FTUE] start() called. force=' + !!force + ', shouldShow=' + this.shouldShow());
 if (!force && !this.shouldShow()) {
 console.log('[FTUE] Tour already completed : skipping. Call FTUETour.restart() to replay.');
 return;
 }

 var e = this._els;
 e.overlay = document.getElementById('ftue-overlay');
 e.card = document.getElementById('ftue-card');
 e.ring = document.getElementById('ftue-ring');
 e.icon = document.getElementById('ftue-icon');
 e.counter = document.getElementById('ftue-counter');
 e.title = document.getElementById('ftue-title');
 e.desc = document.getElementById('ftue-desc');
 e.progress = document.getElementById('ftue-progress-fill');
 e.next = document.getElementById('ftue-next');
 e.skip = document.getElementById('ftue-skip');

 if (!e.overlay || !e.card) {
 console.error('[FTUE] DOM elements not found : aborting.', {
 overlay: !!e.overlay, card: !!e.card, ring: !!e.ring
 });
 return;
 }
 console.log('[FTUE] All DOM elements found. Starting tour.');

 this._step = 0;
 this._active = true;
 e.overlay.setAttribute('aria-hidden', 'false');

 // Wire
 var self = this;
 e.next.onclick = function(ev) { ev.stopPropagation(); self.next(); };
 e.skip.onclick = function(ev) { ev.stopPropagation(); self.dismiss(); };
 e.overlay.onclick = function() { self.next(); };

 // Resize
 this._handlers.resize = function() { if (self._active) self._position(); };
 window.addEventListener('resize', this._handlers.resize);

 // Keyboard (capture phase : intercepts before cosmos)
 this._handlers.key = function(ev) {
 if (!self._active) return;
 if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); self.dismiss(); }
 else if (ev.key === 'ArrowRight' || ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); self.next(); }
 else if (ev.key === 'ArrowLeft' && self._step > 0) { ev.preventDefault(); ev.stopPropagation(); self._step--; self._renderStep(); }
 };
 document.addEventListener('keydown', this._handlers.key, true);

 // Block scroll/wheel/touch on the overlay so cosmos doesn't zoom
 this._handlers.wheel = function(ev) { if (self._active) { ev.preventDefault(); ev.stopPropagation(); } };
 this._handlers.touchmove = function(ev) { if (self._active) { ev.preventDefault(); } };
 e.overlay.addEventListener('wheel', this._handlers.wheel, { passive: false, capture: true });
 e.overlay.addEventListener('touchmove', this._handlers.touchmove, { passive: false });

 // Also block pointer events from reaching the canvas underneath
 this._handlers.pointerdown = function(ev) { if (self._active) { ev.stopPropagation(); } };
 e.overlay.addEventListener('pointerdown', this._handlers.pointerdown, true);

 // Activate
 requestAnimationFrame(function() {
 e.overlay.classList.add('active');
 console.log('[FTUE] Overlay activated. Rendering step 0 in 200ms...');
 setTimeout(function() { self._renderStep(); }, 200);
 });
 },

 next: function() {
 if (this._step < this.steps.length - 1) {
 this._step++;
 console.log('[FTUE] Advancing to step ' + this._step);
 this._renderStep();
 } else {
 console.log('[FTUE] Tour complete.');
 this.dismiss();
 }
 },

 dismiss: function() {
 if (!this._active) return;
 this._active = false;
 this.markComplete();

 var e = this._els;
 e.card.classList.remove('visible');
 e.card.classList.add('leaving');
 e.ring.classList.remove('visible');
 e.overlay.classList.add('exiting');

 setTimeout(function() {
 e.overlay.classList.remove('active', 'exiting');
 e.overlay.setAttribute('aria-hidden', 'true');
 e.card.classList.remove('leaving');
 e.ring.style.display = 'none';
 }, 800);

 // Cleanup listeners
 window.removeEventListener('resize', this._handlers.resize);
 document.removeEventListener('keydown', this._handlers.key, true);
 if (e.overlay) {
 e.overlay.removeEventListener('wheel', this._handlers.wheel, { capture: true });
 e.overlay.removeEventListener('touchmove', this._handlers.touchmove);
 e.overlay.removeEventListener('pointerdown', this._handlers.pointerdown, true);
 }
 console.log('[FTUE] Dismissed and cleaned up.');
 },

 _renderStep: function() {
 var step = this.steps[this._step];
 var e = this._els;
 var target = step.target();
 if (!target) {
 console.warn('[FTUE] Target not found for step ' + this._step + ', skipping.');
 this.next();
 return;
 }

 // ── Content ──
 e.icon.innerHTML = this.icons[step.icon] || '';
 e.counter.innerHTML = '<span class="ftue-counter-current">' + (this._step + 1) + '</span> / ' + this.steps.length;
 e.title.textContent = step.title;
 e.desc.innerHTML = typeof step.desc === 'function' ? step.desc() : step.desc;

 // Progress bar
 var pct = ((this._step + 1) / this.steps.length) * 100;
 e.progress.style.width = pct + '%';

 // Button label
 e.next.textContent = this._step === this.steps.length - 1 ? 'Begin' : 'Next';

 // ── Animate card: leave → reposition → enter ──
 e.card.classList.remove('visible');
 e.card.classList.add('leaving');

 var self = this;
 setTimeout(function() {
 e.card.classList.remove('leaving');
 self._position();
 requestAnimationFrame(function() {
 requestAnimationFrame(function() {
 e.card.classList.add('visible');
 console.log('[FTUE] Step ' + self._step + ' rendered: "' + step.title + '"');
 // Focus next button for keyboard users
 e.next.focus({ preventScroll: true });
 });
 });
 }, this._step === 0 ? 50 : 260);
 },

 _position: function() {
 var step = this.steps[this._step];
 var e = this._els;
 var target = step.target();
 if (!target) return;

 var rect = target.getBoundingClientRect();
 var cx = rect.left + rect.width / 2;
 var cy = rect.top + rect.height / 2;
 var vw = window.innerWidth;
 var vh = window.innerHeight;
 var spotW = Math.min(step.spotSize.w, vw - 40);
 var spotH = step.spotSize.h;

 // ── Spotlight gradient (visual only : overlay stays fully blocking) ──
 var gradW = spotW * 0.8;
 var gradH = spotH * 0.8;
 e.overlay.style.background =
 'radial-gradient(ellipse ' + gradW + 'px ' + gradH + 'px at ' + cx + 'px ' + cy + 'px, ' +
 'rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.50) 45%, rgba(0,0,0,0.78) 100%)';

 // ── Ring ──
 e.ring.style.display = '';
 e.ring.style.width = spotW + 'px';
 e.ring.style.height = spotH + 'px';
 e.ring.style.left = (cx - spotW / 2) + 'px';
 e.ring.style.top = (cy - spotH / 2) + 'px';
 e.ring.style.borderRadius = (Math.min(spotW, spotH) * 0.45) + 'px';
 requestAnimationFrame(function() { e.ring.classList.add('visible'); });

 // ── Card positioning ──
 var card = e.card;
 var CARD_W = 300;
 var GAP = 16;
 var isMobile = vw <= 768;

 card.style.top = ''; card.style.bottom = '';
 card.style.left = ''; card.style.right = '';

 if (isMobile) {
 card.style.left = '16px';
 card.style.right = '16px';
 card.style.width = 'auto';
 } else {
 card.style.width = CARD_W + 'px';
 }

 // Horizontal center (desktop)
 var cardLeft = isMobile ? 16 : Math.max(16, Math.min(cx - CARD_W / 2, vw - CARD_W - 16));

 switch (step.position) {
 case 'center-above':
 card.style.bottom = (vh - cy + spotH / 2 + GAP) + 'px';
 if (!isMobile) card.style.left = cardLeft + 'px';
 break;
 case 'below-target':
 card.style.top = (rect.bottom + GAP) + 'px';
 if (!isMobile) card.style.left = cardLeft + 'px';
 break;
 case 'above-target':
 card.style.bottom = (vh - rect.top + GAP) + 'px';
 if (!isMobile) card.style.left = cardLeft + 'px';
 break;
 }
 },
};
