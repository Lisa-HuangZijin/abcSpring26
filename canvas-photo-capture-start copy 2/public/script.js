// Matter.js — destructured inside setup() after CDN script loads
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
let myUserId = getUserId();

let engine, world, ground;
let draggingPoint = null;

let ROWS = 20;
let COL_SPACING = 30;
let ROW_SPACING = 18;
let START_Y = 60;
let START_X = 40;

let chains = [];
let pendingBreaks = [];

let interactRadius = 50;
let breakThreshold = 2.2;

let remotetouchs = {};

let lasttouchSend = 0;
let lastBeadSave = 0;

// ── Per-chain palette (5 HSL colors extracted from photo) ────────────────────
// Keyed by chainIndex → array of 5 [h,s,l] arrays
// Each chain permanently keeps its own colors, independent of other chains
let chainPalettes = {};

// ── Photo picker ──────────────────────────────────────────────────────────────

// Extract N dominant colors from an image by shrinking it to a tiny canvas
// and running a simple median-cut on the pixel bucket.
function extractColors(imgEl, n) {
  const SIZE = 64; // shrink to 64×64 to go fast
  const offscreen = document.createElement("canvas");
  offscreen.width = SIZE;
  offscreen.height = SIZE;
  const ctx = offscreen.getContext("2d");
  ctx.drawImage(imgEl, 0, 0, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

  // Collect all pixels as [r,g,b]
  let pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    // skip near-white and near-black (boring)
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const brightness = (r + g + b) / 3;
    if (brightness < 20 || brightness > 240) continue;
    pixels.push([r, g, b]);
  }
  if (pixels.length === 0) pixels = [[128, 128, 128]];

  // Simple median cut: recursively split the widest channel
  function medianCut(px, depth) {
    if (depth === 0 || px.length === 0) {
      // average the bucket → one color
      let r = 0,
        g = 0,
        b = 0;
      for (let p of px) {
        r += p[0];
        g += p[1];
        b += p[2];
      }
      const len = px.length || 1;
      return [
        rgbToHsl(Math.round(r / len), Math.round(g / len), Math.round(b / len)),
      ];
    }
    // find widest channel
    let minR = 255,
      maxR = 0,
      minG = 255,
      maxG = 0,
      minB = 255,
      maxB = 0;
    for (let p of px) {
      if (p[0] < minR) minR = p[0];
      if (p[0] > maxR) maxR = p[0];
      if (p[1] < minG) minG = p[1];
      if (p[1] > maxG) maxG = p[1];
      if (p[2] < minB) minB = p[2];
      if (p[2] > maxB) maxB = p[2];
    }
    const rRange = maxR - minR,
      gRange = maxG - minG,
      bRange = maxB - minB;
    let ch = 0;
    if (gRange >= rRange && gRange >= bRange) ch = 1;
    else if (bRange >= rRange && bRange >= gRange) ch = 2;
    px.sort((a, b) => a[ch] - b[ch]);
    const mid = Math.floor(px.length / 2);
    return [
      ...medianCut(px.slice(0, mid), depth - 1),
      ...medianCut(px.slice(mid), depth - 1),
    ];
  }

  // depth = log2(n) — for n=5 we do depth=3 (gives 8 buckets) then take first 5
  const depth = Math.ceil(Math.log2(n));
  let colors = medianCut(pixels, depth);
  // deduplicate / trim to n
  return colors.slice(0, n);
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h,
    s,
    l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

// Show the overlay for picking a photo; calls onDone(palette) when Finish hit
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
  overlay.classList.remove("hidden"); // show overlay

  let currentPalette = null;

  input.value = "";
  input.onchange = async function () {
    const file = input.files[0];
    if (!file) return;

    let blobUrl;
    const isHeic =
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      file.name.toLowerCase().endsWith(".heic") ||
      file.name.toLowerCase().endsWith(".heif");

    if (isHeic && typeof heic2any !== "undefined") {
      try {
        const jpegBlob = await heic2any({
          blob: file,
          toType: "image/jpeg",
          quality: 0.85,
        });
        blobUrl = URL.createObjectURL(
          Array.isArray(jpegBlob) ? jpegBlob[0] : jpegBlob,
        );
      } catch (err) {
        blobUrl = URL.createObjectURL(file);
      }
    } else {
      blobUrl = URL.createObjectURL(file);
    }

    previewImg.onload = function () {
      currentPalette = extractColors(previewImg, 5);
      swatches.innerHTML = "";
      for (let hsl of currentPalette) {
        const div = document.createElement("div");
        div.className = "swatch";
        div.style.background = `hsl(${hsl[0]},${hsl[1]}%,${hsl[2]}%)`;
        swatches.appendChild(div);
      }
      previewArea.style.display = "flex";
      finishBtn.disabled = false;
    };
    previewImg.src = blobUrl;
  };

  finishBtn.onclick = function () {
    if (!currentPalette) return;
    overlay.classList.add("hidden"); // hide overlay
    onDone(currentPalette);
  };
}

