const lipPos = [
    { x: 0.35, y: 0.50 },
    { x: 0.5, y: 0.45 },
    { x: 0.65, y: 0.5 },
    { x: 0.5, y: 0.55 },
  ];
let balls=[];
let springs=[];

let bindings=new Map();
const pickR = 35; 
const dragFactor = 0.3;   
let osc;
let audioReady=false;
let unlocked=false;

let img;

function preload(){
  img = loadImage('assets/back.png')
}

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");

  

  for (let p of lipPos) {
    balls.push(new Ball(width * p.x, height * p.y,10));
  }

  for (let i=0 ; i<balls.length-1; i++){
    springs.push(new Spring(balls[i],balls[i+1],140,0.06))
  }
  springs.push(new Spring(balls[0],balls[3],140,0.06) );
  springs.push(new Spring(balls[1],balls[3],80,0.06) );
  springs.push(new Spring(balls[0],balls[2],240,0.02) );
  
  osc=new p5.Oscillator('sine');
  osc.amp(0);

}

function draw() {
  
  background(255);
  image(img, 0, 0, width, height, 0, 0, img.width, img.height, CONTAIN);
  fill(0);

  if (!unlocked) {
  background(255);
  fill(0);
  textAlign(CENTER, CENTER);
  textSize(18);
  text("Tap to enable sound", width/2, height/2-10);
  text("don't forget to turn off Silent Mode ;)", width/2, height/2+10)
  return;
}

  syncBindings();
  // circle(width * 0.35, height * 0.5,10);
  // circle(width * 0.45 , height * 0.45,10);
  // circle(width * 0.55,  height * 0.45,10);
  // circle(width * 0.65, height * 0.5,10);
  // circle(width * 0.5,  height * 0.55,10);

  for (let i = 0; i < springs.length; i++) {
  let s = springs[i];
  s.update();

  if (i < 4) {
    s.display();
  }
}
 //如果用continue写的话👇
//  for (let i = 0; i < springs.length; i++) {
//   let s = springs[i];
//   s.update();  

//   if (i >= 4) {
//     continue;       
//   }

//   s.display();       
// }

  // fill(255,0,0)
  // circle(balls[1].pos.x-25,balls[1].pos.y,60)
  // circle(balls[1].pos.x+25,balls[1].pos.y,60)
  // circle(balls[3].pos.x,balls[3].pos.y,55)

let leftCorner = balls[0].pos;
let rightCorner = balls[2].pos;
let upperCenter = balls[1].pos;

let angle = atan2(rightCorner.y - leftCorner.y, rightCorner.x - leftCorner.x);

push();
translate(upperCenter.x, upperCenter.y);
rotate(angle);
fill(255, 0, 0);
circle(-25, 0, 60);
circle( 25, 0, 60);
pop();//upper lips

fill(255,0,0)
circle(balls[3].pos.x, balls[3].pos.y, 55);//lower lip

  applyTouchDragForces();

  for (let b of balls){
    //b.drag();
    b.update();
    b.display();
  }
  
  updateSound()

  noStroke();
  fill(0);
  for (let t of touches) {
    circle(t.x, t.y, 12);//touch point
  }
// console.log(balls[1].pos.dist(balls[3].pos)) //82.xxx
// console.log(balls[0].pos.dist(balls[2].pos)) //260.26xxx
}

// P5 touch events: https://p5js.org/reference/#Touch

function touchStarted() {
  console.log(touches);

  if(!unlocked){
    unlockAudio();
    return false;
  }

  userStartAudio();
  //console.log("audio state:", getAudioContext().state);
  audioReady = true;

  for (let ti = 0; ti < touches.length; ti++) {
    let t = touches[ti];

    if (bindings.has(t.id)) {//skip
    } else {
      let best = null;//没对象就给你找一个
      let bestDist = null;

      for (let i = 0; i < balls.length; i++) {
        if (isBallTaken(i)) {
        } else {
          let d = dist(t.x, t.y, balls[i].pos.x, balls[i].pos.y);

          if (bestDist === null || d < bestDist) {
            bestDist = d;//shortest distance
            best = i;
          }
        }
      }

      if (best !== null && bestDist !== null && bestDist <= pickR) {
  bindings.set(t.id, best);
}
    }
  }
  return false;
}


function touchMoved() {
  return false;
}

function touchEnded() {
  return false;
}

