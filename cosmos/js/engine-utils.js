// ═══════════════════════════════════════════
// §3c - STUDY TIMESTAMPS (Improvement #22)
// Tracks WHEN nodes were reviewed for pulsation states.
// ═══════════════════════════════════════════
const STUDY_TS_KEY = 'stcosmos_study_timestamps';
let studyTimestamps = new Map(); // nodeId → timestamp (ms)
const REVIEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadStudyTimestamps() {
 try {
 const saved = localStorage.getItem(STUDY_TS_KEY);
 if (saved) {
 const arr = JSON.parse(saved);
 studyTimestamps = new Map(arr);
 }
 } catch(e) { /* ignore */ }
}
function saveStudyTimestamps() {
 try { localStorage.setItem(STUDY_TS_KEY, JSON.stringify([...studyTimestamps])); } catch(e) { /* ignore */ }
}
function getNodeLearningState(nodeId) {
 const ts = studyTimestamps.get(nodeId);
 if (!ts) return 'unstudied';
 const age = Date.now() - ts;
 if (age > REVIEW_THRESHOLD_MS) return 'review-due';
 return 'connected'; // recently studied
}

// ═══════════════════════════════════════════
// §4 - DATA INDEX (build flat lookup maps)
// ═══════════════════════════════════════════
const nodeIndex = new Map(); // id → { ...data, type, parentId }
const allNodeIds = [];

const nameToIdIndex = new Map(); // name → id (reverse index for O(1) lookups)

function buildDataIndex() {
 LOCI.forEach(locus => {
 nodeIndex.set(locus.id, { ...locus, type: 'locus', parentId: null });
 allNodeIds.push(locus.id);
 nameToIdIndex.set(locus.n, locus.id);
 if (locus.s) {
 locus.s.forEach(sub => {
 nodeIndex.set(sub.id, { ...sub, type: 'sub', parentId: locus.id, c: locus.c });
 allNodeIds.push(sub.id);
 nameToIdIndex.set(sub.n, sub.id);
 });
 }
 });
}

// ═══════════════════════════════════════════
// §4b - IMPLICIT RELATED TOPICS ENGINE
// Computes connections the author didn't explicitly encode
// via keyword overlap, shared scripture refs, and category proximity.
// ═══════════════════════════════════════════
const relatedTopicsCache = new Map(); // id → [{ id, score, reasons[] }]

function buildRelatedTopicsIndex() {
 // ── INVERTED INDEX approach: O(n*k) instead of O(n²) ──
 // Build inverted maps: keyword → Set<id>, scriptureRef → Set<id>
 // Then for each node, gather candidates from its keywords/refs
 const scriptureToIds = new Map(); // normalizedRef → Set<id>
 const keywordToIds = new Map(); // keyword → Set<id>
 const scriptureMap = new Map(); // id → Set<normalizedRef>
 const keywordMap = new Map(); // id → Set<keyword>

 nodeIndex.forEach((data, id) => {
 // Extract and normalize scripture references
 const refs = extractScriptureRefs(data.d || '');
 const normalizedRefs = new Set();
 refs.forEach(ref => {
 const m = ref.match(/^(\d?\s*[A-Za-z]+\.?)\s*(\d+)/);
 if (m) {
 const norm = (m[1].trim() + ' ' + m[2]).toLowerCase().replace(/\./g, '');
 normalizedRefs.add(norm);
 if (!scriptureToIds.has(norm)) scriptureToIds.set(norm, new Set());
 scriptureToIds.get(norm).add(id);
 }
 });
 scriptureMap.set(id, normalizedRefs);

 // Build keyword set
 const kws = new Set();
 (data.k || []).forEach(k => {
 const kl = k.toLowerCase();
 kws.add(kl);
 if (!keywordToIds.has(kl)) keywordToIds.set(kl, new Set());
 keywordToIds.get(kl).add(id);
 });
 keywordMap.set(id, kws);
 });

 // For each node, gather candidates via inverted index
 nodeIndex.forEach((dataA, idA) => {
 const explicitCl = new Set(dataA.cl || []);
 const parentA = dataA.parentId;
 const childrenA = new Set();
 if (dataA.s) dataA.s.forEach(sub => childrenA.add(sub.id));

 // Candidate scoring map: idB → { score, reasons }
 const candidateMap = new Map();

 const kwA = keywordMap.get(idA);
 const refsA = scriptureMap.get(idA);

 // Gather candidates from keyword overlap
 if (kwA) {
 kwA.forEach(k => {
 const ids = keywordToIds.get(k);
 if (!ids) return;
 ids.forEach(idB => {
 if (idB === idA) return;
 if (!candidateMap.has(idB)) candidateMap.set(idB, { score: 0, kwOverlap: 0, refOverlap: 0, reasons: [] });
 candidateMap.get(idB).kwOverlap++;
 });
 });
 }

 // Gather candidates from scripture overlap
 if (refsA) {
 refsA.forEach(r => {
 const ids = scriptureToIds.get(r);
 if (!ids) return;
 ids.forEach(idB => {
 if (idB === idA) return;
 if (!candidateMap.has(idB)) candidateMap.set(idB, { score: 0, kwOverlap: 0, refOverlap: 0, reasons: [] });
 candidateMap.get(idB).refOverlap++;
 });
 });
 }

 // Score candidates
 const results = [];
 candidateMap.forEach((cand, idB) => {
 const dataB = nodeIndex.get(idB);
 if (!dataB) return;
 // Skip explicit cross-refs, parent/child, siblings
 if (explicitCl.has(idB)) return;
 if (dataB.parentId === idA || parentA === idB) return;
 if (dataA.parentId && dataA.parentId === dataB.parentId) return;

 let score = 0;
 const reasons = [];

 if (cand.kwOverlap >= 2) {
 score += cand.kwOverlap * 12;
 reasons.push(cand.kwOverlap + ' shared keywords');
 } else if (cand.kwOverlap === 1) {
 score += 5;
 }

 if (cand.refOverlap >= 2) {
 score += cand.refOverlap * 8;
 reasons.push(cand.refOverlap + ' shared scriptures');
 } else if (cand.refOverlap === 1) {
 score += 3;
 }

 if (dataA.ct === dataB.ct) {
 score += 4;
 if (reasons.length > 0) reasons.push('same category');
 }

 // Description keyword co-occurrence (only for already-scored candidates)
 if (score > 0 && dataA.d && dataB.d) {
 const descB = dataB.d.toLowerCase();
 let descHits = 0;
 if (kwA) {
 kwA.forEach(k => {
 if (k.length > 4 && descB.includes(k)) descHits++;
 });
 }
 if (descHits >= 2) score += descHits * 2;
 }

 if (score >= 15 && reasons.length > 0) {
 results.push({ id: idB, score, reasons });
 }
 });

 results.sort((a, b) => b.score - a.score);
 relatedTopicsCache.set(idA, results.slice(0, 5));
 });
}

