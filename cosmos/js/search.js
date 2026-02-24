// ═══════════════════════════════════════════
// §6 - SEARCH ENGINE
// ═══════════════════════════════════════════
function extractScriptureRefs(text) {
 const pattern = /(\d?\s?[A-Z][a-z]+\.?\s+\d+(?:\d+(?:[–-]\d+)?)?(?:,\s*\d+(?:\d+(?:[–-]\d+)?)?)*)/g;
 const allMatches = (text.match(pattern) || []).map(r => r.trim());
 // Filter out any confessional-looking refs that might slip through
 return allMatches.filter(r => !/^(?:WCF|WLC|WSC)\b/i.test(r));
}

// ── Confessional Standards Extraction ──
// Captures WCF, WLC, WSC references (e.g., "WCF 8.5", "WLC Q101", "WSC Q1")
// These are <i>norma normata</i> and must be displayed separately from Scripture (<i>norma normans</i>).
function extractConfessionalRefs(text) {
 const pattern = /\b((?:WCF|WLC|WSC)\s+Q?\d+(?:\.\d+)?(?:\s*[,–-]\s*Q?\d+(?:\.\d+)?)*)/g;
 const matches = [];
 let m;
 while ((m = pattern.exec(text)) !== null) {
 matches.push(m[1].trim());
 }
 // Deduplicate
 return [...new Set(matches)];
}

// Extract the first sentence for the summary view.
// Handles parenthetical scripture references like "(Gen 2:7; WCF 4.2)."
function extractFirstSentence(text) {
 if (!text) return '';
 // Match a period followed by a space (or end), but not inside parentheses
 // Strategy: walk character by character, track paren depth
 let depth = 0;
 for (let i = 0; i < text.length; i++) {
 if (text[i] === '(') depth++;
 else if (text[i] === ')') depth = Math.max(0, depth - 1);
 else if (text[i] === '.' && depth === 0) {
 // Check it's a sentence-ending period: followed by space, paren-close+space, or end
 const after = text[i + 1];
 if (!after || after === ' ' || after === '\n') {
 return text.substring(0, i + 1).trim();
 }
 }
 }
 // Fallback: if no clean sentence break, return first ~120 chars with ellipsis
 if (text.length > 140) {
 const cut = text.lastIndexOf(' ', 130);
 return text.substring(0, cut > 60 ? cut : 130) + '…';
 }
 return text;
}

function fuzzyMatch(query, text) {
 query = query.toLowerCase();
 text = text.toLowerCase();
 if (text.includes(query)) return 1.0;
 // Simple prefix match
 const words = text.split(/\s+/);
 for (const word of words) {
 if (word.startsWith(query)) return 0.8;
 }
 // Levenshtein for short queries
 if (query.length <= 12) {
 for (const word of words) {
 const dist = levenshtein(query, word.substring(0, query.length + 2));
 if (dist <= Math.max(1, Math.floor(query.length / 4))) return 0.6;
 }
 }
 return 0;
}

function levenshtein(a, b) {
 return levenshteinPooled(a, b);
}

function searchNodes(query) {
 if (!query || query.length < 2) return [];
 const q = query.toLowerCase().trim();
 const results = [];

 nodeIndex.forEach((data, id) => {
 let score = 0;
 const name = data.n || '';
 const desc = data.d || '';
 const keywords = (data.k || []).join(' ');

 // Title match (highest weight)
 const titleScore = fuzzyMatch(q, name);
 if (titleScore > 0) score += titleScore * 100;

 // Keyword match
 const kwScore = fuzzyMatch(q, keywords);
 if (kwScore > 0) score += kwScore * 40;

 // Description match
 if (desc.toLowerCase().includes(q)) score += 20;

 // Scripture reference match
 if (desc.toLowerCase().includes(q.replace(/\s+/g, ' '))) score += 15;

 // Boost loci over subtopics
 if (data.type === 'locus') score *= 1.3;

 if (score > 0) {
 results.push({ id, data, score });
 }
 });

 results.sort((a, b) => b.score - a.score);
 return results.slice(0, 12);
}

// ═══════════════════════════════════════════
// §6b - SPATIAL INDEX (Octree + Adjacency)
// Accelerates raycasting from O(n) to O(log n),
// connection lookups from O(e) to O(1),
// and enables frustum culling for 200+ nodes.
// ═══════════════════════════════════════════

/**
 * Octree - Loose octree for 3D spatial queries.
 *
 * Design choices:
 * - "Loose" factor of 1.5× so spheres that straddle boundaries aren't
 * duplicated across children - each node lives in exactly one octant.
 * - Max depth of 8 prevents degenerate subdivision on clustered data.
 * - Leaf capacity of 8 balances tree depth vs. brute-force at leaves.
 * - Statically built after layout (nodes don't move), so no rebalancing.
 *
 * Public API:
 * build(items) - items: [{ pos: Vector3, radius: number, id, mesh, ... }]
 * raycast(origin, dir, maxDist) → sorted [{item, dist}]
 * queryFrustum(frustum) → [item, ...] (items inside camera frustum)
 * querySphere(center, r) → [item, ...] (items within radius)
 */
