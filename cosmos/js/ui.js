// ═══════════════════════════════════════════
// §8 - UI CONTROLLER
// ═══════════════════════════════════════════
let activePath = null;
let activePathIndex = 0;
let breadcrumbHistory = [];
let searchHighlightIds = null;

// ── Deep Linking ──
function handleDeepLink() {
 const hash = window.location.hash.slice(1);
 if (hash && nodeIndex.has(hash)) {
 setTimeout(() => openPanel(hash), 600);
 }
}
function setDeepLink(nodeId) {
 history.replaceState(null, '', '#' + nodeId);
}

// ── Tooltip ──
let _tooltipHideTimer = null;
function updateTooltip(nodeId, pointer) {
 const tooltip = document.getElementById('tooltip');
 if (!nodeId) {
 tooltip.classList.remove('visible');
 if (_tooltipHideTimer) { clearTimeout(_tooltipHideTimer); _tooltipHideTimer = null; }
 return;
 }
 const data = nodeIndex.get(nodeId);
 if (!data) return;

 document.getElementById('tooltip-name').textContent = data.n;
 const cat = CATEGORIES[data.ct];
 const catEl = document.getElementById('tooltip-category');
 if (data.type === 'sub' && data.parentId) {
 const parent = nodeIndex.get(data.parentId);
 catEl.textContent = parent ? parent.n : (cat ? cat.label : 'Sub-Topic');
 } else {
 catEl.textContent = cat ? cat.label : 'Major Locus';
 }
 catEl.style.color = data.c || (cat ? cat.color : '#888');

 const studiedEl = document.getElementById('tooltip-studied');
 studiedEl.textContent = studiedNodes.has(nodeId) ? '✓ Reviewed' : '';

 document.getElementById('tooltip-summary').textContent = extractFirstSentence(data.d || '');

 tooltip.classList.add('visible');

 // ── Mobile: center tooltip at bottom of screen (CSS handles this) ──
 if (DeviceCapabilities.isMobile) {
 // CSS @media handles positioning; just auto-hide after 3s
 if (_tooltipHideTimer) clearTimeout(_tooltipHideTimer);
 _tooltipHideTimer = setTimeout(() => {
 tooltip.classList.remove('visible');
 _tooltipHideTimer = null;
 }, 3000);
 } else {
 // Desktop: follow mouse pointer
 const rect = document.getElementById('graph-container').getBoundingClientRect();
 tooltip.style.left = Math.min(window.innerWidth - 290, pointer.x + rect.left + 16) + 'px';
 tooltip.style.top = Math.max(10, pointer.y + rect.top - 20) + 'px';
 }
}

