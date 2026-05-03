// ════════════════════════════════════════════════════════
//  BEAD CURTAIN  —  sketch.js
//  Pure physics + render. Receives data via window.setCurtainData()
// ════════════════════════════════════════════════════════

const { Engine, World, Bodies, Body } = Matter;

let engine, world, ground;

const COLS = 20;
const ROWS = 20;
const SPACING = 18;

let points = [];
let sticks = [];
let fallenBeads = [];
let pendingBreaks = [];

let draggingPoint = null;
const INTERACT_R = 50;
const BREAK_THRESH = 2.2;

// ── Curtain color data ─────────────────────────────────
// allColumns: [{ colIndex, palette }]  from server
// myColIndex: which column is "mine"
// myPalettes: array of palettes I've submitted
let curtainColumns = [];
let myColIndex = null;
let myPalettes = [];

// colColors[x] = p5 color for column x
let colColors = [];

const DEFAULT_COL = [220, 220, 220]; // unowned columns
const DEFAULT_MY_COL = [200, 200, 210]; // my column before any upload

// ════════════════════════════════════════════════════════
//  PUBLIC INTERFACE  (called from index.html)
// ════════════════════════════════════════════════════════
window.setCurtainData = function (cols, myCol, myPals) {
  curtainColumns = cols || [];
  myColIndex = myCol;
  myPalettes = myPals || [];
  buildColColors();
  applyColorsToPoints();
};

// ════════════════════════════════════════════════════════
//  p5 SETUP
// ════════════════════════════════════════════════════════
function setup() {
  const cnv = createCanvas(windowWidth, windowHeight);
  cnv.parent("screenCurtain");
  cnv.elt.id = "curtainCanvas";
  cnv.elt.style.display = "none"; // hidden until curtain screen is shown
  rectMode(CENTER);

  engine = Engine.create();
  world = engine.world;
  ground = Bodies.rectangle(width / 2, height + 20, width, 60, {
    isStatic: true,
  });
  World.add(world, ground);

  initBeads();

  // Expose resize hook so index.html can call it when switching to curtain
  window._p5ResizeCurtain = function () {
    resizeCanvas(windowWidth, windowHeight);
    initBeads(); // rebuild with correct dimensions
    // Apply any queued data (colors + column assignment)
    if (window._pendingCurtainData) {
      const d = window._pendingCurtainData;
      window._pendingCurtainData = null;
      window.setCurtainData(d.allColumns, d.myColIndex, d.myPalettes);
    } else if (curtainColumns.length > 0 || myColIndex !== null) {
      // Re-apply existing data after resize
      buildColColors();
      applyColorsToPoints();
    }
  };

  // If data was queued before sketch was ready
  if (window._pendingCurtainData) {
    const d = window._pendingCurtainData;
    window.setCurtainData(d.allColumns, d.myColIndex, d.myPalettes);
    window._pendingCurtainData = null;
  }
}

// ════════════════════════════════════════════════════════
//  BUILD BEADS
// ════════════════════════════════════════════════════════
function initBeads() {
  points = [];
  sticks = [];
  fallenBeads = [];
  pendingBreaks = [];
  World.clear(world, true);
  World.add(world, ground);

  const startX = (width - COLS * SPACING) / 2;

  for (let y = 0; y <= ROWS; y++) {
    for (let x = 0; x <= COLS; x++) {
      points.push({
        x: startX + x * SPACING,
        y: y * SPACING + 60,
        oldX: startX + x * SPACING,
        oldY: y * SPACING + 60,
        pinned: y === 0,
        active: true,
        col: x,
        row: y,
        type: Math.floor(Math.random() * 3),
        size: random(10, 18),
        color: color(...DEFAULT_COL),
      });
    }
  }

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x <= COLS; x++) {
      const p1 = points[y * (COLS + 1) + x];
      const p2 = points[(y + 1) * (COLS + 1) + x];
      sticks.push({
        p1,
        p2,
        len: SPACING * random(0.8, 1.4),
        active: true,
        col: x,
      });
    }
  }

  buildColColors();
  applyColorsToPoints();
}

