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

//AI told me using seed could be faster
function makeSeedID(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uses a per-chain random seed so each chain looks genuinely random,
// but is identical on every device and survives refresh.
// seed comes from the server (stored in users.json at chain creation time).
function beadAppearance(chainIndex, hue, row, seed) {
  const randomN = makeSeedID(seed + row * 4); //为了让相邻行的种子数值拉开距离，防止随机数发生器产生相似的视觉模式（比如出现难看的条纹）
  return {
    type: Math.floor(randomN() * 3), // 0 circle  1 diamond  2 rect
    size: 10 + randomN() * 8, // 10–18 px  (float, rendered as-is)
    hsl: [
      hue,
      60 + randomN() * 30, // saturation 60–90
      45 + randomN() * 20, // lightness  45–65
    ],
  };
}

// CANVAS WIDTH HELPER
// Based on the highest chainIndex present, not the array length.
// This ensures no chain is ever outside the canvas bounds.
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

function setup() {
  ({ Engine, World, Bodies, Body } = Matter);

  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  rectMode(CENTER);

  engine = Engine.create();
  world = engine.world;
  rebuildGround();

  socket.emit("hello", { userId: myUserId });
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
    let chain = buildchain(sd.chainIndex, sd.userId, sd.hue, sd.seed || 0);

    //refresh后断裂状态的复原，重现
    let sortedBreaks = [...sd.breaks].sort((a, b) => a - b);
    for (let row of sortedBreaks) applyChainBreak(chain, row, true);

    // Restore fallen beads
    for (let saved of sd.fallenBeads) {
      let fallBead = beadAppearance(
        sd.chainIndex,
        sd.hue,
        saved.row,
        sd.seed || 0,
      );
      //convert y for different windowHeight
      let restoredY = windowHeight - saved.yFromBottom;
      let bead = Bodies.circle(saved.x, restoredY, fallBead.size / 2, {
        restitution: 0.5,
        friction: 0.3,
      });
      bead.renderData = {
        type: fallBead.type,
        size: fallBead.size,
        hsl: fallBead.hsl,
        row: fallBead.row,
      };
      Body.setAngle(bead, saved.angle);
      Body.setVelocity(bead, { x: saved.vx || 0, y: saved.vy || 0 });
      World.add(world, bead);
      chain.fallenBeads.push(bead);
    }

    chains.push(chain);
  }
}

// called when other users join or add chains
function appendchains(newchainData) {
  // Canvas must be wide enough for the highest chainIndex in the combined list
  let combined = chains.concat(newchainData);
  let needed = canvasWidthForchains(combined);
  if (needed > width) {
    resizeCanvas(needed, windowHeight);
    rebuildGround();
  }

  for (let sd of newchainData) {
    if (chains.find((s) => s.chainIndex === sd.chainIndex)) continue;
    let chain = buildchain(sd.chainIndex, sd.userId, sd.hue, sd.seed || 0);
    chains.push(chain);
  }
}