// ── Seed-based PRNG ───────────────────────────────────────────────────────────
function makeSeedID(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bead appearance — uses per-chain palette if available, else falls back to hue
function beadAppearance(chainIndex, hue, row, seed) {
  const randomN = makeSeedID(seed + row * 4);
  const type = Math.floor(randomN() * 3);
  const size = 10 + randomN() * 8;

  let hsl;
  const palette = chainPalettes[chainIndex];
  if (palette && palette.length >= 5) {
    const base = palette[row % 5];
    const variation = makeSeedID(seed + row * 4 + 1);
    hsl = [
      base[0],
      Math.min(100, Math.max(0, base[1] + (variation() - 0.5) * 15)),
      Math.min(75, Math.max(30, base[2] + (variation() - 0.5) * 12)),
    ];
  } else {
    hsl = [hue, 60 + randomN() * 30, 45 + randomN() * 20];
  }

  return { type, size, hsl };
}

// ── Canvas width helper ───────────────────────────────────────────────────────
function canvasWidthForchains(chainList) {
  if (!chainList || chainList.length === 0) return windowWidth;
  let maxIdx = chainList.reduce(function (m, s) {
    return Math.max(m, s.chainIndex || 0);
  }, 0);
  return Math.max(
    windowWidth,
    START_X + (maxIdx + 1) * COL_SPACING + COL_SPACING,
  );
}

// ── p5 ready flag ─────────────────────────────────────────────────────────────
let p5Ready = false;
let pendingChainsInit = null;
let pendingChainsAppend = [];

// ── p5 setup / draw ───────────────────────────────────────────────────────────
function setup() {
  ({ Engine, World, Bodies, Body } = Matter);

  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  rectMode(CENTER);

  engine = Engine.create();
  world = engine.world;
  rebuildGround();

  // p5 is ready — flush any socket data that arrived before setup() finished
  p5Ready = true;
  if (pendingChainsInit !== null) {
    rebuildchains(pendingChainsInit);
    pendingChainsInit = null;
  }
  for (let sd of pendingChainsAppend) appendchains(sd);
  pendingChainsAppend = [];
}

function draw() {
  background(252);
  broadcasttouch();
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

function rebuildchains(serverchains) {
  for (let st of chains) for (let b of st.fallenBeads) World.remove(world, b);
  chains = [];

  resizeCanvas(canvasWidthForchains(serverchains), windowHeight);
  rebuildGround();

  for (let sd of serverchains) {
    // Register palette by chainIndex (not userId) so each chain keeps its own colors
    if (sd.palette && sd.palette.length > 0) {
      chainPalettes[sd.chainIndex] = sd.palette;
    }
    let chain = buildchain(sd.chainIndex, sd.userId, sd.hue, sd.seed || 0);

    let sortedBreaks = [...sd.breaks].sort((a, b) => a - b);
    for (let row of sortedBreaks) applyChainBreak(chain, row, true);

    for (let saved of sd.fallenBeads) {
      let fallBead = beadAppearance(
        sd.chainIndex,
        sd.hue,
        saved.row,
        sd.seed || 0,
      );
      let restoredY = windowHeight - saved.yFromBottom;
      let bead = Bodies.circle(saved.x, restoredY, fallBead.size / 2, {
        restitution: 0.5,
        friction: 0.3,
      });
      bead.renderData = {
        type: fallBead.type,
        size: fallBead.size,
        hsl: fallBead.hsl,
        row: saved.row,
      };
      Body.setAngle(bead, saved.angle);
      Body.setVelocity(bead, { x: saved.vx || 0, y: saved.vy || 0 });
      World.add(world, bead);
      chain.fallenBeads.push(bead);
    }

    chains.push(chain);
  }
}

function appendchains(newchainData) {
  let combined = chains.concat(newchainData);
  let needed = canvasWidthForchains(combined);
  if (needed > width) {
    resizeCanvas(needed, windowHeight);
    rebuildGround();
  }

  for (let sd of newchainData) {
    if (chains.find((s) => s.chainIndex === sd.chainIndex)) continue;
    if (sd.palette && sd.palette.length > 0) {
      chainPalettes[sd.chainIndex] = sd.palette;
    }
    let chain = buildchain(sd.chainIndex, sd.userId, sd.hue, sd.seed || 0);
    chains.push(chain);
  }
}

function buildchain(chainIndex, userId, hue, seed) {
  let pts = [],
    stks = [];
  let cx = START_X + chainIndex * COL_SPACING;
  const lenRng = makeSeedID(seed + 999999);

  for (let r = 0; r <= ROWS; r++) {
    let b = beadAppearance(chainIndex, hue, r, seed);
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
      hsl: b.hsl,
    });
  }

  for (let r = 0; r < ROWS; r++) {
    stks.push({
      p1: pts[r],
      p2: pts[r + 1],
      len: ROW_SPACING * (0.8 + lenRng() * 0.6),
      active: true,
    });
  }

  return {
    chainIndex,
    userId,
    hue,
    seed,
    points: pts,
    sticks: stks,
    fallenBeads: [],
    brokenRows: new Set(),
  };
}