// ── Build per-column color from curtain data ───────────
function buildColColors() {
  colColors = [];
  for (let x = 0; x <= COLS; x++) {
    const entry = curtainColumns.find((e) => e.colIndex === x);

    if (entry && entry.palette && entry.palette.length) {
      // Pick a random color from the palette for this column
      const c = entry.palette[Math.floor(Math.random() * entry.palette.length)];
      colColors[x] = color(c[0], c[1], c[2]);
    } else if (x === myColIndex) {
      // My column but not yet colored
      colColors[x] = color(...DEFAULT_MY_COL);
    } else {
      colColors[x] = color(...DEFAULT_COL);
    }
  }
}

// ── Apply colColors to existing points ────────────────
function applyColorsToPoints() {
  for (const p of points) {
    const base = colColors[p.col] || color(...DEFAULT_COL);
    const jitter = random(-18, 18);
    p.color = color(
      constrain(red(base) + jitter, 0, 255),
      constrain(green(base) + jitter, 0, 255),
      constrain(blue(base) + jitter, 0, 255),
    );
  }
}

// ════════════════════════════════════════════════════════
//  DRAW LOOP
// ════════════════════════════════════════════════════════
function draw() {
  background(247, 245, 240);
  updateVerlet();
  Engine.update(engine);
  render();
}

// ════════════════════════════════════════════════════════
//  PHYSICS
// ════════════════════════════════════════════════════════
function updateVerlet() {
  const gravity = 0.6,
    friction = 0.98;

  for (const p of points) {
    if (p.active && !p.pinned) {
      const vx = (p.x - p.oldX) * friction;
      const vy = (p.y - p.oldY) * friction;
      p.oldX = p.x;
      p.oldY = p.y;
      p.x += vx;
      p.y += vy + gravity;
    }
  }

  handleInteractions();
  solveConstraints();

  if (pendingBreaks.length > 0) {
    const tx = touches.length > 0 ? touches[0].x : mouseX;
    const ty = touches.length > 0 ? touches[0].y : mouseY;
    pendingBreaks.sort((a, b) => {
      const da = dist(tx, ty, (a.p1.x + a.p2.x) / 2, (a.p1.y + a.p2.y) / 2);
      const db = dist(tx, ty, (b.p1.x + b.p2.x) / 2, (b.p1.y + b.p2.y) / 2);
      return da - db;
    });
    const s = pendingBreaks[0];
    s.active = false;
    handleChainBreak(s.p2);
    const idx = sticks.indexOf(s);
    if (idx !== -1) sticks.splice(idx, 1);
    pendingBreaks = [];
  }
}