// ── Panel ──
function openPanel(nodeId) {
 const data = nodeIndex.get(nodeId);
 if (!data) return;

 // Save focus trigger for restoration on close
 if (!document.getElementById('study-panel').classList.contains('open')) {
 A11y.panelTrigger = document.activeElement;
 }

 ActiveEngine.setSelectedNode(nodeId);
 ActiveEngine.markDirty();
 setDeepLink(nodeId);

 const panel = document.getElementById('study-panel');
 document.getElementById('panel-title').textContent = data.n;
 document.getElementById('panel-layer').textContent = data.type === 'locus' ? 'MAJOR LOCUS' : 'SUB-TOPIC';
 document.getElementById('panel-color-bar').style.background =
 `linear-gradient(90deg, ${data.c || '#888'}, transparent)`;

 // Update panel label for screen readers
 panel.setAttribute('aria-label', 'Study: ' + data.n);

 // Study toggle
 const studyBtn = document.getElementById('panel-study-toggle');
 const isStudied = studiedNodes.has(nodeId);
 studyBtn.className = 'panel-study-toggle' + (isStudied ? ' studied' : '');
 studyBtn.setAttribute('aria-pressed', isStudied ? 'true' : 'false');
 studyBtn.innerHTML = isStudied
 ? '<span class="check-icon" aria-hidden="true">✓</span> Reviewed'
 : '<span class="check-icon" aria-hidden="true">☐</span> Mark as reviewed';
 studyBtn.onclick = () => {
 const willStudy = !studiedNodes.has(nodeId);
 toggleStudied(nodeId);
 animateStudiedToggle(studyBtn, nodeId, willStudy);
 };

 // Summary (first sentence) + Description (full, collapsed)
 const fullDesc = data.d || '';
 const firstSentence = extractFirstSentence(fullDesc);
 document.getElementById('panel-summary').textContent = firstSentence;

 const descWrapper = document.getElementById('panel-desc-wrapper');
 const descEl = document.getElementById('panel-description');
 const readMoreBtn = document.getElementById('panel-read-more');
 descEl.textContent = fullDesc;
 descWrapper.classList.remove('expanded', 'no-overflow');
 readMoreBtn.classList.remove('hidden');
 readMoreBtn.textContent = 'Read more';
 readMoreBtn.setAttribute('aria-expanded', 'false');

 // After layout: check if description actually overflows
 requestAnimationFrame(() => {
 if (descEl.scrollHeight <= descWrapper.clientHeight + 2) {
 descWrapper.classList.add('no-overflow');
 readMoreBtn.classList.add('hidden');
 }
 });

 readMoreBtn.onclick = () => {
 const isExpanded = descWrapper.classList.toggle('expanded');
 readMoreBtn.textContent = isExpanded ? 'Read less' : 'Read more';
 readMoreBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
 };

 // ── Extract & display references with authority-level distinction ──
 // Scripture = <i>norma normans</i> (the norming norm) : supreme authority
 // Confessional Standards = <i>norma normata</i> (the normed norm) : subordinate to Scripture
 const scripturesEl = document.getElementById('panel-scriptures');
 const confessionalsEl = document.getElementById('panel-confessionals');
 const scriptureSection = document.getElementById('panel-scripture-section');
 const confessionalSection = document.getElementById('panel-confessional-section');
 scripturesEl.innerHTML = '';
 confessionalsEl.innerHTML = '';

 const scriptureRefs = extractScriptureRefs(data.d || '');
 const confessionalRefs = extractConfessionalRefs(data.d || '');

 // Scripture references (<i>norma normans</i>)
 if (scriptureRefs.length > 0) {
 scriptureSection.style.display = '';
 scriptureRefs.slice(0, 12).forEach(ref => {
 const tag = document.createElement('span');
 tag.className = 'scripture-tag';
 tag.textContent = ref;
 scripturesEl.appendChild(tag);
 });
 } else {
 scriptureSection.style.display = 'none';
 }

 // Confessional standard references (<i>norma normata</i>)
 if (confessionalRefs.length > 0) {
 confessionalSection.style.display = '';
 confessionalRefs.slice(0, 10).forEach(ref => {
 const tag = document.createElement('span');
 tag.className = 'confessional-tag';
 tag.textContent = ref;
 confessionalsEl.appendChild(tag);
 });
 } else {
 confessionalSection.style.display = 'none';
 }

 // Keywords (interactive - make keyboard accessible)
 const keywordsEl = document.getElementById('panel-keywords');
 keywordsEl.innerHTML = '';
 (data.k || []).slice(0, 14).forEach(kw => {
 const tag = document.createElement('button');
 tag.className = 'keyword-tag';
 tag.textContent = kw;
 tag.setAttribute('aria-label', 'Search for keyword: ' + kw);
 tag.onclick = () => {
 document.getElementById('search-input').value = kw;
 performSearch(kw);
 };
 keywordsEl.appendChild(tag);
 });

 // Historical Controversies (hc field)
 const hcContainer = document.getElementById('panel-controversies');
 const hcList = document.getElementById('panel-controversies-list');
 hcList.innerHTML = '';
 const controversies = data.hc || [];
 if (controversies.length > 0) {
 hcContainer.style.display = '';
 controversies.forEach(hc => {
 const tag = document.createElement('span');
 tag.style.cssText = 'font-family:var(--font-ui);font-size:10px;padding:3px 8px;background:rgba(204,102,85,0.12);color:#cc8866;border:1px solid rgba(204,102,85,0.2);border-radius:3px;cursor:default;';
 tag.textContent = hc;
 hcList.appendChild(tag);
 });
 } else {
 hcContainer.style.display = 'none';
 }

 // Connections tab - Sub-topics (DOM-safe, focusable, keyboard-operable)
 const subSection = document.getElementById('subtopics-section');
 const subList = document.getElementById('subtopics-list');
 subList.innerHTML = '';
 const locus = LOCI.find(l => l.id === (data.type === 'locus' ? nodeId : data.parentId));
 if (data.type === 'locus' && data.s) {
 subSection.style.display = '';
 data.s.forEach(sub => {
 const item = document.createElement('div');
 item.className = 'connection-item';
 item.setAttribute('role', 'listitem');
 item.tabIndex = 0;
 item.setAttribute('aria-label', sub.n + (studiedNodes.has(sub.id) ? ' (studied)' : ''));

 const dot = document.createElement('div');
 dot.className = 'connection-dot';
 dot.style.background = data.c;
 dot.style.boxShadow = '0 0 6px ' + data.c;
 dot.setAttribute('aria-hidden', 'true');

 const name = document.createElement('span');
 name.className = 'connection-name';
 name.textContent = sub.n;

 item.append(dot, name);
 if (studiedNodes.has(sub.id)) {
 const studied = document.createElement('div');
 studied.className = 'connection-studied';
 studied.textContent = '✓';
 studied.setAttribute('aria-hidden', 'true');
 item.appendChild(studied);
 }

 const navigate = () => openPanel(sub.id);
 item.onclick = navigate;
 item.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(); } };
 subList.appendChild(item);
 });
 } else {
 subSection.style.display = 'none';
 }

 // Cross-refs (DOM-safe, focusable, keyboard-operable)
 const crossSection = document.getElementById('crossrefs-section');
 const crossList = document.getElementById('crossrefs-list');
 crossList.innerHTML = '';
 if (data.cl) {
 crossSection.style.display = '';
 data.cl.forEach(refId => {
 const refData = nodeIndex.get(refId);
 if (!refData) return;
 const item = document.createElement('div');
 item.className = 'connection-item';
 item.setAttribute('role', 'listitem');
 item.tabIndex = 0;
 item.setAttribute('aria-label', refData.n + ', cross-reference' + (studiedNodes.has(refId) ? ' (studied)' : ''));

 const dot = document.createElement('div');
 dot.className = 'connection-dot';
 dot.style.background = refData.c;
 dot.style.boxShadow = '0 0 6px ' + refData.c;
 dot.setAttribute('aria-hidden', 'true');

 const name = document.createElement('span');
 name.className = 'connection-name';
 name.textContent = refData.n;

 const type = document.createElement('span');
 type.className = 'connection-type';
 type.textContent = 'cross-ref';

 item.append(dot, name, type);
 if (studiedNodes.has(refId)) {
 const studied = document.createElement('div');
 studied.className = 'connection-studied';
 studied.textContent = '✓';
 studied.setAttribute('aria-hidden', 'true');
 item.appendChild(studied);
 }

 const navigate = () => openPanel(refId);
 item.onclick = navigate;
 item.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(); } };
 crossList.appendChild(item);
 });
 } else {
 crossSection.style.display = 'none';
 }

 // Related Topics (algorithmically discovered - keyword/scripture/category overlap)
 const relatedSection = document.getElementById('related-section');
 const relatedList = document.getElementById('related-list');
 relatedList.innerHTML = '';
 const related = relatedTopicsCache.get(nodeId) || [];
 if (related.length > 0) {
 relatedSection.style.display = '';
 related.forEach(rel => {
 const relData = nodeIndex.get(rel.id);
 if (!relData) return;
 const item = document.createElement('div');
 item.className = 'connection-item';
 item.setAttribute('role', 'listitem');
 item.tabIndex = 0;
 item.setAttribute('aria-label', relData.n + ', related topic' + (studiedNodes.has(rel.id) ? ' (studied)' : ''));

 const dot = document.createElement('div');
 dot.className = 'connection-dot';
 dot.style.background = relData.c;
 dot.style.boxShadow = '0 0 6px ' + relData.c;
 dot.setAttribute('aria-hidden', 'true');

 const name = document.createElement('span');
 name.className = 'connection-name';
 name.textContent = relData.n;

 const reason = document.createElement('span');
 reason.className = 'related-reason';
 reason.textContent = rel.reasons[0] || '';

 item.append(dot, name, reason);
 if (studiedNodes.has(rel.id)) {
 const studied = document.createElement('div');
 studied.className = 'connection-studied';
 studied.textContent = '✓';
 studied.setAttribute('aria-hidden', 'true');
 item.appendChild(studied);
 }

 const navigate = () => openPanel(rel.id);
 item.onclick = navigate;
 item.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(); } };
 relatedList.appendChild(item);
 });
 } else {
 relatedSection.style.display = 'none';
 }

 // Study tab cards (DOM-safe, focusable when clickable)
 const studyCards = document.getElementById('study-cards');
 studyCards.innerHTML = '';
 const cards = data.type === 'locus' && data.s ? data.s : [data];
 cards.forEach(item => {
 const card = document.createElement('div');
 card.className = 'study-card';
 const h5 = document.createElement('h5');
 h5.textContent = item.n;
 const p = document.createElement('p');
 p.textContent = item.d;
 card.append(h5, p);
 if (item.id !== nodeId) {
 card.tabIndex = 0;
 card.setAttribute('role', 'button');
 card.setAttribute('aria-label', 'Study ' + item.n);
 const navigate = () => openPanel(item.id);
 card.onclick = navigate;
 card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(); } };
 }
 studyCards.appendChild(card);
 });

 // Breadcrumb
 const bcIdx = breadcrumbHistory.findIndex(b => b.id === nodeId);
 if (bcIdx >= 0) breadcrumbHistory = breadcrumbHistory.slice(0, bcIdx + 1);
 else breadcrumbHistory.push({ id: nodeId, name: data.n });
 renderBreadcrumb();

 // Reset tabs to overview (ARIA tab pattern)
 document.querySelectorAll('.panel-tab').forEach(t => {
 t.classList.remove('active');
 t.setAttribute('aria-selected', 'false');
 t.tabIndex = -1;
 });
 document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
 const overviewTab = document.querySelector('.panel-tab[data-tab="overview"]');
 overviewTab.classList.add('active');
 overviewTab.setAttribute('aria-selected', 'true');
 overviewTab.tabIndex = 0;
 document.getElementById('tab-overview').classList.add('active');

 // Focus graph
 ActiveEngine.focusNode(nodeId, data.type === 'locus' ? 1.2 : 1.8);

 panel.classList.add('open');
 // ── Reset any swipe transform from mobile gesture ──
 panel.style.transform = '';
 panel.style.opacity = '';

 // Focus management: move focus into panel after slide-in transition completes
 A11y.disableFocusTrap();
 const onTransitionDone = () => {
 panel.removeEventListener('transitionend', onTransitionDone);
 // Guard: panel may have been closed during the transition
 if (!panel.classList.contains('open')) return;
 A11y.enableFocusTrap(panel);
 const title = document.getElementById('panel-title');
 if (title) title.focus();
 };
 panel.addEventListener('transitionend', onTransitionDone);
 // Safety fallback if transitionend doesn't fire (e.g. reduced-motion, already open)
 setTimeout(() => {
 if (A11y.trapFocusHandler === null) onTransitionDone();
 }, 600);
}

