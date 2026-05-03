// Matter.js globals
let Engine, World, Bodies, Body;

let socket;
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/canvas-photo/socket.io" });
} else {
  socket = io();
}

function getUserId() {
  let id = localStorage.getItem("user-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("user-id", id);
  }
  return id;
}
const myUserId = getUserId();

const ROWS = 20;
const ROW_SPACING = 18;
const START_Y = 60;
const MAX_CHAINS = 20;

function colSpacing() {
  return windowWidth / MAX_CHAINS;
}
function slotX(slot) {
  return colSpacing() / 2 + slot * colSpacing();
}

// ── State ─────────────────────────────────────────────────────────────────────
let engine, world, ground;
let chains = []; // hanging chain objects
let fallenBodies = []; // ALL fallen beads, flat — no per-chain split
let pendingBreaks = [];
let chainPalettes = {}; // chainIndex → [[r,g,b],...]
let remotetouchs = {};
let draggingPoint = null;

const interactRadius = 50;
const breakThreshold = 2.2;
let lasttouchSend = 0;
let lastBeadSave = 0;

// ── p5 ready queue ────────────────────────────────────────────────────────────
let p5Ready = false;
let pendingChainsInit = null;
let pendingChainsAppend = [];
let pendingFallenBeads = null;

// ── Color extraction ──────────────────────────────────────────────────────────
function extractColors(imgEl, n) {
  const SIZE = 64;
  const off = document.createElement("canvas");
  off.width = off.height = SIZE;
  const ctx = off.getContext("2d");
  ctx.drawImage(imgEl, 0, 0, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

  let pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const br = (r + g + b) / 3;
    if (br > 20 && br < 240) pixels.push([r, g, b]);
  }
  if (!pixels.length) pixels = [[128, 128, 128]];

  function medianCut(px, depth) {
    if (depth === 0 || !px.length) {
      // Pick most-saturated pixel instead of averaging
      let best = px[0] || [128, 128, 128],
        bestSat = -1;
      for (const p of px) {
        const max = Math.max(...p),
          min = Math.min(...p);
        const sat = max ? (max - min) / max : 0;
        if (sat > bestSat) {
          bestSat = sat;
          best = p;
        }
      }
      return [best];
    }
    let minR = 255,
      maxR = 0,
      minG = 255,
      maxG = 0,
      minB = 255,
      maxB = 0;
    for (const p of px) {
      if (p[0] < minR) minR = p[0];
      if (p[0] > maxR) maxR = p[0];
      if (p[1] < minG) minG = p[1];
      if (p[1] > maxG) maxG = p[1];
      if (p[2] < minB) minB = p[2];
      if (p[2] > maxB) maxB = p[2];
    }
    const ranges = [maxR - minR, maxG - minG, maxB - minB];
    const ch = ranges.indexOf(Math.max(...ranges));
    px.sort((a, b) => a[ch] - b[ch]);
    const mid = Math.floor(px.length / 2);
    return [
      ...medianCut(px.slice(0, mid), depth - 1),
      ...medianCut(px.slice(mid), depth - 1),
    ];
  }

  return medianCut(pixels, Math.ceil(Math.log2(n))).slice(0, n);
}

function showPhotoPicker(onDone) {
  const overlay = document.getElementById("photo-overlay");
  const input = document.getElementById("photo-input");
  const previewArea = document.getElementById("preview-area");
  const previewImg = document.getElementById("preview-img");
  const swatches = document.getElementById("swatches");
  const finishBtn = document.getElementById("finish-btn");

  previewArea.style.display = "none";
  swatches.innerHTML = "";
  finishBtn.disabled = true;
  overlay.classList.remove("hidden");

  let currentPalette = null;
  input.value = "";

  input.onchange = async function () {
    const file = input.files[0];
    if (!file) return;
    const isHeic =
      /\.(heic|heif)$/i.test(file.name) ||
      ["image/heic", "image/heif"].includes(file.type);
    let blobUrl;
    if (isHeic && typeof heic2any !== "undefined") {
      try {
        const blob = await heic2any({
          blob: file,
          toType: "image/jpeg",
          quality: 0.85,
        });
        blobUrl = URL.createObjectURL(Array.isArray(blob) ? blob[0] : blob);
      } catch {
        blobUrl = URL.createObjectURL(file);
      }
    } else {
      blobUrl = URL.createObjectURL(file);
    }
    previewImg.onload = function () {
      currentPalette = extractColors(previewImg, 5);
      swatches.innerHTML = "";
      for (const rgb of currentPalette) {
        const d = document.createElement("div");
        d.className = "swatch";
        d.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        swatches.appendChild(d);
      }
      previewArea.style.display = "flex";
      finishBtn.disabled = false;
    };
    previewImg.src = blobUrl;
  };

  finishBtn.onclick = function () {
    if (!currentPalette) return;
    overlay.classList.add("hidden");
    onDone(currentPalette);
  };
}