// ── touch broadcast ───────────────────────────────────────────────────────────
function broadcasttouch() {
  if (millis() - lasttouchSend < 33) return;
  lasttouchSend = millis();
  let tx = touches.length > 0 ? touches[0].x : mouseX;
  let ty = touches.length > 0 ? touches[0].y : mouseY;
  socket.emit("touch-move", {
    x: tx,
    y: ty,
    pressing: mouseIsPressed || touches.length > 0,
    userId: myUserId,
  });
}

// ── fallen bead snapshot ──────────────────────────────────────────────────────
function maybeSaveBeads() {
  if (millis() - lastBeadSave < 5000) return;
  lastBeadSave = millis();
  for (let st of chains) {
    if (st.fallenBeads.length === 0) continue;
    let beads = st.fallenBeads.map((b) => ({
      x: b.position.x,
      yFromBottom: windowHeight - b.position.y,
      angle: b.angle,
      vx: b.velocity.x,
      vy: b.velocity.y,
      row: b.renderData.row,
    }));
    socket.emit("fallen-beads-update", { chainIndex: st.chainIndex, beads });
  }
}

// ── chain update ──────────────────────────────────────────────────────────────
function updateChain() {
  let gravity = 0.6,
    friction = 0.98;

  for (let st of chains) {
    for (let p of st.points) {
      if (!p.active || p.pinned) continue;
      let vx = (p.x - p.oldX) * friction;
      let vy = (p.y - p.oldY) * friction;
      p.oldX = p.x;
      p.oldY = p.y;
      p.x += vx;
      p.y += vy + gravity;
    }
  }

  handleInteractions();
  solveConstraints();

  if (pendingBreaks.length > 0) {
    let tx = touches.length > 0 ? touches[0].x : mouseX;
    let ty = touches.length > 0 ? touches[0].y : mouseY;
    pendingBreaks.sort((a, b) => {
      let s1 = a.chain.sticks[a.si],
        s2 = b.chain.sticks[b.si];
      if (!s1 || !s2) return 0;
      return (
        dist(tx, ty, (s1.p1.x + s1.p2.x) / 2, (s1.p1.y + s1.p2.y) / 2) -
        dist(tx, ty, (s2.p1.x + s2.p2.x) / 2, (s2.p1.y + s2.p2.y) / 2)
      );
    });
    let best = pendingBreaks[0];
    let s = best.chain.sticks[best.si];
    if (s && s.active) {
      let breakRow = s.p2.row;
      s.active = false;
      applyChainBreak(best.chain, breakRow, false);
      socket.emit("chain-break", {
        chainIndex: best.chain.chainIndex,
        row: breakRow,
      });
    }
    pendingBreaks = [];
  }
}