function closePanel() {
 const panel = document.getElementById('study-panel');
 panel.classList.remove('open');
 A11y.disableFocusTrap();
 ActiveEngine.clearSelectedNode();
 // Resume auto-rotation from current position (no snap-back)
 if (threeInitialized) {
   try {
     ThreeEngine.targetOrbitTarget = new THREE.Vector3(0,0,0);
     ThreeEngine._autoRotate = true;
   } catch (e) {}
 }
 ActiveEngine.markDirty();
 breadcrumbHistory = [];
 renderBreadcrumb();
 // Restore focus to the element that opened the panel
 if (A11y.panelTrigger && A11y.panelTrigger.isConnected) {
 A11y.panelTrigger.focus();
 }
 A11y.panelTrigger = null;
}

function renderBreadcrumb() {
 const el = document.getElementById('breadcrumb');
 el.innerHTML = '';
 if (breadcrumbHistory.length < 2) return;
 breadcrumbHistory.forEach((b, i) => {
 if (i > 0) {
 const sep = document.createElement('span');
 sep.className = 'sep';
 sep.textContent = '›';
 sep.setAttribute('aria-hidden', 'true');
 el.appendChild(sep);
 }
 const isLast = i === breadcrumbHistory.length - 1;
 const span = document.createElement('span');
 span.textContent = b.name;
 span.tabIndex = 0;
 span.setAttribute('role', 'link');
 if (isLast) span.setAttribute('aria-current', 'page');
 const navigate = () => openPanel(b.id);
 span.onclick = navigate;
 span.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(); } };
 el.appendChild(span);
 });
}

