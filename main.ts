// NIMBUS LEASH catalogue photo renderer. Node 22, no dependencies.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const OUT = 800;
const SS = 2;
const W = OUT * SS, H = OUT * SS;
const buf = new Float32Array(W * H * 3);

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// hash noise
function hash(x: number, y: number) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function blend(i: number, c: RGB, a: number) {
  if (a <= 0) return;
  const k = i * 3;
  buf[k] += (c[0] - buf[k]) * a; buf[k + 1] += (c[1] - buf[k + 1]) * a; buf[k + 2] += (c[2] - buf[k + 2]) * a;
}

// Draw a shape given in OUTPUT coordinates. sdf returns distance in output px (neg inside).
function shape(x0: number, y0: number, x1: number, y1: number, sdf: (x: number, y: number) => number,
  col: (x: number, y: number, d: number) => RGB, alpha = 1, soft = 0.6) {
  const X0 = Math.max(0, Math.floor(x0 * SS)), X1 = Math.min(W, Math.ceil(x1 * SS));
  const Y0 = Math.max(0, Math.floor(y0 * SS)), Y1 = Math.min(H, Math.ceil(y1 * SS));
  for (let Y = Y0; Y < Y1; Y++) for (let X = X0; X < X1; X++) {
    const x = (X + 0.5) / SS, y = (Y + 0.5) / SS;
    const d = sdf(x, y);
    const cov = clamp(0.5 - d / soft);
    if (cov <= 0) continue;
    blend(Y * W + X, col(x, y, d), cov * alpha);
  }
}
// darkening multiplier (shadows)
function shade(x0: number, y0: number, x1: number, y1: number, f: (x: number, y: number) => number) {
  const X0 = Math.max(0, Math.floor(x0 * SS)), X1 = Math.min(W, Math.ceil(x1 * SS));
  const Y0 = Math.max(0, Math.floor(y0 * SS)), Y1 = Math.min(H, Math.ceil(y1 * SS));
  for (let Y = Y0; Y < Y1; Y++) for (let X = X0; X < X1; X++) {
    const m = 1 - f((X + 0.5) / SS, (Y + 0.5) / SS);
    const k = (Y * W + X) * 3; buf[k] *= m; buf[k + 1] *= m; buf[k + 2] *= m * 1.01 > 1 ? 1 : m;
  }
}

const sdBox = (px: number, py: number, bx: number, by: number, r: number) => {
  const qx = Math.abs(px) - bx + r, qy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay));
  return Math.hypot(pax - bax * h, pay - bay * h);
};

// ---------- background: seamless sweep ----------
const bgTop = hex("#dcd8d2"), bgMid = hex("#ece9e4"), bgFloor = hex("#e4e0da");
for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
  const x = X / SS, y = Y / SS;
  let c: RGB = y < 560 ? mix(bgTop, bgMid, sstep(0, 560, y)) : mix(bgMid, bgFloor, sstep(560, 800, y));
  const vx = (x - 420) / 520, vy = (y - 430) / 560;
  const v = 1 - 0.10 * (vx * vx + vy * vy);
  const g = 1 + 0.012 * (hash(X, Y) - 0.5);
  const k = (Y * W + X) * 3;
  buf[k] = c[0] * v * g; buf[k + 1] = c[1] * v * g; buf[k + 2] = c[2] * v * g;
}

// ---------- layout ----------
const potX = 540, potBase = 660, potTopY = 548, potTopHW = 74, potBotHW = 56;
const cloudX = 520, cloudY = 225;
const hx = 235, hy = 585; // handle housing center
const rot = -0.18;
const cr = Math.cos(rot), sr = Math.sin(rot);
const toL = (x: number, y: number): [number, number] => { const dx = x - hx, dy = y - hy; return [dx * cr + dy * sr, -dx * sr + dy * cr]; };
const toW = (lx: number, ly: number): [number, number] => [hx + lx * cr - ly * sr, hy + lx * sr + ly * cr];
const nozzle = toW(92, -40);
const cordEnd: [number, number] = [cloudX - 70, cloudY + 62];