function solveConstraints() {
  let tx = touches.length > 0 ? touches[0].x : mouseX;
  let ty = touches.length > 0 ? touches[0].y : mouseY;
  let isInteracting = mouseIsPressed || touches.length > 0;

  let nearestchain = null,
    nearestDist = Infinity;
  if (isInteracting) {
    for (let st of chains) {
      for (let p of st.points) {
        if (!p.active) continue;
        let d = dist(tx, ty, p.x, p.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearestchain = st;
        }
      }
    }
  }

  pendingBreaks = [];

  for (let st of chains) {
    for (let iter = 0; iter < 15; iter++) {
      for (let j = 0; j < st.sticks.length; j++) {
        let s = st.sticks[j];
        if (!s.active) continue;
        let dx = s.p2.x - s.p1.x,
          dy = s.p2.y - s.p1.y;
        let d = sqrt(dx * dx + dy * dy);

        if (
          d > s.len * breakThreshold &&
          isInteracting &&
          st === nearestchain &&
          iter === 14
        ) {
          pendingBreaks.push({ chain: st, si: j });
        }

        let diff = ((s.len - d) / d / 2) * 0.8;
        let ox = dx * diff,
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
  let tx = touches.length > 0 ? touches[0].x : mouseX;
  let ty = touches.length > 0 ? touches[0].y : mouseY;
  let ptx = touches.length > 0 ? touches[0].px || tx : pmouseX;
  let pty = touches.length > 0 ? touches[0].py || ty : pmouseY;
  let isInteracting = mouseIsPressed || touches.length > 0;

  if (draggingPoint && draggingPoint.active) {
    draggingPoint.x = tx;
    draggingPoint.y = ty;
    draggingPoint.oldX = tx;
    draggingPoint.oldY = ty;
  }

  if (isInteracting) {
    for (let st of chains) {
      for (let p of st.points) {
        if (!p.active || p.pinned || p === draggingPoint) continue;
        let d = dist(tx, ty, p.x, p.y);
        if (d < interactRadius) {
          let angle = atan2(p.y - ty, p.x - tx);
          let force = (interactRadius - d) * 0.15;
          p.x += cos(angle) * force + (tx - ptx) * 0.2;
          p.y += sin(angle) * force + (ty - pty) * 0.2;
        }
      }
    }
  }

  for (let id in remotetouchs) {
    let rt = remotetouchs[id];
    if (!rt.pressing) continue;
    for (let st of chains) {
      for (let p of st.points) {
        if (!p.active || p.pinned) continue;
        let d = dist(rt.x, rt.y, p.x, p.y);
        if (d < interactRadius) {
          let angle = atan2(p.y - rt.y, p.x - rt.x);
          let force = (interactRadius - d) * 0.15;
          p.x += cos(angle) * force;
          p.y += sin(angle) * force;
        }
      }
    }
  }
}

// ── chain break ───────────────────────────────────────────────────────────────
function applyChainBreak(chain, startRow, silent) {
  if (chain.brokenRows.has(startRow)) return;
  chain.brokenRows.add(startRow);

  for (let r = startRow; r <= ROWS; r++) {
    let p = chain.points[r];
    if (!p || !p.active) continue;
    p.active = false;

    if (!silent) {
      let vx = p.x - p.oldX,
        vy = p.y - p.oldY;
      let fallingBead = beadAppearance(
        chain.chainIndex,
        chain.hue,
        r,
        chain.seed || 0,
      );
      let bead = Bodies.circle(p.x, p.y, fallingBead.size / 2, {
        restitution: 0.5,
        friction: 0.3,
      });
      bead.renderData = {
        type: fallingBead.type,
        size: fallingBead.size,
        hsl: fallingBead.hsl,
        row: r,
      };
      Body.setVelocity(bead, { x: vx, y: vy });
      World.add(world, bead);
      chain.fallenBeads.push(bead);
    }
  }

  for (let i = chain.sticks.length - 1; i >= 0; i--) {
    if (!chain.sticks[i].p1.active || !chain.sticks[i].p2.active) {
      chain.sticks[i].active = false;
      chain.sticks.splice(i, 1);
    }
  }
}

// ── draw ──────────────────────────────────────────────────────────────────────
function drawCurtain() {
  for (let st of chains) {
    stroke(180, 150);
    strokeWeight(1.5);
    for (let s of st.sticks) {
      if (s.active) line(s.p1.x, s.p1.y, s.p2.x, s.p2.y);
    }
    noStroke();
    for (let p of st.points) {
      if (p.active && !p.pinned)
        drawBeadShape(p.x, p.y, 0, p.type, p.size, p.hsl);
    }
    for (let b of st.fallenBeads) {
      let d = b.renderData;
      drawBeadShape(b.position.x, b.position.y, b.angle, d.type, d.size, d.hsl);
    }
  }

  noStroke();
  fill(0, 180, 120, 180);
  for (let st of chains) {
    if (st.userId === myUserId) ellipse(st.points[0].x, START_Y - 20, 8, 8);
  }

  for (let id in remotetouchs) {
    let rt = remotetouchs[id];
    let userchain = chains.find((s) => s.userId === rt.userId);
    let h = userchain ? userchain.hue : 200;
    colorMode(HSB, 360, 100, 100, 255);
    noStroke();
    fill(h, 70, 90, rt.pressing ? 220 : 130);
    circle(rt.x, rt.y, rt.pressing ? 22 : 14);
    colorMode(RGB, 255);
  }
}

function drawBeadShape(x, y, angle, type, size, hsl) {
  push();
  translate(x, y);
  rotate(angle);
  colorMode(HSB, 360, 100, 100, 255);
  let h = hsl[0],
    sl = hsl[1] / 100,
    l = hsl[2] / 100;
  let bv = l + sl * min(l, 1 - l);
  let sv = bv === 0 ? 0 : (2 * (bv - l)) / bv;
  fill(h, sv * 100, bv * 100);
  if (type === 0) ellipse(0, 0, size, size);
  else if (type === 1) drawDiamond(0, 0, size * 0.7);
  else rect(0, 0, size, size);
  colorMode(RGB, 255);
  fill(255, 120);
  ellipse(-size / 4, -size / 4, size / 4, size / 4);
  pop();
}

function drawDiamond(x, y, s) {
  beginShape();
  vertex(0, -s);
  vertex(0.7 * s, 0);
  vertex(0, s);
  vertex(-0.7 * s, 0);
  endShape(CLOSE);
}

socket.on("chains-init", function (ss) {
  if (p5Ready) rebuildchains(ss);
  else pendingChainsInit = ss;
});
socket.on("chains-appended", function (ss) {
  if (p5Ready) appendchains(ss);
  else pendingChainsAppend.push(ss);
});
socket.on("remote-break", function ({ chainIndex, row }) {
  let st = chains.find((s) => s.chainIndex === chainIndex);
  if (st) applyChainBreak(st, row, false);
});
socket.on("remote-touch", function ({ socketId, x, y, pressing, userId }) {
  remotetouchs[socketId] = { x, y, pressing, userId, lastSeen: Date.now() };
});
socket.on("remote-touch-gone", function ({ socketId }) {
  delete remotetouchs[socketId];
});

setInterval(function () {
  let now = Date.now();
  for (let id in remotetouchs) {
    if (now - remotetouchs[id].lastSeen > 3000) delete remotetouchs[id];
  }
}, 2000);

// ── Init flow ─────────────────────────────────────────────────────────────────
function showCurtain() {
  document.getElementById("photo-overlay").classList.add("hidden");
}

// Always go straight to the curtain — chain creation happens via the button
showCurtain();
socket.emit("hello", { userId: myUserId });

// ── "Add my chain" button ─────────────────────────────────────────────────────
(function () {
  let btn = document.getElementById("addchainButton");
  if (!btn) return;
  btn.addEventListener("click", function () {
    showPhotoPicker(function (palette) {
      socket.emit("add-chain", { userId: myUserId, palette });
    });
  });
})();

function mousePressed() {
  draggingPoint = findPoint(mouseX, mouseY);
}
function mouseReleased() {
  draggingPoint = null;
}

// Native touch for bead dragging — passive so it never blocks DOM buttons
document.addEventListener(
  "touchstart",
  function (e) {
    const overlay = document.getElementById("photo-overlay");
    if (overlay && !overlay.classList.contains("hidden")) return;
    const t = e.touches[0];
    draggingPoint = findPoint(t.clientX, t.clientY);
  },
  { passive: true },
);

document.addEventListener(
  "touchend",
  function () {
    draggingPoint = null;
  },
  { passive: true },
);

function findPoint(x, y) {
  let best = 30,
    sel = null;
  for (let st of chains)
    for (let p of st.points) {
      if (!p.active) continue;
      let d = dist(x, y, p.x, p.y);
      if (d < best) {
        best = d;
        sel = p;
      }
    }
  return sel;
}

function windowResized() {
  resizeCanvas(canvasWidthForchains(chains), windowHeight);
  rebuildGround();
}
