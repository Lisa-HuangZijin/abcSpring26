//解决了断裂的问题，把行距和列分开了
const { Engine, World, Bodies, Body } = Matter;

let engine, world;
let points = [];
let sticks = [];
let fallenBeads = [];
let ground;

let cols = 20;
let rows = 20;
let colSpacing = 25;
let rowSpacing = 18;
let draggingPoint = null;
let interactRadius = 50;
let breakThreshold = 2.2;

let pendingBreaks = [];

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  rectMode(CENTER);

  engine = Engine.create();
  world = engine.world;
  ground = Bodies.rectangle(width / 2, height + 20, width, 60, {
    isStatic: true,
  });
  World.add(world, ground);

  // let startX = (width - cols * colSpacing) / 2;
  let startX = 10;

  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= cols; x++) {
      points.push({
        x: startX + x * colSpacing, // 横向用 colSpacing
        y: y * rowSpacing + 60, // 纵向用 rowSpacing
        oldX: startX + x * colSpacing,
        oldY: y * rowSpacing + 60,
        pinned: y === 0,
        active: true,
        col: x,
        row: y,
        type: random([0, 1, 2]),
        size: random(10, 18),
        color: color(random(80, 120), random(130, 160), random(200, 255)),
      });
    }
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x <= cols; x++) {
      let p1 = points[y * (cols + 1) + x];
      let p2 = points[(y + 1) * (cols + 1) + x];
      let randomLen = rowSpacing * random(0.8, 1.4);
      sticks.push({ p1, p2, len: randomLen, active: true, col: x });
    }
  }
}

function draw() {
  background(252);
  updateVerlet();
  Engine.update(engine);
  render();
}