// ═══════════════════════════════════════════
// §5 - PROGRESS TRACKER (localStorage)
// ═══════════════════════════════════════════
const STORAGE_KEY = 'sysTheology_studied';
let studiedNodes = new Set();

function loadProgress() {
 try {
 const saved = localStorage.getItem(STORAGE_KEY);
 if (saved) studiedNodes = new Set(JSON.parse(saved));
 } catch(e) { /* ignore */ }
 loadStudyTimestamps();
 // Backfill timestamps for nodes that were reviewed before timestamps existed
 studiedNodes.forEach(id => {
 if (!studyTimestamps.has(id)) studyTimestamps.set(id, Date.now() - REVIEW_THRESHOLD_MS - 1);
 });
 if (studyTimestamps.size > 0) saveStudyTimestamps();
}
function saveProgress() {
 try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...studiedNodes])); } catch(e) { /* ignore */ }
}
function resetProgress() {
 if (!confirm('Reset all review progress to 0?')) return;
 studiedNodes.clear();
 studyTimestamps.clear();
 saveProgress();
 saveStudyTimestamps();
 updateProgressBadge();
 pulseProgressBadge();
 // Update panel toggle if open
 const toggle = document.getElementById('panel-study-toggle');
 if (toggle) {
 toggle.classList.remove('studied');
 toggle.setAttribute('aria-pressed', 'false');
 toggle.innerHTML = '<span class="check-icon" aria-hidden="true">\u2610</span> Mark as reviewed';
 }
 ActiveEngine.markDirty();
}
function toggleStudied(nodeId) {
 if (studiedNodes.has(nodeId)) {
 studiedNodes.delete(nodeId);
 studyTimestamps.delete(nodeId);
 } else {
 studiedNodes.add(nodeId);
 studyTimestamps.set(nodeId, Date.now());
 }
 saveProgress();
 saveStudyTimestamps();
 updateProgressBadge();
 _updatePulsationFlag();
 ActiveEngine.markDirty();
}

/** Recalculate whether any nodes need pulsating animation */
function _updatePulsationFlag() {
 if (!threeInitialized) return;
 let hasReview = false;
 for (const id of studiedNodes) {
 if (getNodeLearningState(id) === 'review-due') { hasReview = true; break; }
 }
 ThreeEngine._hasReviewDueNodes = hasReview;
}

/**
 * Micro-interaction for the review toggle.
 * Animates the button in-place: checkmark morph, confetti burst, glow pulse.
 * Updates connection list reviewed badges and graph node without re-rendering the panel.
 */