// ---------- contact shadows ----------
shade(potX - 160, potBase - 40, potX + 200, potBase + 50, (x, y) => {
  const dx = (x - potX - 18) / 110, dy = (y - potBase - 2) / 16; const r = Math.sqrt(dx * dx + dy * dy);
  const dx2 = (x - potX) / 62, dy2 = (y - potBase) / 6; const r2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
  return 0.22 * Math.exp(-r * r * 2.2) + 0.30 * Math.exp(-r2 * r2 * 3);
});
shade(hx - 200, hy, hx + 200, hy + 140, (x, y) => {
  const dx = (x - hx - 15) / 150, dy = (y - hy - 72) / 22; const r = Math.sqrt(dx * dx + dy * dy);
  const dx2 = (x - hx + 5) / 105, dy2 = (y - hy - 66) / 8; const r2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
  return 0.22 * Math.exp(-r * r * 2) + 0.33 * Math.exp(-r2 * r2 * 3);
});
// faint cloud shadow on the floor (diffuse)
shade(potX - 200, potBase - 30, potX + 220, potBase + 60, (x, y) => {
  const dx = (x - potX + 10) / 170, dy = (y - potBase - 6) / 34; return 0.06 * Math.exp(-(dx * dx + dy * dy) * 1.5);
});

// ---------- terracotta pot ----------
const terra = hex("#c0623b"), terraDark = hex("#7e3a20"), terraLight = hex("#e08a5f");
const potBody = (x: number, y: number) => {
  const t = clamp((y - potTopY) / (potBase - potTopY));
  const hw = potTopHW - 6 + (potBotHW - potTopHW + 6) * t;
  const dx = Math.abs(x - potX) - hw;
  const dyTop = potTopY + 14 - y, dyBot = y - potBase;
  return Math.max(dx * 0.98, dyTop, dyBot);
};
const potCol = (x: number, y: number): RGB => {
  const u = (x - potX) / potTopHW; // -1..1
  const l = clamp(0.55 + 0.55 * Math.cos((u + 0.35) * 1.5) - 0.25);
  let c = mix(terraDark, terra, sstep(0, 0.6, l));
  c = mix(c, terraLight, sstep(0.75, 1, l) * 0.6);
  const n = 0.04 * (vnoise(x * 0.4, y * 0.4) - 0.5) + 0.02 * (hash(Math.floor(x * 3), Math.floor(y * 3)) - 0.5);
  const ao = 1 - 0.25 * sstep(potBase - 25, potBase, y);
  const rimShadow = 1 - 0.35 * Math.exp(-Math.max(0, y - potTopY - 14) / 6);
  return [(c[0] + n) * ao * rimShadow, (c[1] + n) * ao * rimShadow, (c[2] + n) * ao * rimShadow];
};
shape(potX - 90, potTopY, potX + 90, potBase + 2, potBody, potCol);
// rim
const rimSdf = (x: number, y: number) => sdBox(x - potX, y - (potTopY + 8), potTopHW + 4, 13, 3);
shape(potX - 90, potTopY - 10, potX + 90, potTopY + 26, rimSdf, (x, y) => {
  const u = (x - potX) / (potTopHW + 4);
  const l = clamp(0.6 + 0.5 * Math.cos((u + 0.35) * 1.5) - 0.2);
  let c = mix(terraDark, terra, sstep(0, 0.6, l)); c = mix(c, terraLight, sstep(0.7, 1, l) * 0.7);
  const top = sstep(potTopY - 5, potTopY, y) * (1 - sstep(potTopY + 2, potTopY + 6, y));
  c = mix(c, terraLight, top * 0.5);
  const n = 0.03 * (vnoise(x * 0.5, y * 0.5) - 0.5);
  return [c[0] + n, c[1] + n, c[2] + n];
});
// soil (opening ellipse)
shape(potX - 80, potTopY - 12, potX + 80, potTopY + 12, (x, y) => {
  const dx = (x - potX) / (potTopHW), dy = (y - (potTopY - 1)) / 8; return (Math.sqrt(dx * dx + dy * dy) - 1) * 8;
}, (x, y) => { const n = vnoise(x * 0.8, y * 0.8); const c = hex("#3b2a20"); return mix(c, hex("#5a4232"), n * 0.7); });