function buildchain(chainIndex, userId, hue, seed) {
  let pts = [],
    stks = [];
  let cx = START_X + chainIndex * COL_SPACING;
  // Use a separate PRNG stream for stick lengths (offset seed by 999999)
  const lenRng = makeSeedID(seed + 999999);

  for (let r = 0; r <= ROWS; r++) {
    let beadOnString = beadAppearance(chainIndex, hue, r, seed);
    pts.push({
      x: cx,
      y: r * ROW_SPACING + START_Y,
      oldX: cx,
      oldY: r * ROW_SPACING + START_Y,
      pinned: r === 0,
      active: true,
      row: r,
      type: beadOnString.type,
      size: beadOnString.size,
      hsl: beadOnString.hsl,
    });
  }

  for (let r = 0; r < ROWS; r++) {
    stks.push({
      p1: pts[r],
      p2: pts[r + 1],
      len: ROW_SPACING * (0.8 + lenRng() * 0.6), // 0.8–1.4, random per chain
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

// touch BROADCAST  (throttled to ~30fps)
// gemini说这叫节流控制 (Throttling)//我开始一个一个传太慢了
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

// FALLEN BEAD SNAPSHOT  (throttled to every 5 s)
// Stores only { x, y, angle, row } — appearance recomputed from chain on load
function maybeSaveBeads() {
  if (millis() - lastBeadSave < 5000) return; //每5s保存一次
  lastBeadSave = millis();
  for (let st of chains) {
    if (st.fallenBeads.length === 0) continue; //如果某根线下面没有掉落的珠子，跳过
    let beads = st.fallenBeads.map((b) => ({
      x: b.position.x,
      yFromBottom: windowHeight - b.position.y, //device-independent
      angle: b.angle,
      vx: b.velocity.x,
      vy: b.velocity.y,
      row: b.renderData.row,
    }));
    socket.emit("fallen-beads-update", { chainIndex: st.chainIndex, beads });
  }
}

//
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
  // KEY FIX: on mobile mouseIsPressed is always false — must check touches
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

  // Remote touchs push beads too
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

// CHAIN BREAK
// silent=true → deactivate beads without spawning physics bodies (used on init)
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
        //为什么这里那个掉落的东西的半径会变
        restitution: 0.5,
        friction: 0.3,
      });
      // Store row so we can recompute appearance on restore
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

  // Ownership dot above my chains,帮助我们看自己的帘子
  noStroke();
  fill(0, 180, 120, 180);
  for (let st of chains) {
    if (st.userId === myUserId) ellipse(st.points[0].x, START_Y - 20, 8, 8);
  }

  // Remote touch dots
  for (let id in remotetouchs) {
    let rt = remotetouchs[id];
    let userchain = chains.find((s) => s.userId === rt.userId);
    let h = userchain ? userchain.hue : 200;
    colorMode(HSB, 360, 100, 100, 255);
    noStroke();
    // fill(h, 70, 90, rt.pressing ? 220 : 130);
    if (rt.pressing === true) {
      fill(h, 70, 90, 220);
    } else {
      fill(h, 70, 90, 130);
    }

    let sz; // 先声明变量

    if (rt.pressing === true) {
      sz = 22;
    } else {
      sz = 14;
    }

    circle(rt.x, rt.y, sz);
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

//socketIo
socket.on("chains-init", function (ss) {
  rebuildchains(ss);
});
socket.on("chains-appended", function (ss) {
  appendchains(ss);
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

// Clean up stale touchs
setInterval(function () {
  let now = Date.now();
  for (let id in remotetouchs) {
    if (now - remotetouchs[id].lastSeen > 3000) delete remotetouchs[id];
  }
}, 2000);

//button create more
(function () {
  let btn = document.getElementById("addchainButton");
  if (!btn) return;
  let lastFire = 0;
  function doAdd(e) {
    e.preventDefault();
    e.stopPropagation();
    let now = Date.now();
    if (now - lastFire < 400) return;
    lastFire = now;
    socket.emit("add-chain", { userId: myUserId });
  }
  btn.addEventListener("touchstart", doAdd, { passive: false });
  btn.addEventListener("click", doAdd);
})();

// (function () {
//   let btn = document.getElementById("addchainButton");
//   if (!btn) return;
//   let lastFire = 0;
//   function doAdd(e) {
//     e.preventDefault();
//     e.stopPropagation();
//     let now = Date.now();
//     if (now - lastFire < 400) return;
//     lastFire = now;
//     socket.emit("add-chain", { userId: myUserId });
//   }
//   btn.addEventListener("touchstart", doAdd, { passive: false });
//   btn.addEventListener("click", doAdd);
// })();

function mousePressed() {
  draggingPoint = findPoint(mouseX, mouseY);
}
function mouseReleased() {
  draggingPoint = null;
}

function touchStarted() {
  if (touches.length > 0) {
    let el = document.elementFromPoint(touches[0].x, touches[0].y);
    if (el && (el.id === "addchainButton" || el.closest("#addchainButton"))) {
      return true;
    }
    // if (el && (el.id === "uploadPhotoButton" || el.closest("#uploadPhotoButton"))) {
    //   return true;
    // }
    draggingPoint = findPoint(touches[0].x, touches[0].y);
  }
  return false;
}
function touchEnded() {
  draggingPoint = null;
  return false;
}

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