class Octree {
 constructor() {
 this.root = null;
 this._resultPool = []; // reusable results array
 this._vec = null; // lazy - set once THREE is loaded
 }

 build(items) {
 if (!items.length) return;
 if (!this._vec) this._vec = new THREE.Vector3();

 // Compute tight AABB around all item bounding spheres
 let minX = Infinity, minY = Infinity, minZ = Infinity;
 let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
 for (let i = 0; i < items.length; i++) {
 const p = items[i].pos, r = items[i].radius || 0;
 if (p.x - r < minX) minX = p.x - r;
 if (p.y - r < minY) minY = p.y - r;
 if (p.z - r < minZ) minZ = p.z - r;
 if (p.x + r > maxX) maxX = p.x + r;
 if (p.y + r > maxY) maxY = p.y + r;
 if (p.z + r > maxZ) maxZ = p.z + r;
 }

 // Pad to cube (octree requires cubic bounds)
 const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
 const halfSize = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 1;

 this.root = this._createNode(cx, cy, cz, halfSize);
 for (let i = 0; i < items.length; i++) {
 this._insert(this.root, items[i], 0);
 }
 }

 _createNode(cx, cy, cz, half) {
 return { cx, cy, cz, half, items: [], children: null };
 }

 _insert(node, item, depth) {
 // If leaf and under capacity, or at max depth, store here
 if (!node.children && (node.items.length < 8 || depth >= 8)) {
 node.items.push(item);
 return;
 }
 // Subdivide if not already
 if (!node.children) {
 node.children = new Array(8);
 const h2 = node.half / 2;
 for (let i = 0; i < 8; i++) {
 node.children[i] = this._createNode(
 node.cx + ((i & 1) ? h2 : -h2),
 node.cy + ((i & 2) ? h2 : -h2),
 node.cz + ((i & 4) ? h2 : -h2),
 h2
 );
 }
 // Re-insert existing items
 const existing = node.items;
 node.items = [];
 for (let i = 0; i < existing.length; i++) {
 this._insert(node, existing[i], depth);
 }
 }
 // Find best-fit octant (by center position)
 const octant = this._octantFor(node, item.pos);
 this._insert(node.children[octant], item, depth + 1);
 }

 _octantFor(node, pos) {
 return (pos.x > node.cx ? 1 : 0)
 | (pos.y > node.cy ? 2 : 0)
 | (pos.z > node.cz ? 4 : 0);
 }

 /**
 * Raycast - find items whose bounding spheres intersect the ray.
 * Returns array of {item, dist} sorted by distance.
 * Uses ray-AABB slab test to prune entire octants.
 */
 raycast(origin, direction, maxDist = Infinity) {
 const results = this._resultPool;
 results.length = 0;
 if (!this.root) return results;

 // Precompute inverse direction for slab test
 const invDx = direction.x !== 0 ? 1 / direction.x : 1e12;
 const invDy = direction.y !== 0 ? 1 / direction.y : 1e12;
 const invDz = direction.z !== 0 ? 1 / direction.z : 1e12;

 this._raycastNode(this.root, origin, direction, invDx, invDy, invDz, maxDist, results);
 results.sort((a, b) => a.dist - b.dist);
 return results;
 }

 _raycastNode(node, origin, dir, invDx, invDy, invDz, maxDist, results) {
 // Ray-AABB slab intersection (with loose factor 1.5×)
 const looseHalf = node.half * 1.5;
 const t1x = (node.cx - looseHalf - origin.x) * invDx;
 const t2x = (node.cx + looseHalf - origin.x) * invDx;
 const t1y = (node.cy - looseHalf - origin.y) * invDy;
 const t2y = (node.cy + looseHalf - origin.y) * invDy;
 const t1z = (node.cz - looseHalf - origin.z) * invDz;
 const t2z = (node.cz + looseHalf - origin.z) * invDz;

 const tmin = Math.max(Math.min(t1x, t2x), Math.min(t1y, t2y), Math.min(t1z, t2z));
 const tmax = Math.min(Math.max(t1x, t2x), Math.max(t1y, t2y), Math.max(t1z, t2z));

 if (tmax < 0 || tmin > tmax || tmin > maxDist) return;

 // Test items at this node
 for (let i = 0; i < node.items.length; i++) {
 const item = node.items[i];
 // Minimum hit radius of 0.9 ensures small sub-topic nodes are hoverable/clickable
 const visualR = item.radius * item.mesh.scale.x;
 const hitR = Math.max(visualR, 0.9);
 const d = this._raySphereIntersect(origin, dir, item.pos, hitR);
 if (d >= 0 && d <= maxDist) {
 results.push({ item, dist: d });
 }
 }

 // Recurse children
 if (node.children) {
 for (let i = 0; i < 8; i++) {
 this._raycastNode(node.children[i], origin, dir, invDx, invDy, invDz, maxDist, results);
 }
 }
 }