// ---------- succulent rosette ----------
const leafA = hex("#4f8a5b"), leafB = hex("#9cc9a0"), leafTip = hex("#c7a0b5");
const sx = potX, sy = potTopY - 8;
const leaves: { a: number; len: number; w: number; ring: number }[] = [];
for (let ring = 0; ring < 3; ring++) {
  const n = [9, 7, 5][ring];
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i + 0.5 + ring * 0.33) / n * Math.PI * 2;
    leaves.push({ a, len: [62, 46, 28][ring], w: [17, 15, 12][ring], ring });
  }
}
// draw back leaves first (sin(a) < 0 means upward / back)
leaves.sort((p, q) => p.ring - q.ring || Math.sin(p.a) - Math.sin(q.a));
for (const L of leaves) {
  const flat = [0.42, 0.62, 0.85][L.ring];
  const ex = Math.cos(L.a) * L.len, ey = Math.sin(L.a) * L.len * flat - [0, 10, 20][L.ring];
  const ax = sx, ay = sy - [0, 4, 10][L.ring];
  const bx = sx + ex, by = sy + ey;
  shape(Math.min(ax, bx) - 25, Math.min(ay, by) - 25, Math.max(ax, bx) + 25, Math.max(ay, by) + 25, (x, y) => {
    const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
    const ll = bax * bax + bay * bay;
    const h = clamp((pax * bax + pay * bay) / ll);
    const d = Math.hypot(pax - bax * h, pay - bay * h);
    const wdt = L.w * Math.pow(Math.sin(Math.PI * Math.min(1, h * 0.85 + 0.08)), 0.7);
    return d - wdt;
  }, (x, y, d) => {
    const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
    const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay));
    const lit = clamp(0.5 - (y - (ay + by) / 2) / 40 + 0.15 * L.ring);
    let c = mix(leafA, leafB, lit * 0.8 + 0.1);
    c = mix(c, leafTip, sstep(0.75, 1, h) * 0.6);
    const edge = sstep(-5, 0, d);
    c = mix(c, mix(leafA, [0.15, 0.3, 0.2], 0.4), edge * 0.45);
    const mid = Math.exp(-Math.abs(d + L.w * 0.5) / 3) * 0.08;
    return [c[0] + mid, c[1] + mid, c[2] + mid];
  });
}

// ---------- rain streaks ----------
const rainCol = hex("#8aa3bd");
for (let i = 0; i < 70; i++) {
  const rx = potX - 70 + hash(i, 7) * 140 - 12;
  const ry0 = cloudY + 70 + hash(i, 11) * 200;
  const len = 14 + hash(i, 13) * 18;
  const ry1 = Math.min(ry0 + len, potTopY - 20 + hash(i, 3) * 25);
  if (ry1 <= ry0 + 3) continue;
  const slant = 0.10;
  const ax = rx, ay = ry0, bx = rx - (ry1 - ry0) * slant, by = ry1;
  shape(Math.min(ax, bx) - 3, ay - 3, Math.max(ax, bx) + 3, by + 3, (x, y) => sdSeg(x, y, ax, ay, bx, by) - 0.9,
    () => rainCol, 0.55 + 0.3 * hash(i, 5));
}
// a few droplets beaded on leaves
for (let i = 0; i < 9; i++) {
  const dxp = potX - 50 + hash(i, 21) * 100, dyp = potTopY - 30 + hash(i, 23) * 18, r = 2.4 + hash(i, 29) * 1.5;
  shape(dxp - 5, dyp - 5, dxp + 5, dyp + 5, (x, y) => Math.hypot(x - dxp, y - dyp) - r, (x, y) => {
    const s = Math.exp(-((x - dxp + r * 0.4) ** 2 + (y - dyp + r * 0.4) ** 2) / (r * 0.3));
    return mix(hex("#6f9a86"), [1, 1, 1], 0.3 + s * 0.7);
  }, 0.8);
}

// ---------- cord (taut) ----------
shape(Math.min(nozzle[0], cordEnd[0]) - 4, cordEnd[1] - 4, Math.max(nozzle[0], cordEnd[0]) + 4, nozzle[1] + 4,
  (x, y) => sdSeg(x, y, nozzle[0], nozzle[1], cordEnd[0], cordEnd[1]) - 1.6,
  (x, y) => { const d = sdSeg(x, y, nozzle[0], nozzle[1], cordEnd[0], cordEnd[1]); return mix(hex("#2e3238"), hex("#7a828c"), clamp(1 - d / 1.6) * 0.6); });
// little clip ring at the cloud
shape(cordEnd[0] - 9, cordEnd[1] - 9, cordEnd[0] + 9, cordEnd[1] + 9, (x, y) => Math.abs(Math.hypot(x - cordEnd[0], y - cordEnd[1]) - 5) - 1.8,
  (x, y) => mix(hex("#7d848c"), hex("#f1f3f5"), clamp(0.5 - (y - cordEnd[1]) / 8)));

