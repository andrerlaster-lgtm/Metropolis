// Flow fields for the battlefield: one search outward from a goal gives every tile its walking
// distance to it, and anyone heading there just steps to the neighbour that is closest. One field
// serves every soldier with the same goal (the pattern from djpav/threejs-tower-defense's distance
// field and openage's flow fields; our own code). Eight directions, never cutting a blocked corner.

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

// blocked(x, y) → true where nobody can walk; goals: [{ x, y }] tiles at distance 0;
// cost(x, y) → extra cost of stepping onto a tile (default 0).
export function buildField(w, h, blocked, goals, cost = null) {
  const n = w * h;
  const dist = new Float32Array(n).fill(Infinity);
  const heapK = new Int32Array(n * 8 + 8);
  const heapP = new Float32Array(n * 8 + 8);
  let size = 0;
  const push = (k, p) => {
    let i = size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapP[parent] <= p) break;
      heapK[i] = heapK[parent];
      heapP[i] = heapP[parent];
      i = parent;
    }
    heapK[i] = k;
    heapP[i] = p;
  };
  const pop = () => {
    const k = heapK[0];
    const p = heapP[0];
    const lk = heapK[--size];
    const lp = heapP[size];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= size) break;
      if (c + 1 < size && heapP[c + 1] < heapP[c]) c++;
      if (heapP[c] >= lp) break;
      heapK[i] = heapK[c];
      heapP[i] = heapP[c];
      i = c;
    }
    heapK[i] = lk;
    heapP[i] = lp;
    popP = p;
    return k;
  };
  let popP = 0;
  const open = (x, y) => x >= 0 && y >= 0 && x < w && y < h && !blocked(x, y);
  for (const g of goals) {
    if (!open(g.x, g.y)) continue;
    const k = g.y * w + g.x;
    if (dist[k] === 0) continue;
    dist[k] = 0;
    push(k, 0);
  }
  while (size > 0) {
    const k = pop();
    const d = popP;
    if (d > dist[k]) continue;
    const x = k % w;
    const y = (k - x) / w;
    for (const [dx, dy, step] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!open(nx, ny)) continue;
      if (dx && dy && (!open(x + dx, y) || !open(x, y + dy))) continue;
      const nk = ny * w + nx;
      const nd = d + step + (cost ? cost(nx, ny) : 0);
      if (nd < dist[nk]) {
        dist[nk] = nd;
        push(nk, nd);
      }
    }
  }
  return { w, h, dist, blocked };
}

export function distanceAt(field, x, y) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= field.w || ty >= field.h) return Infinity;
  return field.dist[ty * field.w + tx];
}

// The neighbouring tile to head for from tile (x, y): the closest to the goal, or null at the goal
// or when there's no way there.
export function nextTile(field, x, y) {
  const { w, h, dist, blocked } = field;
  const here = y * w + x;
  let best = dist[here];
  if (best === 0) return null;
  let out = null;
  const open = (cx, cy) => cx >= 0 && cy >= 0 && cx < w && cy < h && !blocked(cx, cy);
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!open(nx, ny)) continue;
    if (dx && dy && (!open(x + dx, y) || !open(x, y + dy))) continue;
    const d = dist[ny * w + nx];
    if (d < best) {
      best = d;
      out = { x: nx, y: ny };
    }
  }
  return out;
}