function resetView() {
 if (threeInitialized) {
 try {
 ThreeEngine.targetSpherical = { theta: Math.PI*0.35, phi: Math.PI*0.35, radius: 55 };
 ThreeEngine._autoRotate = true;
 ThreeEngine.targetOrbitTarget = new THREE.Vector3(0,0,0);
 ThreeEngine.filterCategory = null;
 } catch (e) {
 console.warn('[resetView] Three.js call failed:', e);
 }
 }
 searchHighlightIds = null;
 ActiveEngine.markDirty();
 document.querySelectorAll('.legend-item').forEach(l => {
 l.classList.remove('active');
 l.setAttribute('aria-pressed', 'false');
 });
}

// ── Search UI ──
function performSearch(query) {
 const resultsEl = document.getElementById('search-results');
 const input = document.getElementById('search-input');

 // Reset active descendant state
 A11y.resetSearchIndex();

 if (!query || query.length < 2) {
 resultsEl.classList.remove('visible');
 input.setAttribute('aria-expanded', 'false');
 searchHighlightIds = null;
 ActiveEngine.markDirty();
 A11y.announce('');
 return;
 }

 const results = searchNodes(query);
 if (results.length === 0) {
 resultsEl.innerHTML = '<div class="search-empty" role="status">No results found</div>';
 resultsEl.classList.add('visible');
 input.setAttribute('aria-expanded', 'true');
 searchHighlightIds = null;
 ActiveEngine.markDirty();
 A11y.announce('No results found');
 return;
 }

 // Highlight matching nodes on graph
 searchHighlightIds = new Set(results.map(r => r.id));
 ActiveEngine.markDirty();

 resultsEl.innerHTML = '';
 results.forEach((result, index) => {
 const data = result.data;
 const cat = CATEGORIES[data.ct];
 const color = data.c || (cat ? cat.color : '#888');

 const item = document.createElement('div');
 item.className = 'search-result-item';
 item.setAttribute('role', 'option');
 item.setAttribute('aria-selected', 'false');
 item.id = 'search-option-' + index;
 item.setAttribute('aria-label', data.n + ', ' + (cat ? cat.label : 'Doctrine'));

 const dot = document.createElement('div');
 dot.className = 'search-result-dot';
 dot.style.background = color;
 dot.style.boxShadow = '0 0 6px ' + color;
 dot.setAttribute('aria-hidden', 'true');

 const info = document.createElement('div');
 info.className = 'search-result-info';

 const nameEl = document.createElement('div');
 nameEl.className = 'search-result-name';
 nameEl.appendChild(highlightMatch(data.n, query));

 const catEl = document.createElement('div');
 catEl.className = 'search-result-category';
 catEl.style.color = color;
 catEl.textContent = cat ? cat.label : 'Doctrine';

 const snippetEl = document.createElement('div');
 snippetEl.className = 'search-result-snippet';
 snippetEl.appendChild(getSnippet(data.d || '', query));

 info.append(nameEl, catEl, snippetEl);
 item.append(dot, info);
 item.onclick = () => {
 openPanel(result.id);
 resultsEl.classList.remove('visible');
 input.setAttribute('aria-expanded', 'false');
 A11y.resetSearchIndex();
 searchHighlightIds = null;
 };
 resultsEl.appendChild(item);
 });
 resultsEl.classList.add('visible');
 input.setAttribute('aria-expanded', 'true');
 A11y.announce(results.length + ' result' + (results.length === 1 ? '' : 's') + ' found');
}

// Returns a DocumentFragment with query matches wrapped in <mark> tags (XSS-safe)
function highlightMatch(text, query) {
 const frag = document.createDocumentFragment();
 const idx = text.toLowerCase().indexOf(query.toLowerCase());
 if (idx === -1) {
 frag.appendChild(document.createTextNode(text));
 return frag;
 }
 frag.appendChild(document.createTextNode(text.substring(0, idx)));
 const mark = document.createElement('mark');
 mark.textContent = text.substring(idx, idx + query.length);
 frag.appendChild(mark);
 frag.appendChild(document.createTextNode(text.substring(idx + query.length)));
 return frag;
}

// Returns a DocumentFragment with a contextual snippet around the query match (XSS-safe)
function getSnippet(text, query) {
 const frag = document.createDocumentFragment();
 const idx = text.toLowerCase().indexOf(query.toLowerCase());
 if (idx === -1) {
 frag.appendChild(document.createTextNode(text.substring(0, 120) + '…'));
 return frag;
 }
 const start = Math.max(0, idx - 40);
 const end = Math.min(text.length, idx + query.length + 80);
 const snippet = (start > 0 ? '…' : '') + text.substring(start, end) + (end < text.length ? '…' : '');
 frag.appendChild(document.createTextNode(snippet));
 return frag;
}