// ---------- cloud ----------
const circles: [number, number, number][] = [];
const base: [number, number, number][] = [
  [-95, 25, 42], [-55, 10, 55], [0, -18, 72], [58, 0, 60], [102, 22, 44], [-20, 30, 50], [35, 32, 52], [-120, 40, 30], [128, 42, 30], [70, -35, 40], [-60, -25, 38],
];
for (const b of base) circles.push([cloudX + b[0], cloudY + b[1], b[2]]);
for (let i = 0; i < 40; i++) {
  const b = base[i % base.length];
  const a = hash(i, 91) * Math.PI * 2, rr = b[2] * (0.6 + 0.3 * hash(i, 93));
  circles.push([cloudX + b[0] + Math.cos(a) * rr, cloudY + b[1] + Math.sin(a) * rr * 0.8, b[2] * (0.25 + 0.2 * hash(i, 97))]);
}
const cloudBottom = cloudY + 62;
const cloudSdf = (x: number, y: number) => {
  let d = 1e9;
  for (const c of circles) d = Math.min(d, Math.hypot(x - c[0], y - c[1]) - c[2]);
  d = Math.max(d, y - cloudBottom);
  return d + 3 * (vnoise(x * 0.12, y * 0.12) - 0.5);
};
const cWhite = hex("#fbfcfd"), cGrey = hex("#9aa3ad"), cMid = hex("#d6dbe1");
shape(cloudX - 190, cloudY - 130, cloudX + 190, cloudBottom + 6, cloudSdf, (x, y) => {
  // highest sphere surface
  let best = -1e9, nx = 0, ny = 0, nz = 1;
  for (const c of circles) {
    const dx = x - c[0], dy = y - c[1], q = c[2] * c[2] - dx * dx - dy * dy;
    if (q <= 0) continue;
    const h = Math.sqrt(q) + c[2] * 0.3;
    if (h > best) { best = h; nx = dx / c[2]; ny = dy / c[2]; nz = Math.sqrt(q) / c[2]; }
  }
  if (best < -1e8) { nx = 0; ny = 0.5; nz = 0.8; }
  const lam = clamp(-0.45 * nx - 0.65 * ny + 0.6 * nz);
  let c = mix(cGrey, cMid, sstep(0.05, 0.5, lam)); c = mix(c, cWhite, sstep(0.45, 0.95, lam));
  const under = sstep(cloudY + 10, cloudBottom, y); c = mix(c, cGrey, under * 0.55);
  const fluff = 0.05 * (vnoise(x * 0.35, y * 0.35) - 0.5) + 0.03 * (vnoise(x * 0.9, y * 0.9) - 0.5);
  return [c[0] + fluff, c[1] + fluff, c[2] + fluff * 1.1];
}, 1, 1.6);

