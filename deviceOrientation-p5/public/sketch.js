let alpha = 0,
  beta = 0,
  gamma = 0;
let ball;

let accelScale = 0.04; // 不要走太快我的球
let beta0 = 0,
  gamma0 = 0;

// let currentZone = "";
// let lastZone = "";

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  ball = new Ball(width / 2, height / 2, 45);
}

function draw() {
  background(90, 200, 190);

  let ax = (gamma - gamma0) * accelScale;
  let ay = (beta - beta0) * accelScale;

  ax = constrain(ax, -5, 5);
  ay = constrain(ay, -5, 5);

  ball.applyForce(createVector(ax, ay));
  ball.update();
  ball.collideEdges();
  ball.display();

  fill(0);
  text(`beta: ${round(beta)}  gamma: ${round(gamma)}`, 10, 20);
}

// function segmentIndex(value, totalLength, segments) {
//   let step = totalLength / segments;
//   let idx = Math.floor(value / step);
//   return constrain(idx, 0, segments - 1);
// }

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
    stroke(255, 0, 0);
    fill(255, 150);
    circle(0, 0, this.rad * 2 - 20);
    pop();
  }
}

// P5 touch events: https://p5js.org/reference/#Touch

function touchStarted() {
  console.log(touches);
  //userStartAudio();
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

  console.log(eventData.alpha, eventData.beta, eventData.gamma);

  alpha = eventData.alpha;
  beta = eventData.beta;
  gamma = eventData.gamma;
}