// ── Paths ──
function startPath(pathKey) {
 const path = STUDY_PATHS[pathKey];
 if (!path) return;
 activePath = { key: pathKey, ids: path.ids, name: path.name };
 activePathIndex = 0;
 ActiveEngine.markDirty();
 navigateToPathNode(0);

 document.getElementById('path-indicator').classList.add('visible');
 document.getElementById('path-name').textContent = path.name;
 document.getElementById('paths-popup').classList.remove('visible');
 document.getElementById('btn-paths').classList.remove('active');
}

function stopPath() {
 activePath = null;
 activePathIndex = 0;
 document.getElementById('path-indicator').classList.remove('visible');
 searchHighlightIds = null;
 ActiveEngine.markDirty();
}

function navigateToPathNode(index) {
 if (!activePath || index < 0 || index >= activePath.ids.length) return;
 activePathIndex = index;
 const nodeId = activePath.ids[index];
 openPanel(nodeId);
 document.getElementById('path-counter').textContent = `${index + 1}/${activePath.ids.length}`;
}

// ── Legend ──
function buildLegend() {
 const legendEl = document.getElementById('legend');
 const entries = Object.entries(CATEGORIES);
 entries.forEach(([key, cat], index) => {
 const item = document.createElement('div');
 item.className = 'legend-item';
 item.setAttribute('role', 'button');
 item.setAttribute('aria-pressed', 'false');
 item.setAttribute('aria-label', 'Filter by ' + cat.label);
 item.tabIndex = index === 0 ? 0 : -1; // roving tabindex

 const dot = document.createElement('div');
 dot.className = 'legend-dot';
 dot.style.background = cat.color;
 dot.style.boxShadow = '0 0 8px ' + cat.color;
 dot.setAttribute('aria-hidden', 'true');

 const label = document.createElement('span');
 label.className = 'legend-label';
 label.textContent = cat.label;

 item.append(dot, label);

 const toggle = () => {
 const isActive = item.classList.contains('active');
 document.querySelectorAll('.legend-item').forEach(l => {
 l.classList.remove('active');
 l.setAttribute('aria-pressed', 'false');
 });
 if (!isActive) {
 item.classList.add('active');
 item.setAttribute('aria-pressed', 'true');
 ActiveEngine.filterByCategory(key);
 } else {
 ActiveEngine.filterByCategory(null);
 }
 };

 item.onclick = toggle;
 item.onkeydown = (e) => {
 if (e.key === 'Enter' || e.key === ' ') {
 e.preventDefault(); toggle();
 }
 // Roving tabindex: arrow key navigation within toolbar
 const items = [...legendEl.querySelectorAll('.legend-item')];
 const idx = items.indexOf(item);
 let next = -1;
 if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
 e.preventDefault(); next = (idx + 1) % items.length;
 } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
 e.preventDefault(); next = (idx - 1 + items.length) % items.length;
 } else if (e.key === 'Home') {
 e.preventDefault(); next = 0;
 } else if (e.key === 'End') {
 e.preventDefault(); next = items.length - 1;
 }
 if (next >= 0) {
 items[idx].tabIndex = -1;
 items[next].tabIndex = 0;
 items[next].focus();
 }
 };
 legendEl.appendChild(item);
 });
}

// ── Paths Popup ──
function buildPathsPopup() {
 const listEl = document.getElementById('paths-list');
 Object.entries(STUDY_PATHS).forEach(([key, path]) => {
 const progressCount = path.ids.filter(id => studiedNodes.has(id)).length;
 const progressPct = Math.round((progressCount / path.ids.length) * 100);
 const item = document.createElement('div');
 item.className = 'path-item';
 item.setAttribute('role', 'listitem');
 item.tabIndex = 0;
 item.setAttribute('aria-label', path.name + ', ' + path.ids.length + ' nodes, ' + progressPct + '% complete. ' + path.description);

 const small = document.createElement('small');
 small.textContent = 'GUIDED PATH';
 const nameSpan = document.createElement('span');
 nameSpan.className = 'path-name';
 nameSpan.textContent = path.name;
 const meta = document.createElement('span');
 meta.className = 'path-meta';
 meta.textContent = path.ids.length + ' nodes · ' + path.description;
 const progress = document.createElement('div');
 progress.className = 'path-progress';
 progress.setAttribute('role', 'progressbar');
 progress.setAttribute('aria-valuenow', progressPct);
 progress.setAttribute('aria-valuemin', '0');
 progress.setAttribute('aria-valuemax', '100');
 progress.setAttribute('aria-label', path.name + ' progress');
 const fill = document.createElement('div');
 fill.className = 'path-progress-fill';
 fill.style.width = progressPct + '%';
 progress.appendChild(fill);
 item.append(small, nameSpan, meta, progress);

 const activate = () => startPath(key);
 item.onclick = activate;
 item.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } };
 listEl.appendChild(item);
 });
}