function animateStudiedToggle(btn, nodeId, isNowStudied) {
 // ── 1. Update button content in-place ──
 btn.classList.remove('studying-in', 'studying-out');
 // Force reflow so re-adding the class re-triggers animation
 void btn.offsetWidth;

 const animClass = isNowStudied ? 'studying-in' : 'studying-out';
 btn.classList.add(animClass);
 btn.className = 'panel-study-toggle ' + animClass + (isNowStudied ? ' studied' : '');
 btn.setAttribute('aria-pressed', isNowStudied ? 'true' : 'false');
 btn.innerHTML = isNowStudied
 ? '<span class="check-icon" aria-hidden="true">✓</span> Reviewed'
 : '<span class="check-icon" aria-hidden="true">☐</span> Mark as reviewed';

 // Clean up animation class after it finishes
 setTimeout(() => btn.classList.remove(animClass), 750);

 // ── 2. Confetti particles (only on marking reviewed) ──
 if (isNowStudied) {
 spawnConfetti(btn);
 }

 // ── 3. Update connection list studied badges in-place ──
 updateConnectionStudiedBadges();

 // ── 4. Pulse the progress badge ──
 pulseProgressBadge();
}

/** Spawn confetti particles bursting from the button */
function spawnConfetti(btn) {
 // ── Skip confetti on low-end devices for performance ──
 if (!DeviceCapabilities.quality.enableConfetti) return;
 const colors = ['var(--gold)', 'var(--gold-dim)', '#f0d878', '#d4b44c', '#c8a840', '#e8d070'];
 const count = DeviceCapabilities.isMobile ? 6 : 10; // fewer particles on mobile
 const rect = btn.getBoundingClientRect();
 const panelInner = btn.closest('.panel-inner') || btn.parentElement;
 const parentRect = panelInner.getBoundingClientRect();

 for (let i = 0; i < count; i++) {
 const particle = document.createElement('div');
 particle.className = 'studied-confetti';

 // Position at center of button relative to panel-inner
 const cx = (rect.left + rect.width / 2) - parentRect.left;
 const cy = (rect.top + rect.height / 2) - parentRect.top;
 particle.style.left = cx + 'px';
 particle.style.top = cy + 'px';

 // Random burst direction
 const angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.6;
 const dist = 28 + Math.random() * 32;
 const dx = Math.cos(angle) * dist;
 const dy = Math.sin(angle) * dist - 12; // bias upward
 particle.style.setProperty('--confetti-end', `translate(${dx}px, ${dy}px)`);

 // Random size and shape
 const size = 3 + Math.random() * 3;
 particle.style.width = size + 'px';
 particle.style.height = size + 'px';
 particle.style.borderRadius = Math.random() > 0.5 ? '50%' : '1px';
 particle.style.background = colors[Math.floor(Math.random() * colors.length)];
 particle.style.animationDuration = (0.5 + Math.random() * 0.3) + 's';

 panelInner.style.position = 'relative';
 panelInner.appendChild(particle);

 // Remove after animation
 setTimeout(() => particle.remove(), 900);
 }
}

/** Update ✓ badges on connection items without rebuilding the list */
function updateConnectionStudiedBadges() {
 // Sub-topics list
 document.querySelectorAll('#subtopics-list .connection-item').forEach(item => {
 const label = item.getAttribute('aria-label') || '';
 const nodeName = label.replace(' (reviewed)', '');
 const badge = item.querySelector('.connection-studied');

 // O(1) lookup via reverse index
 const itemNodeId = nameToIdIndex.get(nodeName) || null;

 if (itemNodeId && studiedNodes.has(itemNodeId)) {
 item.setAttribute('aria-label', nodeName + ' (reviewed)');
 if (!badge) {
 const s = document.createElement('div');
 s.className = 'connection-studied';
 s.textContent = '✓';
 s.setAttribute('aria-hidden', 'true');
 item.appendChild(s);
 }
 } else {
 item.setAttribute('aria-label', nodeName);
 if (badge) badge.remove();
 }
 });

 // Cross-references list
 document.querySelectorAll('#crossrefs-list .connection-item').forEach(item => {
 const label = item.getAttribute('aria-label') || '';
 const nodeName = label.replace(', cross-reference', '').replace(' (reviewed)', '');
 const badge = item.querySelector('.connection-studied');

 const itemNodeId = nameToIdIndex.get(nodeName) || null;

 if (itemNodeId && studiedNodes.has(itemNodeId)) {
 item.setAttribute('aria-label', nodeName + ', cross-reference (reviewed)');
 if (!badge) {
 const s = document.createElement('div');
 s.className = 'connection-studied';
 s.textContent = '✓';
 s.setAttribute('aria-hidden', 'true');
 item.appendChild(s);
 }
 } else {
 item.setAttribute('aria-label', nodeName + ', cross-reference');
 if (badge) badge.remove();
 }
 });
}

/** Subtle pulse on the progress badge to confirm the count changed */
function pulseProgressBadge() {
 const badge = document.getElementById('progress-badge');
 if (!badge) return;
 badge.style.transition = 'transform 0.3s var(--ease-spring), color 0.3s';
 badge.style.transform = 'scale(1.15)';
 badge.style.color = 'var(--gold)';
 setTimeout(() => {
 badge.style.transform = 'scale(1)';
 badge.style.color = '';
 }, 350);
}
function updateProgressBadge() {
 const badge = document.getElementById('progress-badge');
 badge.textContent = `${studiedNodes.size} / ${allNodeIds.length} entries visited`;
}

