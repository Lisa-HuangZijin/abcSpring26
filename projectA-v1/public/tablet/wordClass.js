// public/common.js

class Ripple {
  constructor(x, y, id) {
    this.x = x;
    this.y = y;
    this.id = id;
    this.r = 0;
    this.life = 255;
    this.isDead = false;
  }
  update() {
    this.r += 10;
    this.life -= 10;
    if (this.life <= 0) this.isDead = true;
  }
  display() {
    noFill();
    stroke(255, this.life * 0.4);
    ellipse(this.x, this.y, this.r * 2);
  }
}

class AcidWord {
  constructor(x, y, txt, rID) {
    this.pos = createVector(x, y);
    this.basePos = this.pos.copy();
    this.vel = createVector(0, 0.1);
    this.txt = txt;
    this.sourceRippleID = rID;
    this.lastRippleID = -1;

    this.maxRepelRadius = 160; //四周：疏散半径
    this.minRepelRadius = 22;
  }
  applyRepulsion(others, index) {
    // 1. 如果这个词已经很安静了，没必要每帧都计算复杂的排斥
    if (this.vel.magSq() < 0.001 && frameCount % 2 === 0) return;

    // 依然计算一次开方，因为你需要这个精确的线性距离来计算 radius
    let distToCenter = dist(
      this.pos.x,
      this.pos.y,
      this.basePos.x,
      this.basePos.y,
    );

    let currentRadius = map(
      distToCenter,
      0,
      300,
      this.minRepelRadius,
      this.maxRepelRadius,
    );
    currentRadius = constrain(
      currentRadius,
      this.minRepelRadius,
      this.maxRepelRadius,
    );

    // 关键：预存半径的平方
    let rSq = currentRadius * currentRadius;

    for (let i = 0; i < others.length; i++) {
      if (i !== index) {
        let other = others[i];
        let dx = this.pos.x - other.pos.x;
        let dy = this.pos.y - other.pos.y;

        // 2.【核心优化】先用平方进行极其快速的预判
        let dSq = dx * dx + dy * dy;

        // 如果平方距离已经大于半径平方，那它们绝对没有碰撞，直接跳过
        if (dSq < rSq && dSq > 0) {
          // 3. 只有确认进入了“排斥圈”的少数文字，才执行昂贵的 dist/atan2/map
          let d = sqrt(dSq);
          let angle = atan2(dy, dx);
          let strengthFactor = map(distToCenter, 0, 200, 0.1, 1.0);
          let strength = map(d, 0, currentRadius, 0.8, 0) * strengthFactor;

          this.vel.add(cos(angle) * strength, sin(angle) * strength);
        }
      }
    }
  }
  update(ripples) {
    for (let r of ripples) {
      // 1. 不能被自己生的涟漪推 2. 每个涟漪只能推一次
      if (r.id !== this.sourceRippleID && r.id !== this.lastRippleID) {
        let d = dist(this.pos.x, this.pos.y, r.x, r.y);
        if (d < r.r && d > r.r - 30) {
          let angle = atan2(this.pos.y - r.y, this.pos.x - r.x);
          this.vel.add(cos(angle) * 12, sin(angle) * 12);
          this.lastRippleID = r.id;
        }
      }
    }

    this.pos.add(this.vel);
    this.vel.mult(0.85);

    // 堆积感2
    // 越往外，被拉回中心的力量越强，形成中心重叠更多，周围重叠更少
    let distToCenter = dist(
      this.pos.x,
      this.pos.y,
      this.basePos.x,
      this.basePos.y,
    );
    let pullStrength = map(distToCenter, 0, 500, 0.01, 0.08);

    this.pos.x = lerp(this.pos.x, this.basePos.x, pullStrength);
    this.pos.y = lerp(this.pos.y, this.basePos.y, pullStrength);
  }
  display() {
    push();
    translate(this.pos.x, this.pos.y);
    textAlign(CENTER, CENTER);
    textFont("Courier New");
    textSize(25);
    noStroke();
    fill(255);
    text(this.txt, 0, 0);
    pop();
  }
}
