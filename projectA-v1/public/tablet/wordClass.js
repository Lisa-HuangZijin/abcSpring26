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

    for (let i = 0; i < others.length; i++) {
      if (i !== index) {
        let other = others[i];
        let d = dist(this.pos.x, this.pos.y, other.pos.x, other.pos.y);

        //堆积感1，字体的半径变了
        if (d < currentRadius) {
          let angle = atan2(this.pos.y - other.pos.y, this.pos.x - other.pos.x);
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