function updateVerlet() {
  let gravity = 0.6;
  let friction = 0.98;

  for (let p of points) {
    if (p.active && !p.pinned) {
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

  // 修复核心：所有约束迭代完成后，统一处理本帧收集的断裂
  // 每帧只允许断裂1根（防止连锁），下一帧再判断是否继续断
  if (pendingBreaks.length > 0) {
    // 找距离交互点最近的那根断
    let tx = touches.length > 0 ? touches[0].x : mouseX;
    let ty = touches.length > 0 ? touches[0].y : mouseY;
    pendingBreaks.sort((a, b) => {
      let da = dist(tx, ty, (a.p1.x + a.p2.x) / 2, (a.p1.y + a.p2.y) / 2);
      let db = dist(tx, ty, (b.p1.x + b.p2.x) / 2, (b.p1.y + b.p2.y) / 2);
      return da - db;
    });
    let s = pendingBreaks[0];
    s.active = false;
    handleChainBreak(s.p2);
    let idx = sticks.indexOf(s);
    if (idx !== -1) sticks.splice(idx, 1);
    pendingBreaks = [];
  }
}

function solveConstraints() {
  let tx = touches.length > 0 ? touches[0].x : mouseX;
  let ty = touches.length > 0 ? touches[0].y : mouseY;
  let isInteracting = mouseIsPressed || touches.length > 0;

  // 修复：预先找出离交互点最近的列（用实时位置，不用初始列索引）
  // 找最近的active point的col
  let nearestCol = -1;
  let nearestDist = Infinity;
  if (isInteracting) {
    for (let p of points) {
      if (!p.active) continue;
      let d = dist(tx, ty, p.x, p.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearestCol = p.col;
      }
    }
  }

  pendingBreaks = []; // 每次约束求解前清空

  for (let i = 0; i < 15; i++) {
    for (let j = 0; j < sticks.length; j++) {
      let s = sticks[j];
      if (!s.active) continue;

      let dx = s.p2.x - s.p1.x;
      let dy = s.p2.y - s.p1.y;
      let d = sqrt(dx * dx + dy * dy);

      // 修复：断裂判定移出迭代循环，只收集候选，不立即执行
      if (d > s.len * breakThreshold && isInteracting) {
        // 修复对称：用最近col判断，且限制col差值为0（必须是被直接接触的列）
        // 允许±1容差应对相邻列被带动的情况
        let colDist = abs(s.col - nearestCol);
        if (colDist <= 1 && i === 14) {
          // 只在最后一次迭代收集，避免重复
          pendingBreaks.push(s);
        }
      }

      let diff = ((s.len - d) / d / 2) * 0.8;
      let ox = dx * diff;
      let oy = dy * diff;

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
  let tx = touches.length > 0 ? touches[0].x : mouseX;
  let ty = touches.length > 0 ? touches[0].y : mouseY;
  let ptx = touches.length > 0 ? touches[0].px || tx : pmouseX;
  let pty = touches.length > 0 ? touches[0].py || ty : pmouseY;

  if (draggingPoint && draggingPoint.active) {
    draggingPoint.x = tx;
    draggingPoint.y = ty;
    draggingPoint.oldX = tx;
    draggingPoint.oldY = ty;
  }

  if (mouseIsPressed || touches.length > 0) {
    for (let p of points) {
      if (!p.active || p.pinned || p === draggingPoint) continue;
      let d = dist(tx, ty, p.x, p.y);
      if (d < interactRadius) {
        let angle = atan2(p.y - ty, p.x - tx);
        let force = (interactRadius - d) * 0.15;
        p.x += cos(angle) * force;
        p.y += sin(angle) * force;
        p.x += (tx - ptx) * 0.2;
        p.y += (ty - pty) * 0.2;
      }
    }
  }
}

function handleChainBreak(hitPoint) {
  let col = hitPoint.col;
  let startRow = hitPoint.row;

  for (let r = startRow; r <= rows; r++) {
    let p = points[r * (cols + 1) + col];
    if (p && p.active) {
      p.active = false;
      let vx = p.x - p.oldX;
      let vy = p.y - p.oldY;
      let bead = Bodies.circle(p.x, p.y, p.size / 2, {
        restitution: 0.5,
        friction: 0.3,
      });
      bead.renderData = { type: p.type, size: p.size, color: p.color };
      Body.setVelocity(bead, { x: vx, y: vy });
      World.add(world, bead);
      fallenBeads.push(bead);
    } else {
      break;
    }
  }

  for (let i = sticks.length - 1; i >= 0; i--) {
    let s = sticks[i];
    if (!s.p1.active || !s.p2.active) {
      s.active = false;
      sticks.splice(i, 1);
    }
  }
}

function render() {
  stroke(180, 150);
  strokeWeight(1.5);
  for (let s of sticks) {
    if (s.active) line(s.p1.x, s.p1.y, s.p2.x, s.p2.y);
  }
  noStroke();
  for (let p of points) {
    if (p.active && !p.pinned)
      drawBeadShape(p.x, p.y, 0, p.type, p.size, p.color);
  }
  for (let b of fallenBeads) {
    let d = b.renderData;
    drawBeadShape(b.position.x, b.position.y, b.angle, d.type, d.size, d.color);
  }
}

function drawBeadShape(x, y, angle, type, size, col) {
  push();
  translate(x, y);
  rotate(angle);
  fill(col);
  if (type === 0) ellipse(0, 0, size, size);
  else if (type === 1) drawDiamond(0, 0, size * 0.7);
  else rect(0, 0, size, size);
  fill(255, 120);
  ellipse(-size / 4, -size / 4, size / 4, size / 4);
  pop();
}

function drawDiamond(x, y, s) {
  beginShape();
  vertex(0, -1 * s);
  vertex(0.7 * s, 0);
  vertex(0, 1 * s);
  vertex(-0.7 * s, 0);
  endShape(CLOSE);
}

function mousePressed() {
  draggingPoint = findPoint(mouseX, mouseY);
}
function mouseReleased() {
  draggingPoint = null;
}

function touchStarted() {
  if (touches.length > 0) draggingPoint = findPoint(touches[0].x, touches[0].y);
  return false;
}
function touchEnded() {
  draggingPoint = null;
  return false;
}

function findPoint(x, y) {
  let closestDist = 30;
  let selected = null;
  for (let p of points) {
    if (!p.active) continue;
    let d = dist(x, y, p.x, p.y);
    if (d < closestDist) {
      closestDist = d;
      selected = p;
    }
  }
  return selected;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