// ---------- leash handle ----------
const white = hex("#f6f6f4"), whiteShade = hex("#b9bcc0"), alu = hex("#c8ccd1"), aluDark = hex("#6e747b");
const housing = (lx: number, ly: number) => sdBox(lx, ly, 100, 62, 52);
const gripOuter = (lx: number, ly: number) => sdBox(lx + 150, ly + 8, 72, 40, 34);
const gripHole = (lx: number, ly: number) => sdBox(lx + 152, ly + 8, 50, 20, 18);
const handleSdf = (x: number, y: number) => {
  const [lx, ly] = toL(x, y);
  const grip = Math.max(gripOuter(lx, ly), -gripHole(lx, ly));
  return Math.min(housing(lx, ly), grip);
};
const plastic = (x: number, y: number, d: number): RGB => {
  const [lx, ly] = toL(x, y);
  // fake normal from sdf gradient near edge
  const e = 0.7;
  const gx = handleSdf(x + e, y) - handleSdf(x - e, y), gy = handleSdf(x, y + e) - handleSdf(x, y - e);
  const gl = Math.hypot(gx, gy) || 1;
  const bev = sstep(-22, 0, d);
  const nx = gx / gl * bev, ny = gy / gl * bev, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const lam = clamp(-0.4 * nx - 0.6 * ny + 0.7 * nz);
  let c = mix(whiteShade, white, sstep(0.2, 0.85, lam));
  c = mix(c, mix(whiteShade, white, 0.3), sstep(-20, 60, ly) * 0.35); // ground bounce / lower falloff
  // seam line on housing
  const [lx2, ly2] = [lx, ly];
  const seam = Math.exp(-Math.abs(housing(lx2, ly2) + 10) / 0.8) * 0.12 * (housing(lx2, ly2) < 0 ? 1 : 0);
  // specular
  const sp = Math.exp(-(((lx + 20) / 70) ** 2 + ((ly + 42) / 10) ** 2)) * 0.9 + Math.exp(-(((lx + 150) / 40) ** 2 + ((ly + 40) / 5) ** 2)) * 0.6;
  return [c[0] - seam + sp * 0.2, c[1] - seam + sp * 0.2, c[2] - seam + sp * 0.2];
};
shape(hx - 260, hy - 130, hx + 140, hy + 110, handleSdf, plastic);
// brushed aluminium band across housing front
const bandSdf = (x: number, y: number) => { const [lx, ly] = toL(x, y); return Math.max(housing(lx, ly) + 6, Math.abs(lx - 66) - 11); };
const brushed = (x: number, y: number): RGB => {
  const [lx, ly] = toL(x, y);
  const g = 0.5 + 0.5 * Math.sin(ly * 0.05 + 0.6);
  let c = mix(aluDark, alu, 0.45 + 0.5 * g);
  const br = 0.06 * (vnoise(lx * 0.08, ly * 3) - 0.5);
  const sp = Math.exp(-(((ly + 25) / 9) ** 2)) * 0.25;
  return [c[0] + br + sp, c[1] + br + sp, c[2] + br + sp];
};
shape(hx - 20, hy - 110, hx + 140, hy + 110, bandSdf, brushed);
// nozzle (aluminium) at top-right
const nozSdf = (x: number, y: number) => { const [lx, ly] = toL(x, y); return sdBox(lx - 88, ly + 50, 12, 14, 5); };
shape(hx + 40, hy - 100, hx + 130, hy - 10, nozSdf, (x, y) => { const [lx] = toL(x, y); return mix(aluDark, hex("#eef0f2"), clamp(0.5 - (lx - 88) / 14)); });
// thumb brake button on top (aluminium)
const btnSdf = (x: number, y: number) => { const [lx, ly] = toL(x, y); return sdBox(lx + 10, ly + 63, 30, 9, 8); };
shape(hx - 70, hy - 100, hx + 50, hy - 40, btnSdf, (x, y) => { const [, ly] = toL(x, y); return mix(hex("#eef0f2"), aluDark, clamp((ly + 68) / 14)); });
// tiny blue status LED (it's a smart cloud leash)
{ const [lx0, ly0] = [-70, -30]; const p = toW(lx0, ly0);
  shape(p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6, (x, y) => Math.hypot(x - p[0], y - p[1]) - 3.2, (x, y) => mix(hex("#2f7fd8"), hex("#cfe6ff"), Math.exp(-((x - p[0] + 1) ** 2 + (y - p[1] + 1) ** 2) / 2))); }

// ---------- label text (5x7 pixel font) ----------
const FONT: Record<string, string[]> = {
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "-": ["000", "000", "000", "111", "000", "000", "000"],
  "1": ["010", "110", "010", "010", "010", "010", "111"],
  " ": ["00", "00", "00", "00", "00", "00", "00"],
};
function text(str: string, lx0: number, ly0: number, px: number, col: RGB, alpha: number) {
  let cx = lx0;
  const glyphs = str.split("").map((ch) => FONT[ch]);
  for (const g of glyphs) {
    for (let r = 0; r < 7; r++) for (let c = 0; c < g[r].length; c++) {
      if (g[r][c] !== "1") continue;
      const qx = cx + c * px + px / 2, qy = ly0 + r * px + px / 2;
      const p = toW(qx, qy);
      shape(p[0] - px, p[1] - px, p[0] + px, p[1] + px, (x, y) => { const [lx, ly] = toL(x, y); return sdBox(lx - qx, ly - qy, px * 0.52, px * 0.52, px * 0.15); }, () => col, alpha);
    }
    cx += (g[0].length + 1) * px;
  }
}
text("NIMBUS", -72, -12, 3.6, hex("#2b2f35"), 0.92);
text("CL-1", -50, 22, 1.8, hex("#8a8f96"), 0.9);

// ---------- downsample + encode ----------
const px = Buffer.alloc((OUT * 3 + 1) * OUT);
for (let y = 0; y < OUT; y++) {
  px[y * (OUT * 3 + 1)] = 0;
  for (let x = 0; x < OUT; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) s += buf[((y * SS + j) * W + x * SS + i) * 3 + ch];
    const v = clamp(s / (SS * SS));
    px[y * (OUT * 3 + 1) + 1 + x * 3 + ch] = Math.round(Math.pow(v, 1) * 255);
  }
}
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUT, 0); ihdr.writeUInt32BE(OUT, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr), chunk("IDAT", deflateSync(px, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
]);
const outPath = process.argv[2] || "/output/entry.png";
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes)`);