// ═══════════════════════════════════════════
// §6e - FLYTHROUGH UI (Improvement #23)
// ═══════════════════════════════════════════
function updateFlythroughUI(nodeId, idx, total, pathName) {
 const titleEl = document.getElementById('flythrough-node-title');
 const descEl = document.getElementById('flythrough-node-desc');
 const dotsEl = document.getElementById('flythrough-dots');
 const textEl = document.getElementById('flythrough-text');
 const locusEl = document.getElementById('flythrough-locus-name');
 if (!titleEl || !descEl || !dotsEl || !textEl) return;

 const data = nodeIndex.get(nodeId);
 if (!data) return;

 // Fade out then in
 textEl.classList.remove('visible');
 setTimeout(() => {
 // Show path name and category context
 if (locusEl) {
 const catName = data.ct ? data.ct.replace(/_/g, ' ') : '';
 locusEl.textContent = pathName ? (pathName + (catName ? ' · ' + catName : '')) : catName;
 }
 titleEl.textContent = data.n || nodeId;
 // Show full description in flythrough overlay
 const desc = data.d || '';
 descEl.textContent = desc;

 // Build progress dots
 dotsEl.innerHTML = '';
 for (let i = 0; i < total; i++) {
 const dot = document.createElement('div');
 dot.className = 'flythrough-dot';
 if (i < idx) dot.classList.add('past');
 if (i === idx) dot.classList.add('active');
 dotsEl.appendChild(dot);
 }

 textEl.classList.add('visible');
 }, 350);
}