 /**
 * Ray-sphere intersection. Returns distance or -1 if no hit.
 * Analytic solution - no allocations.
 */
 _raySphereIntersect(origin, dir, center, radius) {
 const ocX = origin.x - center.x;
 const ocY = origin.y - center.y;
 const ocZ = origin.z - center.z;
 const b = ocX * dir.x + ocY * dir.y + ocZ * dir.z;
 const c = ocX * ocX + ocY * ocY + ocZ * ocZ - radius * radius;
 const disc = b * b - c;
 if (disc < 0) return -1;
 const sqrtDisc = Math.sqrt(disc);
 const t0 = -b - sqrtDisc;
 const t1 = -b + sqrtDisc;
 if (t1 < 0) return -1;
 return t0 >= 0 ? t0 : t1;
 }

 /**
 * Frustum query - returns all items inside the camera frustum.
 * Used for culling node updates to only visible nodes.
 */
 queryFrustum(frustum) {
 const results = [];
 if (!this.root) return results;
 this._frustumNode(this.root, frustum, results);
 return results;
 }

 _frustumNode(node, frustum, results) {
 // Test AABB against frustum (conservative - uses loose bounds)
 const looseHalf = node.half * 1.5;
 const box = Octree._tmpBox;
 box.min.set(node.cx - looseHalf, node.cy - looseHalf, node.cz - looseHalf);
 box.max.set(node.cx + looseHalf, node.cy + looseHalf, node.cz + looseHalf);
 if (!frustum.intersectsBox(box)) return;

 for (let i = 0; i < node.items.length; i++) {
 const item = node.items[i];
 Octree._tmpSphere.center.copy(item.pos);
 Octree._tmpSphere.radius = item.radius * 2; // generous
 if (frustum.intersectsSphere(Octree._tmpSphere)) {
 results.push(item);
 }
 }

 if (node.children) {
 for (let i = 0; i < 8; i++) {
 this._frustumNode(node.children[i], frustum, results);
 }
 }
 }

 /**
 * Sphere query - all items within distance r of center.
 * Useful for proximity-based LOD or click tolerance.
 */
 querySphere(center, r) {
 const results = [];
 if (!this.root) return results;
 this._sphereNode(this.root, center, r, r * r, results);
 return results;
 }

 _sphereNode(node, center, r, r2, results) {
 // Quick reject: sphere vs AABB
 const looseHalf = node.half * 1.5;
 const dx = Math.max(0, Math.abs(center.x - node.cx) - looseHalf);
 const dy = Math.max(0, Math.abs(center.y - node.cy) - looseHalf);
 const dz = Math.max(0, Math.abs(center.z - node.cz) - looseHalf);
 if (dx * dx + dy * dy + dz * dz > r2) return;

 for (let i = 0; i < node.items.length; i++) {
 const item = node.items[i];
 const distSq = (center.x - item.pos.x) ** 2
 + (center.y - item.pos.y) ** 2
 + (center.z - item.pos.z) ** 2;
 if (distSq <= (r + item.radius) ** 2) {
 results.push(item);
 }
 }

 if (node.children) {
 for (let i = 0; i < 8; i++) {
 this._sphereNode(node.children[i], center, r, r2, results);
 }
 }
 }
}

// Shared temp objects (avoids per-call allocation)
Octree._tmpBox = null; // set after THREE loads
Octree._tmpSphere = null;

/**
 * EdgeAdjacency - O(1) neighbor lookups for edge highlighting.
 * Replaces linear scans of the edge array on every hover.
 *
 * adjacency.get(nodeId) → Set<nodeId> (all connected nodes)
 * edgesByNode.get(nodeId) → [edgeIndex] (indices into edge array)
 */
class EdgeAdjacency {
 constructor() {
 this.neighbors = new Map(); // nodeId → Set<nodeId>
 this.edgesByNode = new Map(); // nodeId → [edgeIdx]
 }

 build(edges) {
 this.neighbors.clear();
 this.edgesByNode.clear();

 for (let i = 0; i < edges.length; i++) {
 const e = edges[i];
 // neighbors
 if (!this.neighbors.has(e.from)) this.neighbors.set(e.from, new Set());
 if (!this.neighbors.has(e.to)) this.neighbors.set(e.to, new Set());
 this.neighbors.get(e.from).add(e.to);
 this.neighbors.get(e.to).add(e.from);
 // edge indices
 if (!this.edgesByNode.has(e.from)) this.edgesByNode.set(e.from, []);
 if (!this.edgesByNode.has(e.to)) this.edgesByNode.set(e.to, []);
 this.edgesByNode.get(e.from).push(i);
 this.edgesByNode.get(e.to).push(i);
 }
 }

 /** All nodes connected to nodeId (O(1) lookup) */
 getConnected(nodeId) {
 const set = this.neighbors.get(nodeId);
 if (!set) return Octree._emptySet;
 return set;
 }

 /** Build the full "highlight set" for a node: itself + all neighbors */
 getHighlightSet(nodeId) {
 const result = new Set();
 result.add(nodeId);
 const nbrs = this.neighbors.get(nodeId);
 if (nbrs) nbrs.forEach(n => result.add(n));
 return result;
 }
}

// Shared empty set for missing lookups
Octree._emptySet = new Set();

