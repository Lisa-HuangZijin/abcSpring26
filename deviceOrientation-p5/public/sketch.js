let alpha = 0,
  beta = 0,
  gamma = 0;
let ball;

let accelScale = 0.04; // 不要走太快我的球
let beta0 = 0,
  gamma0 = 0;

let currentZone = "";
let lastZone = "";

let osc, env;

const NOTE_FREQ = [
  261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 277.18, 311.13, 369.99,
  554.37, 415.3, 466.16, 523.25,
];

const ZONE_ORDER = [
  "L0",
  "L1",
  "L2",
  "L3",
  "T0",
  "T1",
  "T2",
  "R0",
  "R1",
  "R2",
  "R3",
  "B0",
  "B1",
  "B2",
];

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  ball = new Ball(width / 2, height / 2, 45);

  osc = new p5.Oscillator("sine");
  env = new p5.Envelope();
  env.setADSR(0.01, 0.12, 0.0, 0.2); // attack, decay, sustain, release
  env.setRange(0.6, 0); //
  osc.start();
  osc.amp(0);
}

function draw() {
  background(0, 16, 32);

  let ax = (gamma - gamma0) * accelScale;
  let ay = (beta - beta0) * accelScale;

  ax = constrain(ax, -5, 5);
  ay = constrain(ay, -5, 5);

  ball.applyForce(createVector(ax, ay));
  ball.update();
  ball.collideEdges();
  ball.display();

  currentZone = getCurrentZone();
  drawEdgeRect(currentZone);

  if (currentZone !== lastZone) {
    triggerZoneSound(currentZone);
    lastZone = currentZone;
  }

  fill(0);
  text(`beta: ${round(beta)}  gamma: ${round(gamma)}`, 10, 20);
}

function segmentIndex(value, totalLength, segments) {
  let step = totalLength / segments;
  let idx = Math.floor(value / step);
  return constrain(idx, 0, segments - 1);
}

function getCurrentZone() {
  let eps = 1; // 容错
  let zone = "";

  let onLeft = ball.pos.x <= ball.rad + eps;
  let onRight = ball.pos.x >= width - ball.rad - eps;
  let onTop = ball.pos.y <= ball.rad + eps;
  let onBottom = ball.pos.y >= height - ball.rad - eps;

  if (onLeft) {
    let seg = segmentIndex(ball.pos.y, height, 4);
    zone = "L" + seg;
  } else if (onRight) {
    let seg = segmentIndex(ball.pos.y, height, 4);
    zone = "R" + seg;
  } else if (onTop) {
    let seg = segmentIndex(ball.pos.x, width, 3);
    zone = "T" + seg;
  } else if (onBottom) {
    let seg = segmentIndex(ball.pos.x, width, 3);
    zone = "B" + seg;
  } else {
    zone = "";
  }

  return zone;
}

function drawEdgeRect(zone) {
  let thickness = 10;

  noStroke();

  let H = height / 4;
  for (let i = 0; i < 4; i++) {
    if (zone === "L" + i) fill(64, 255, 169);
    else fill(0, 43, 53);

    rect(0, i * H, thickness, H);
  }

  for (let i = 0; i < 4; i++) {
    if (zone === "R" + i) fill(64, 255, 169);
    else fill(0, 43, 53);

    rect(width - thickness, i * H, thickness, H);
  }

  let W = width / 3;
  for (let i = 0; i < 3; i++) {
    if (zone === "T" + i) fill(64, 255, 169);
    else fill(0, 43, 53);

    rect(i * W, 0, W, thickness);
  }

  for (let i = 0; i < 3; i++) {
    if (zone === "B" + i) fill(64, 316, 169);
    else fill(0, 43, 53);

    rect(i * W, height - thickness, W, thickness);
  }
}

function zoneToNote(zone) {
  let idx = ZONE_ORDER.indexOf(zone); //indexOf是返回zone所对应的index number
  if (idx === -1) return null; //不存在就是-1，比较保险
  return NOTE_FREQ[idx];
}

function triggerZoneSound(zone) {
  if (!zone) return;

  let freq = zoneToNote(zone);
  if (!freq) return;

  osc.freq(freq);
  env.play(osc, 0, 0.35); //响0.35秒
}

class Ball {
  constructor(x, y, rad) {
    this.pos = createVector(x, y);
    this.vel = createVector(0, 0);
    this.acc = createVector(0, 0);
    this.rad = rad;

    this.mass = 2;
    //this.damping = 0.98; // 摩擦
    this.bounce = 0.7; // 损失一部分能量
  }

  applyForce(f) {
    this.acc.add(p5.Vector.div(f, this.mass));
  }

  update() {
    this.vel.add(this.acc);
    this.pos.add(this.vel);
    this.acc.mult(0);
    //this.vel.mult(this.damping);
  }

  collideEdges() {
    if (this.pos.x < this.rad) {
      this.pos.x = this.rad;
      this.vel.x *= -this.bounce;
    } else if (this.pos.x > width - this.rad) {
      this.pos.x = width - this.rad;
      this.vel.x *= -this.bounce;
    } // left / right

    if (this.pos.y < this.rad) {
      this.pos.y = this.rad;
      this.vel.y *= -this.bounce;
    } else if (this.pos.y > height - this.rad) {
      this.pos.y = height - this.rad;
      this.vel.y *= -this.bounce;
    } // top / bottom
  }

  display() {
    push();
    translate(this.pos.x, this.pos.y);
    noStroke();
    fill(222, 86, 94);
    circle(0, 0, this.rad * 2 - 20);
    pop();
  }
}

// P5 touch events: https://p5js.org/reference/#Touch

function touchStarted() {
  console.log(touches);
  userStartAudio();
  // beta0 = beta;//这样初始的位置就是最平的位置
  // gamma0 = gamma;
}

function touchMoved() {}

function touchEnded() {}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function handleOrientation(eventData) {
  document.querySelector("#requestOrientationButton").style.display = "none";

  //console.log(eventData.alpha, eventData.beta, eventData.gamma);

  alpha = eventData.alpha;
  beta = eventData.beta;
  gamma = eventData.gamma;
}