// ── Wire UI ──
function wireUI() {
 // ── Panel tabs (ARIA tablist keyboard pattern) ──
 const tabs = [...document.querySelectorAll('.panel-tab')];
 function activateTab(tab) {
 tabs.forEach(t => {
 t.classList.remove('active');
 t.setAttribute('aria-selected', 'false');
 t.tabIndex = -1;
 });
 document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
 tab.classList.add('active');
 tab.setAttribute('aria-selected', 'true');
 tab.tabIndex = 0;
 tab.focus();
 document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
 }
 tabs.forEach(tab => {
 tab.onclick = () => activateTab(tab);
 tab.onkeydown = (e) => {
 const idx = tabs.indexOf(tab);
 let next = -1;
 if (e.key === 'ArrowRight') { e.preventDefault(); next = (idx + 1) % tabs.length; }
 else if (e.key === 'ArrowLeft') { e.preventDefault(); next = (idx - 1 + tabs.length) % tabs.length; }
 else if (e.key === 'Home') { e.preventDefault(); next = 0; }
 else if (e.key === 'End') { e.preventDefault(); next = tabs.length - 1; }
 if (next >= 0) activateTab(tabs[next]);
 };
 });

 // ── Panel close ──
 document.getElementById('panel-close').onclick = closePanel;

 // ── Search with keyboard navigation (combobox + listbox pattern) ──
 const searchInput = document.getElementById('search-input');
 const resultsEl = document.getElementById('search-results');
 let searchTimeout;

 searchInput.oninput = function() {
 clearTimeout(searchTimeout);
 const query = this.value.trim();
 A11y.resetSearchIndex();
 // ── Adaptive debounce: longer on mobile to reduce jank during typing ──
 const debounceMs = DeviceCapabilities.isMobile ? 200 : 120;
 searchTimeout = setTimeout(() => performSearch(query), debounceMs);
 };

 searchInput.addEventListener('focus', function() {
 if (this.value.trim().length >= 2) performSearch(this.value.trim());
 });

 searchInput.addEventListener('keydown', function(e) {
 const options = [...resultsEl.querySelectorAll('[role="option"]')];
 if (!options.length || !resultsEl.classList.contains('visible')) return;

 if (e.key === 'ArrowDown') {
 e.preventDefault();
 A11y.searchActiveIndex = Math.min(A11y.searchActiveIndex + 1, options.length - 1);
 } else if (e.key === 'ArrowUp') {
 e.preventDefault();
 A11y.searchActiveIndex = Math.max(A11y.searchActiveIndex - 1, -1);
 } else if (e.key === 'Enter' && A11y.searchActiveIndex >= 0) {
 e.preventDefault();
 options[A11y.searchActiveIndex].click();
 return;
 } else {
 return;
 }

 // Update aria-activedescendant and visual highlight
 options.forEach(opt => opt.setAttribute('aria-selected', 'false'));
 if (A11y.searchActiveIndex >= 0) {
 const active = options[A11y.searchActiveIndex];
 active.setAttribute('aria-selected', 'true');
 searchInput.setAttribute('aria-activedescendant', active.id);
 active.scrollIntoView({ block: 'nearest' });
 } else {
 searchInput.setAttribute('aria-activedescendant', '');
 }
 });

 document.addEventListener('click', e => {
 if (!e.target.closest('.search-container')) {
 resultsEl.classList.remove('visible');
 searchInput.setAttribute('aria-expanded', 'false');
 A11y.resetSearchIndex();
 }
 });

 // ── Paths popup with aria-expanded + focus trap ──
 const pathsPopup = document.getElementById('paths-popup');
 const pathsBtn = document.getElementById('btn-paths');
 pathsBtn.onclick = function() {
 const isVisible = pathsPopup.classList.contains('visible');
 pathsPopup.classList.toggle('visible');
 this.classList.toggle('active', !isVisible);
 this.setAttribute('aria-expanded', !isVisible ? 'true' : 'false');
 if (!isVisible) {
 // Opening: focus first item, enable focus trap
 const firstItem = pathsPopup.querySelector('[tabindex="0"]');
 if (firstItem) setTimeout(() => firstItem.focus(), 100);
 A11y.enableFocusTrap(pathsPopup);
 } else {
 // Closing: disable focus trap, return focus
 A11y.disableFocusTrap();
 pathsBtn.focus();
 }
 };
 // Close paths popup on outside click
 document.addEventListener('click', e => {
 if (pathsPopup.classList.contains('visible') &&
 !e.target.closest('#paths-popup') && !e.target.closest('#btn-paths')) {
 pathsPopup.classList.remove('visible');
 pathsBtn.classList.remove('active');
 pathsBtn.setAttribute('aria-expanded', 'false');
 A11y.disableFocusTrap();
 }
 });
 document.getElementById('path-close').onclick = stopPath;
 document.getElementById('path-prev').onclick = () => navigateToPathNode(activePathIndex - 1);
 document.getElementById('path-next').onclick = () => navigateToPathNode(activePathIndex + 1);

 // ── Flythrough picker references (declared early for closure access) ──
 const flythroughPicker = document.getElementById('flythrough-picker');
 const flythroughBackdrop = document.getElementById('flythrough-picker-backdrop');
 const flythroughList = document.getElementById('flythrough-picker-list');
 function closeFlythroughPicker() {
 flythroughPicker.classList.remove('visible');
 flythroughBackdrop.classList.remove('visible');
 }

 // ── Reset view ──
 document.getElementById('btn-reset').onclick = () => {
 closePanel();
 stopPath();
 // Also stop flythrough if running
 if (ThreeEngine.flythrough && ThreeEngine.flythrough.active) {
 ThreeEngine.stopFlythrough();
 }
 closeFlythroughPicker();
 resetView();
 };

 // ── Meditate button (Improvement #23) : The Reformed tradition opens path picker ──

 function openFlythroughPicker() {
 if (ThreeEngine.flythrough && ThreeEngine.flythrough.active) {
 ThreeEngine.stopFlythrough();
 return;
 }
 // Build picker items from FLYTHROUGH_PATHS
 flythroughList.innerHTML = '';
 FLYTHROUGH_PATHS.forEach(fp => {
 const item = document.createElement('div');
 item.className = 'picker-item';
 item.tabIndex = 0;
 item.setAttribute('role', 'button');
 const dot = document.createElement('div');
 dot.className = 'picker-item-dot';
 dot.style.background = fp.color;
 const info = document.createElement('div');
 info.className = 'picker-item-info';
 const name = document.createElement('div');
 name.className = 'picker-item-name';
 name.textContent = fp.name;
 const desc = document.createElement('div');
 desc.className = 'picker-item-desc';
 desc.textContent = fp.desc;
 info.append(name, desc);
 const count = document.createElement('div');
 count.className = 'picker-item-count';
 count.textContent = fp.ids.length + ' stops';
 item.append(dot, info, count);
 const launch = () => {
 closeFlythroughPicker();
 closePanel();
 stopPath();
 setTimeout(() => {
 ThreeEngine.startFlythrough(fp.ids, fp.name, fp.color);
 }, 200);
 };
 item.onclick = launch;
 item.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launch(); } };
 flythroughList.appendChild(item);
 });
 flythroughPicker.classList.add('visible');
 flythroughBackdrop.classList.add('visible');
 }

 document.getElementById('btn-meditate').onclick = openFlythroughPicker;
 flythroughBackdrop.onclick = closeFlythroughPicker;
 document.getElementById('flythrough-pause').onclick = () => {
 ThreeEngine.toggleFlythroughPause();
 };
 document.getElementById('flythrough-exit').onclick = () => {
 ThreeEngine.stopFlythrough();
 };

 // ── Progress badge click to reset ──
 document.getElementById('progress-badge').onclick = () => {
 resetProgress();
 };

 // ── Keyboard shortcuts ──
 window.addEventListener('keydown', e => {
 const panel = document.getElementById('study-panel');
 const panelOpen = panel.classList.contains('open');

 // Inside search input: handle Escape to close results
 if (e.target === searchInput) {
 if (e.key === 'Escape') {
 e.target.blur();
 resultsEl.classList.remove('visible');
 searchInput.setAttribute('aria-expanded', 'false');
 A11y.resetSearchIndex();
 searchHighlightIds = null;
 ActiveEngine.markDirty();
 }
 return;
 }

 // Escape key - layered dismissal (innermost open surface first)
 if (e.key === 'Escape') {
 // 0a. If flythrough picker is open, close it
 if (flythroughPicker.classList.contains('visible')) {
 closeFlythroughPicker();
 return;
 }
 // 0b. If flythrough is active, stop it
 if (ThreeEngine.flythrough && ThreeEngine.flythrough.active) {
 ThreeEngine.stopFlythrough();
 return;
 }
 // 1. If paths popup is open, close it and return focus to trigger
 if (pathsPopup.classList.contains('visible')) {
 pathsPopup.classList.remove('visible');
 pathsBtn.classList.remove('active');
 pathsBtn.setAttribute('aria-expanded', 'false');
 A11y.disableFocusTrap();
 pathsBtn.focus();
 return;
 }
 // 2. If study panel is open, close it (focus restoration handled by closePanel)
 if (panelOpen) {
 closePanel();
 return;
 }
 // 3. Nothing modal open - global reset
 stopPath();
 resetView();
 return;
 }

 // Path navigation (only when not inside the panel)
 if (e.key === 'ArrowRight' && activePath && !panelOpen) navigateToPathNode(activePathIndex + 1);
 if (e.key === 'ArrowLeft' && activePath && !panelOpen) navigateToPathNode(activePathIndex - 1);

 // Global search shortcut
 if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || e.key === '/') {
 e.preventDefault();
 searchInput.focus();
 }
 });

 // ── Onboarding ──
 const enterBtn = document.getElementById('enter-btn');
 const onboardingScreen = document.getElementById('onboarding-screen');

 enterBtn.onclick = () => {
 onboardingScreen.classList.add('hidden');
 A11y.disableFocusTrap();
 // Show the 3D cosmos now that onboarding is dismissed
 document.getElementById('three-container').style.visibility = 'visible';
 document.getElementById('legend').style.visibility = 'visible';
 // Remove from DOM after transition completes to free resources
 setTimeout(() => onboardingScreen.remove(), 900);
 // Clean up old v1 FTUE key that may block the new tour
 try { localStorage.removeItem('stc_ftue_complete'); } catch(e) {}
 // Launch FTUE coach marks for first-time users (after cosmos is visible)
 setTimeout(() => {
 console.log('[Init] Checking FTUE tour...');
 if (window.FTUETour) {
 if (window.FTUETour.shouldShow()) {
 console.log('[Init] Starting FTUE tour.');
 window.FTUETour.start();
 } else {
 console.log('[Init] FTUE already completed. Focusing search. (Run FTUETour.restart() to replay)');
 searchInput.focus();
 }
 } else {
 console.warn('[Init] FTUETour not found on window.');
 searchInput.focus();
 }
 }, 600);
 };
 // Auto-focus the enter button and trap focus in onboarding when it becomes visible
 const onboardingObserver = new MutationObserver(() => {
 if (!onboardingScreen.classList.contains('hidden')) {
 A11y.enableFocusTrap(onboardingScreen);
 setTimeout(() => enterBtn.focus(), 400);
 }
 });
 onboardingObserver.observe(onboardingScreen, { attributes: true, attributeFilter: ['class'] });

 // ── Resize handler ──
 window.addEventListener('resize', () => ActiveEngine.resize());

 // ═══ MOBILE-SPECIFIC ENHANCEMENTS ═══
 if (DeviceCapabilities.isMobile || DeviceCapabilities.isTablet) {

 // ── Mobile Legend Toggle ──
 const legendToggle = document.getElementById('btn-legend-mobile');
 const legend = document.getElementById('legend');
 if (legendToggle) {
 legendToggle.style.display = '';
 legendToggle.onclick = () => {
 const isOpen = legend.classList.contains('mobile-open');
 legend.classList.toggle('mobile-open');
 legendToggle.classList.toggle('active', !isOpen);
 legendToggle.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
 };
 // Close legend on outside tap
 document.addEventListener('click', e => {
 if (legend.classList.contains('mobile-open') &&
 !e.target.closest('#legend') && !e.target.closest('#btn-legend-mobile')) {
 legend.classList.remove('mobile-open');
 legendToggle.classList.remove('active');
 legendToggle.setAttribute('aria-expanded', 'false');
 }
 });
 }

 // ── Swipe-to-close Panel Gesture ──
 const studyPanel = document.getElementById('study-panel');
 let swipeStartX = 0, swipeStartY = 0, isSwiping = false;
 const SWIPE_THRESHOLD = 80; // px to trigger close
 const SWIPE_ANGLE_LIMIT = 30; // max degrees from horizontal

 studyPanel.addEventListener('touchstart', e => {
 if (!studyPanel.classList.contains('open')) return;
 const touch = e.touches[0];
 swipeStartX = touch.clientX;
 swipeStartY = touch.clientY;
 isSwiping = false;
 }, { passive: true });

 studyPanel.addEventListener('touchmove', e => {
 if (!studyPanel.classList.contains('open')) return;
 const touch = e.touches[0];
 const dx = touch.clientX - swipeStartX;
 const dy = touch.clientY - swipeStartY;
 // Only track horizontal swipes to the right
 if (!isSwiping && Math.abs(dx) > 15 && Math.abs(dy) < Math.abs(dx)) {
 isSwiping = true;
 }
 if (isSwiping && dx > 0) {
 // Visual feedback: translate panel proportionally
 const progress = Math.min(dx / (window.innerWidth * 0.5), 1);
 studyPanel.style.transition = 'none';
 studyPanel.style.transform = `translateX(${dx}px)`;
 studyPanel.style.opacity = 1 - progress * 0.3;
 }
 }, { passive: true });

 studyPanel.addEventListener('touchend', e => {
 if (!isSwiping) return;
 const touch = e.changedTouches[0];
 const dx = touch.clientX - swipeStartX;
 studyPanel.style.transition = '';
 studyPanel.style.opacity = '';
 if (dx > SWIPE_THRESHOLD) {
 // Close the panel
 closePanel();
 } else {
 // Snap back
 studyPanel.style.transform = '';
 }
 isSwiping = false;
 }, { passive: true });

 // ── Touch-friendly tooltip: show on tap, auto-hide ──
 // (tooltip is already handled by 3D raycast click, but we auto-dismiss it)
 let tooltipAutoHide = null;
 const origUpdateTooltip = window.updateTooltip || updateTooltip;
 // Auto-hide tooltip after 3 seconds on touch devices
 const _origUpdateTooltipRef = updateTooltip;
 // (handled in the tooltip function itself via touch detection)
 }
}