function solveConstraints() {
  const tx = touches.length > 0 ? touches[0].x : mouseX;
  const ty = touches.length > 0 ? touches[0].y : mouseY;
  const interacting = mouseIsPressed || touches.length > 0;

  let nearestCol = -1,
    nearestDist = Infinity;
  if (interacting) {
    for (const p of points) {
      if (!p.active) continue;
      const d = dist(tx, ty, p.x, p.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearestCol = p.col;
      }
    }
  }

  pendingBreaks = [];

  for (let i = 0; i < 15; i++) {
    for (let j = 0; j < sticks.length; j++) {
      const s = sticks[j];
      if (!s.active) continue;
      const dx = s.p2.x - s.p1.x,
        dy = s.p2.y - s.p1.y;
      const d = sqrt(dx * dx + dy * dy);

      if (d > s.len * BREAK_THRESH && interacting) {
        if (abs(s.col - nearestCol) <= 1 && i === 14) pendingBreaks.push(s);
      }

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

function handleInteractions() {
  const tx = touches.length > 0 ? touches[0].x : mouseX;
  const ty = touches.length > 0 ? touches[0].y : mouseY;
  const ptx = touches.length > 0 ? touches[0].px || tx : pmouseX;
  const pty = touches.length > 0 ? touches[0].py || ty : pmouseY;

  if (draggingPoint && draggingPoint.active) {
    draggingPoint.x = draggingPoint.oldX = tx;
    draggingPoint.y = draggingPoint.oldY = ty;
  }

  if (mouseIsPressed || touches.length > 0) {
    for (const p of points) {
      if (!p.active || p.pinned || p === draggingPoint) continue;
      const d = dist(tx, ty, p.x, p.y);
      if (d < INTERACT_R) {
        const angle = atan2(p.y - ty, p.x - tx);
        const force = (INTERACT_R - d) * 0.15;
        p.x += cos(angle) * force + (tx - ptx) * 0.2;
        p.y += sin(angle) * force + (ty - pty) * 0.2;
      }
    }
  }
}

function handleChainBreak(hitPoint) {
  const col = hitPoint.col,
    startRow = hitPoint.row;
  for (let r = startRow; r <= ROWS; r++) {
    const p = points[r * (COLS + 1) + col];
    if (p && p.active) {
      p.active = false;
      const bead = Bodies.circle(p.x, p.y, p.size / 2, {
        restitution: 0.5,
        friction: 0.3,
      });
      bead.renderData = { type: p.type, size: p.size, color: p.color };
      Body.setVelocity(bead, { x: p.x - p.oldX, y: p.y - p.oldY });
      World.add(world, bead);
      fallenBeads.push(bead);
    } else break;
  }
  for (let i = sticks.length - 1; i >= 0; i--) {
    const s = sticks[i];
    if (!s.p1.active || !s.p2.active) {
      s.active = false;
      sticks.splice(i, 1);
    }
  }
}

// ════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════
function render() {
  // Draw threads + highlight own columns
  for (let x = 0; x <= COLS; x++) {
    const isMine = isMyColumn(x);
    const colPts = points.filter((p) => p.col === x && p.pinned);
    if (colPts.length === 0) continue;

    if (isMine) {
      // Glow thread for my column(s)
      const startX = colPts[0].x;
      stroke(100, 100, 255, 40);
      strokeWeight(8);
      const lastActive = points
        .filter((p) => p.col === x && p.active)
        .slice(-1)[0];
      if (lastActive) line(startX, 0, lastActive.x, lastActive.y);
    }
  }

  // Sticks (threads)
  stroke(180, 150);
  strokeWeight(1.5);
  for (const s of sticks) {
    if (s.active) line(s.p1.x, s.p1.y, s.p2.x, s.p2.y);
  }

  // Active beads
  noStroke();
  for (const p of points) {
    if (p.active && !p.pinned) {
      const mine = isMyColumn(p.col);
      drawBeadShape(
        p.x,
        p.y,
        0,
        p.type,
        mine ? p.size * 1.1 : p.size,
        p.color,
        mine,
      );
    }
  }

  // Fallen beads
  for (const b of fallenBeads) {
    const d = b.renderData;
    drawBeadShape(
      b.position.x,
      b.position.y,
      b.angle,
      d.type,
      d.size,
      d.color,
      false,
    );
  }
}

function isMyColumn(x) {
  if (myColIndex === null) return false;
  for (let i = 0; i < myPalettes.length; i++) {
    if ((myColIndex + i) % COLS === x) return true;
  }
  return x === myColIndex;
}

function drawBeadShape(x, y, angle, type, size, col, highlight) {
  push();
  translate(x, y);
  rotate(angle);
  if (highlight) {
    // subtle outer ring
    noFill();
    stroke(255, 255, 255, 160);
    strokeWeight(2);
    if (type === 0) ellipse(0, 0, size + 4, size + 4);
    else rect(0, 0, size + 4, size + 4);
    noStroke();
  }
  fill(col);
  noStroke();
  if (type === 0) ellipse(0, 0, size, size);
  else if (type === 1) drawDiamond(size * 0.7);
  else rect(0, 0, size, size);
  // specular
  fill(255, 100);
  ellipse(-size / 4, -size / 4, size / 4, size / 4);
  pop();
}

function drawDiamond(s) {
  beginShape();
  vertex(0, -s);
  vertex(s * 0.7, 0);
  vertex(0, s);
  vertex(-s * 0.7, 0);
  endShape(CLOSE);
}

// ════════════════════════════════════════════════════════
//  INPUT
// ════════════════════════════════════════════════════════
function mousePressed() {
  draggingPoint = findPoint(mouseX, mouseY);
}
function mouseReleased() {
  draggingPoint = null;
}
function touchStarted() {
  draggingPoint = findPoint(touches[0].x, touches[0].y);
  return false;
}
function touchEnded() {
  draggingPoint = null;
  return false;
}

function findPoint(x, y) {
  let best = 30,
    sel = null;
  for (const p of points) {
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
  const cnv = document.getElementById("curtainCanvas");
  if (cnv && cnv.style.display !== "none") initBeads();
}