function unlockAudio(){
  userStartAudio();
  const ac = getAudioContext();
  ac.resume();

  osc.start();

  osc.start();
  osc.freq(440);
  osc.amp(0.6,0.01);

  unlocked=true;
  audioReady=true;

  console.log("audio state after unlock:", ac.state);
}

function updateSound(){
  if (!audioReady) return;

  let d = dist(balls[1].pos.x, balls[1].pos.y,balls[3].pos.x, balls[3].pos.y);

  let a=0;

  if (d<75){
    a=map(d,0,40,0.3,0)
  } else if (d<=85){
    a=0
  }else if (d>85){
    a=map(d,65,120,0,0.8)
  }


  let f = constrain(map(d, 40, 330, 180, 520), 180, 520);
  osc.freq(f);
  osc.amp(a, 0.02);
  console.log(d)

}

function syncBindings(){
  let aliveIds = [];

  for (let i = 0; i < touches.length; i++) {
    aliveIds.push(touches[i].id);
  } //collect alive touch id

  bindings.forEach(function(ballIndex,touchId){ //value,key
    let stillAlive=false;

    for (let j=0; j<aliveIds.length; j++){
      if (aliveIds[j]===touchId){
        stillAlive=true;
        break; //不用检查了，跳出循环
      }
    }

    if(!stillAlive){
      bindings.delete(touchId);
    }
  });
}

function isBallTaken(ballIndex){
  for (let [,bi] of bindings){
    if (bi===ballIndex){
      return true;
    }
  }
  return false;
}

function applyTouchDragForces(){
  for(let t of touches){
    let bi=bindings.get(t.id); //查找这个手指有没有绑ball
    if (bi===undefined) continue;

    let b=balls[bi];
    let force=createVector(t.x-b.pos.x,t.y-b.pos.y)

    force.mult(dragFactor*b.mass);
    b.applyForce(force);
  }
}

let C_GRAVITY = 1;
let DISTANCE_BTW_BALLS = 30;

class Spring {
  constructor(a, b, restLength, stiffness) {
    this.bobA = a;
    this.bobB = b;
    this.len = restLength;
    this.k = stiffness; // spring constant
  }
  update() {
    let vector = p5.Vector.sub(this.bobB.pos, this.bobA.pos);
    let distance = vector.mag();
    let stretch = distance - this.len;
    let strength = -1 * stretch * this.k; // hooke's law

    // force to bobB
    let force = vector.copy();
    force.normalize();
    force.mult(strength);
    this.bobB.applyForce(force);

    // force to bobB
    let force1 = vector.copy();
    force1.normalize();
    force1.mult(strength * -1);
    this.bobA.applyForce(force1);

    //text(strength.toFixed(2), this.bobB.pos.x + 50, this.bobB.pos.y);
  }
  display() {
    strokeWeight(15);
    stroke(255,0,0); //烈焰红唇啊哈哈哈
    line(this.bobA.pos.x, this.bobA.pos.y, this.bobB.pos.x, this.bobB.pos.y);
  }
}

class Ball {
  constructor(x, y, rad) {
    this.pos = createVector(x, y);
    this.vel = createVector(0, 0);
    this.acc = createVector(0, 0);
    this.rad = rad;
    this.mass = rad * 0.5; 
    this.damping = 0.9; 
  }
  update() {
    this.vel.add(this.acc);
    this.pos.add(this.vel);
    this.acc.mult(0);

    this.vel.mult(this.damping);
  }
  applyForce(f) {
    if (this.mass > 0) {
      let force = p5.Vector.div(f, this.mass);
      this.acc.add(force);
    }
  }
  // reappear() {
  //   if (this.pos.x < 0) {
  //     this.pos.x = width;
  //   } else if (this.pos.x > width) {
  //     this.pos.x = 0;
  //   }
  //   if (this.pos.y < 0) {
  //     this.pos.y = height;
  //   } else if (this.pos.y > height) {
  //     this.pos.y = 0;
  //   }
  // }
  // drag() {
  //   if (mouseIsPressed) {
  //     let distance = dist(this.pos.x, this.pos.y, mouseX, mouseY);
  //     if (distance < this.rad) {
  //       // in
  //       this.pos.x = mouseX;
  //       this.pos.y = mouseY;
  //     }
  //   }
  // }

  display() {
    push();
    translate(this.pos.x, this.pos.y);
    stroke(124,21,35);
    strokeWeight(4)
    noFill();
    circle(0, 0, this.rad * 2);
    pop();
  }
}


function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
}