function makeSeed(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function beadAppearance(chainIndex, hue, row, seed) {
  const rng = makeSeed(seed + row * 4);
  const type = Math.floor(rng() * 3);
  const size = 10 + rng() * 8;
  const palette = chainPalettes[chainIndex];
  let rgb;
  if (palette && palette.length >= 5) {
    const base = palette[row % 5];
    const v = makeSeed(seed + row * 4 + 1);
    const jitter = (v() - 0.5) * 20;
    rgb = base.map((c) => Math.min(255, Math.max(0, Math.round(c + jitter))));
  } else {
    rgb = [150, 150, 150];
  }
  return { type, size, rgb };
}

function setup() {
  ({ Engine, World, Bodies, Body } = Matter);
  createCanvas(windowWidth, windowHeight).parent("p5-canvas-container");
  rectMode(CENTER);
  engine = Engine.create();
  world = engine.world;
  rebuildGround();

  p5Ready = true;
  if (pendingChainsInit) {
    rebuildChains(pendingChainsInit);
    pendingChainsInit = null;
  }
  if (pendingFallenBeads) {
    restoreFallenBeads(pendingFallenBeads);
    pendingFallenBeads = null;
  }
  for (const sd of pendingChainsAppend) appendChains([sd]);
  pendingChainsAppend = [];
}

function draw() {
  background(252);
  broadcastTouch();
  maybeSaveBeads();
  updateChain();
  Engine.update(engine);
  drawCurtain();
}

function rebuildGround() {
  if (ground) World.remove(world, ground);
  ground = Bodies.rectangle(width / 2, height - 40, width * 4, 60, {
    isStatic: true,
  });
  World.add(world, ground);
}

// ── Chain building ────────────────────────────────────────────────────────────
function rebuildChains(serverChains) {
  // Remove hanging bead physics (fallenBodies are independent — don't remove)
  for (const st of chains) removeChainPhysics(st);
  chains = [];
  resizeCanvas(windowWidth, windowHeight);
  rebuildGround();

  for (const sd of serverChains) {
    const chain = buildChain(
      sd.chainIndex,
      sd.slot, // 这里直接用了后端传来的固定 slot
      sd.userId,
      sd.hue,
      sd.seed || 0,
    );
    for (const row of [...sd.breaks].sort((a, b) => a - b))
      applyChainBreak(chain, row, true);
    if (sd.breaks.includes(1)) chain.fullyBroken = true;
    chains.push(chain);
  }
}

function restoreFallenBeads(savedBeads) {
  for (const b of fallenBodies) World.remove(world, b);
  fallenBodies = [];
  for (const saved of savedBeads) {
    const bead = makeFallenBody(
      saved.x,
      windowHeight - saved.yFromBottom,
      saved.renderData,
      saved.angle,
      saved.vx || 0,
      saved.vy || 0,
    );
    fallenBodies.push(bead);
  }
}

function appendChains(newChainData) {
  for (const sd of newChainData) {
    if (chains.find((s) => s.chainIndex === sd.chainIndex)) continue;
    if (sd.palette?.length) chainPalettes[sd.chainIndex] = sd.palette;
    chains.push(
      buildChain(sd.chainIndex, sd.slot, sd.userId, sd.hue, sd.seed || 0),
    );
  }
}

function buildChain(chainIndex, slot, userId, hue, seed) {
  const cx = slotX(slot);
  const rng = makeSeed(seed + 999999);
  const pts = [],
    stks = [];

  for (let r = 0; r <= ROWS; r++) {
    const b = beadAppearance(chainIndex, hue, r, seed);
    pts.push({
      x: cx,
      y: r * ROW_SPACING + START_Y,
      oldX: cx,
      oldY: r * ROW_SPACING + START_Y,
      pinned: r === 0,
      active: true,
      row: r,
      type: b.type,
      size: b.size,
      rgb: b.rgb,
    });
  }
  for (let r = 0; r < ROWS; r++)
    stks.push({
      p1: pts[r],
      p2: pts[r + 1],
      len: ROW_SPACING * (0.8 + rng() * 0.6),
      active: true,
    });

  return {
    chainIndex,
    slot,
    userId,
    hue,
    seed,
    points: pts,
    sticks: stks,
    brokenRows: new Set(),
    fullyBroken: false,
  };
}

function removeChainPhysics() {
  /* points are Verlet — no Matter bodies to remove */
}

// ── Fallen bead helpers ───────────────────────────────────────────────────────
function makeFallenBody(x, y, renderData, angle, vx, vy) {
  const bead = Bodies.circle(x, y, renderData.size / 2, {
    restitution: 0.5,
    friction: 0.3,
  });
  bead.renderData = renderData;
  Body.setAngle(bead, angle);
  Body.setVelocity(bead, { x: vx, y: vy });
  World.add(world, bead);
  return bead;
}

// ── Touch broadcast ───────────────────────────────────────────────────────────
function broadcastTouch() {
  if (millis() - lasttouchSend < 33) return;
  lasttouchSend = millis();
  const tx = touches.length ? touches[0].x : mouseX;
  const ty = touches.length ? touches[0].y : mouseY;
  socket.emit("touch-move", {
    x: tx,
    y: ty,
    pressing: mouseIsPressed || touches.length > 0,
    userId: myUserId,
  });
}

// ── Save fallen beads ─────────────────────────────────────────────────────────
function maybeSaveBeads() {
  if (millis() - lastBeadSave < 5000) return;
  lastBeadSave = millis();
  saveFallenBeads();
}

function saveFallenBeads() {
  const snapshot = fallenBodies.map((b) => ({
    x: b.position.x,
    yFromBottom: windowHeight - b.position.y,
    angle: b.angle,
    vx: b.velocity.x,
    vy: b.velocity.y,
    renderData: b.renderData,
  }));
  socket.emit("fallen-beads-update", snapshot);
}

// ── Chain update ──────────────────────────────────────────────────────────────
function updateChain() {
  const gravity = 0.6,
    friction = 0.98;
  for (const st of chains) {
    for (const p of st.points) {
      if (!p.active || p.pinned) continue;
      const vx = (p.x - p.oldX) * friction;
      const vy = (p.y - p.oldY) * friction;
      p.oldX = p.x;
      p.oldY = p.y;
      p.x += vx;
      p.y += vy + gravity;
    }
    // Lock top bead every frame
    const top = st.points[0];
    if (top) {
      const cx = slotX(st.slot);
      top.x = cx;
      top.oldX = cx;
      top.y = START_Y;
      top.oldY = START_Y;
    }
  }
  handleInteractions();
  solveConstraints();

  if (pendingBreaks.length) {
    const tx = touches.length ? touches[0].x : mouseX;
    const ty = touches.length ? touches[0].y : mouseY;
    pendingBreaks.sort((a, b) => {
      const s1 = a.chain.sticks[a.si],
        s2 = b.chain.sticks[b.si];
      if (!s1 || !s2) return 0;
      return (
        dist(tx, ty, (s1.p1.x + s1.p2.x) / 2, (s1.p1.y + s1.p2.y) / 2) -
        dist(tx, ty, (s2.p1.x + s2.p2.x) / 2, (s2.p1.y + s2.p2.y) / 2)
      );
    });
    const best = pendingBreaks[0];
    const s = best.chain.sticks[best.si];
    if (s?.active) {
      const row = s.p2.row;
      s.active = false;
      applyChainBreak(best.chain, row, false);
      socket.emit("chain-break", { chainIndex: best.chain.chainIndex, row });
    }
    pendingBreaks = [];
  }
}

function solveConstraints() {
  const tx = touches.length ? touches[0].x : mouseX;
  const ty = touches.length ? touches[0].y : mouseY;
  const isInteracting = mouseIsPressed || touches.length > 0;

  let nearestChain = null,
    nearestDist = Infinity;
  if (isInteracting) {
    for (const st of chains)
      for (const p of st.points) {
        if (!p.active) continue;
        const d = dist(tx, ty, p.x, p.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearestChain = st;
        }
      }
  }

  pendingBreaks = [];
  for (const st of chains) {
    for (let iter = 0; iter < 15; iter++) {
      for (let j = 0; j < st.sticks.length; j++) {
        const s = st.sticks[j];
        if (!s.active) continue;
        const dx = s.p2.x - s.p1.x,
          dy = s.p2.y - s.p1.y;
        const d = sqrt(dx * dx + dy * dy);
        if (
          d > s.len * breakThreshold &&
          isInteracting &&
          st === nearestChain &&
          iter === 14
        )
          pendingBreaks.push({ chain: st, si: j });

        const diff = ((s.len - d) / d / 2) * 0.8;
        const ox = dx * diff,
          oy = dy * diff;
        if (!s.p1.pinned && s.p1.active && s.p1 !== draggingPoint) {
          s.p1.x -= ox;
          s.p1.y -= oy;
        }
        if (!s.p2.pinned && s.p2.active && s.p2 !== draggingPoint) {
          s.p2.x += ox;
          s.p2.y += oy;
        }
      }
    }
  }
}

function handleInteractions() {
  const tx = touches.length ? touches[0].x : mouseX;
  const ty = touches.length ? touches[0].y : mouseY;
  const ptx = touches.length ? touches[0].px || tx : pmouseX;
  const pty = touches.length ? touches[0].py || ty : pmouseY;
  const isInteracting = mouseIsPressed || touches.length > 0;

  if (draggingPoint?.active) {
    draggingPoint.x = tx;
    draggingPoint.y = ty;
    draggingPoint.oldX = tx;
    draggingPoint.oldY = ty;
  }

  if (isInteracting) {
    for (const st of chains)
      for (const p of st.points) {
        if (!p.active || p.pinned || p === draggingPoint) continue;
        const d = dist(tx, ty, p.x, p.y);
        if (d < interactRadius) {
          const angle = atan2(p.y - ty, p.x - tx);
          const force = (interactRadius - d) * 0.15;
          p.x += cos(angle) * force + (tx - ptx) * 0.2;
          p.y += sin(angle) * force + (ty - pty) * 0.2;
        }
      }
  }

  for (const id in remotetouchs) {
    const rt = remotetouchs[id];
    if (!rt.pressing) continue;
    for (const st of chains)
      for (const p of st.points) {
        if (!p.active || p.pinned) continue;
        const d = dist(rt.x, rt.y, p.x, p.y);
        if (d < interactRadius) {
          const angle = atan2(p.y - rt.y, p.x - rt.x);
          const force = (interactRadius - d) * 0.15;
          p.x += cos(angle) * force;
          p.y += sin(angle) * force;
        }
      }
  }
}

// ── Chain break ───────────────────────────────────────────────────────────────
function applyChainBreak(chain, startRow, silent) {
  if (chain.brokenRows.has(startRow)) return;
  chain.brokenRows.add(startRow);

  for (let r = startRow; r <= ROWS; r++) {
    const p = chain.points[r];
    if (!p?.active) continue;
    p.active = false;
    if (!silent) {
      const vx = p.x - p.oldX,
        vy = p.y - p.oldY;
      const b = beadAppearance(chain.chainIndex, chain.hue, r, chain.seed || 0);
      fallenBodies.push(
        makeFallenBody(
          p.x,
          p.y,
          { type: b.type, size: b.size, rgb: b.rgb },
          0,
          vx,
          vy,
        ),
      );
    }
  }
  for (let i = chain.sticks.length - 1; i >= 0; i--) {
    if (!chain.sticks[i].p1.active || !chain.sticks[i].p2.active) {
      chain.sticks[i].active = false;
      chain.sticks.splice(i, 1);
    }
  }
  // Save immediately so refresh doesn't lose beads mid-fall
  if (!silent) saveFallenBeads();
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function drawCurtain() {
  // Hanging chains
  for (const st of chains) {
    stroke(180, 150);
    strokeWeight(1.5);
    for (const s of st.sticks)
      if (s.active) line(s.p1.x, s.p1.y, s.p2.x, s.p2.y);
    noStroke();
    for (const p of st.points)
      if (p.active && !p.pinned) drawBead(p.x, p.y, 0, p.type, p.size, p.rgb);
  }

  // All fallen beads — single flat array, no chain distinction
  noStroke();
  for (const b of fallenBodies)
    drawBead(
      b.position.x,
      b.position.y,
      b.angle,
      b.renderData.type,
      b.renderData.size,
      b.renderData.rgb,
    );

  // Green dot above user's own active chains
  fill(0, 180, 120, 180);
  noStroke();
  for (const st of chains)
    if (st.userId === myUserId && !st.fullyBroken)
      ellipse(slotX(st.slot), START_Y - 20, 8, 8);

  // Remote touch cursors
  for (const id in remotetouchs) {
    const rt = remotetouchs[id];
    const uc = chains.find((s) => s.userId === rt.userId);
    colorMode(HSB, 360, 100, 100, 255);
    noStroke();
    fill(uc ? uc.hue : 200, 70, 90, rt.pressing ? 220 : 130);
    circle(rt.x, rt.y, rt.pressing ? 22 : 14);
    colorMode(RGB, 255);
  }
}

function drawBead(x, y, angle, type, size, rgb) {
  push();
  translate(x, y);
  rotate(angle);
  colorMode(RGB, 255);
  fill(rgb[0], rgb[1], rgb[2]);
  noStroke();
  if (type === 0) ellipse(0, 0, size, size);
  else if (type === 1) {
    beginShape();
    vertex(0, -size * 0.7);
    vertex(size * 0.5, 0);
    vertex(0, size * 0.7);
    vertex(-size * 0.5, 0);
    endShape(CLOSE);
  } else rect(0, 0, size, size);
  fill(255, 120);
  ellipse(-size / 4, -size / 4, size / 4, size / 4);
  pop();
}

// ── Socket ────────────────────────────────────────────────────────────────────
socket.on("chains-init", (ss) => {
  if (p5Ready) rebuildChains(ss);
  else pendingChainsInit = ss;
});
socket.on("fallen-beads-init", (beads) => {
  if (p5Ready) restoreFallenBeads(beads);
  else pendingFallenBeads = beads;
});
socket.on("chains-reset", (ss) => {
  // Full re-sort after add/evict — rebuild without clearing fallenBodies
  if (!p5Ready) {
    pendingChainsInit = ss;
    return;
  }
  for (const st of chains) removeChainPhysics(st);
  chains = [];
  for (const sd of ss) {
    if (sd.palette?.length) chainPalettes[sd.chainIndex] = sd.palette;
    const chain = buildChain(
      sd.chainIndex,
      sd.slot,
      sd.userId,
      sd.hue,
      sd.seed || 0,
    );
    for (const row of [...sd.breaks].sort((a, b) => a - b))
      applyChainBreak(chain, row, true);
    if (sd.breaks.includes(1)) chain.fullyBroken = true;
    chains.push(chain);
  }
});
socket.on("chain-fully-broken", ({ chainIndex }) => {
  const st = chains.find((s) => s.chainIndex === chainIndex);
  if (st) st.fullyBroken = true;
});
socket.on("chain-evicted", ({ chainIndex }) => {
  chains = chains.filter((s) => s.chainIndex !== chainIndex);
  delete chainPalettes[chainIndex];
});
socket.on("add-chain-rejected", () => {
  showToast("帘子满了，请扯烂一整串来腾出空间");
});
socket.on("capacity-ok", () => {
  showPhotoPicker((palette) => {
    socket.emit("add-chain", { userId: myUserId, palette });
  });
});
socket.on("remote-break", ({ chainIndex, row }) => {
  const st = chains.find((s) => s.chainIndex === chainIndex);
  if (st) applyChainBreak(st, row, false);
});
socket.on("remote-touch", ({ socketId, x, y, pressing, userId }) => {
  remotetouchs[socketId] = { x, y, pressing, userId, lastSeen: Date.now() };
});
socket.on("remote-touch-gone", ({ socketId }) => {
  delete remotetouchs[socketId];
});
setInterval(() => {
  const now = Date.now();
  for (const id in remotetouchs)
    if (now - remotetouchs[id].lastSeen > 3000) delete remotetouchs[id];
}, 2000);

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
      background:rgba(0,0,0,.78);color:#fff;padding:12px 20px;border-radius:20px;
      font-size:14px;font-family:sans-serif;z-index:99998;text-align:center;
      max-width:80vw;pointer-events:none;opacity:0;transition:opacity .2s`;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.style.opacity = "0"), 3500);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.getElementById("photo-overlay").classList.add("hidden");
socket.emit("hello", { userId: myUserId });

document.getElementById("addchainButton").addEventListener("click", () => {
  socket.emit("check-capacity");
});

// ── Mouse / touch ─────────────────────────────────────────────────────────────
function mousePressed() {
  draggingPoint = findPoint(mouseX, mouseY);
}
function mouseReleased() {
  draggingPoint = null;
}

document.addEventListener(
  "touchstart",
  (e) => {
    const overlay = document.getElementById("photo-overlay");
    if (!overlay.classList.contains("hidden")) return;
    draggingPoint = findPoint(e.touches[0].clientX, e.touches[0].clientY);
  },
  { passive: true },
);
document.addEventListener(
  "touchend",
  () => {
    draggingPoint = null;
  },
  { passive: true },
);

function findPoint(x, y) {
  let best = 30,
    sel = null;
  for (const st of chains)
    for (const p of st.points) {
      if (!p.active) continue;
      const d = dist(x, y, p.x, p.y);
      if (d < best) {
        best = d;
        sel = p;
      }
    }
  return sel;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  rebuildGround();
  for (const st of chains) {
    const top = st.points[0];
    if (top) {
      const cx = slotX(st.slot);
      top.x = cx;
      top.oldX = cx;
    }
  }
}
