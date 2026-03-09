const { Engine, World, Bodies, Composite, Runner, Body } = Matter; // 增加了 Body

let socket;
let fallingWords = [];
let words = []; //存储matter.js的物理身体
let wordCount = 0;
let wordPondlimit = 10;

let engine;
let world;
let ground, leftWall, rightWall;

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");

  //初始化物理引擎
  engine = Engine.create();
  world = engine.world;
  engine.world.gravity.y = 0.8;

  //给matter.js的边界
  ground = Bodies.rectangle(width / 2, height + 25, width, 50, {
    isStatic: true,
  });
  leftWall = Bodies.rectangle(-25, height / 2, 50, height, { isStatic: true });
  rightWall = Bodies.rectangle(width + 25, height / 2, 50, height, {
    isStatic: true,
  });
  World.add(world, [ground, leftWall, rightWall]);

  Runner.run(engine);

  if (
    location.hostname.toLowerCase().startsWith("browsercircus") ||
    location.hostname.toLowerCase().startsWith("www")
  ) {
    socket = io({ path: "/lisa/port-4250/phone/socket.io" }); // e.g. '/leon/port-4100/socket.io' or '/socket.io'
  } else {
    socket = io();
  }
  socket.emit("my-role", { role: "phone" });
  socket.emit("update-phone-width", { width: width });

  socket.on("drop-in-phone", (data) => {
    let x = data.x_ratio * width;
    fallingWords.push(new FallingWord(x, -20, data.text, data.x_ratio));
  });
}

function draw() {
  background(11, 21, 107);

  //看一下多少字了
  fill(255, 100);
  textSize(16);
  text("Count: " + wordCount, 20, 30);

  for (let i = 0; i < words.length; i++) {
    words[i].show();
  }

  //倒叙，防止更新而跳过
  for (let i = fallingWords.length - 1; i >= 0; i--) {
    let w = fallingWords[i];
    w.update();
    w.display();

    let triggerY;

    if (wordCount < wordPondlimit) {
      triggerY = height - 20;
    } else {
      triggerY = 50;
    }

    if (w.y > triggerY) {
      if (wordCount < wordPondlimit) {
        socket.emit("phone-to-tablet", { text: w.txt, x_ratio: w.xRatio });
        wordCount++;
      } else {
        let newBody = new WordBody(w.x, w.y, w.txt, w.vel);
        words.push(newBody);
        wordCount++;
      }

      fallingWords.splice(i, 1);
    }
  }
}

class FallingWord {
  constructor(x, y, txt, xRatio) {
    this.x = x;
    this.y = y;
    this.txt = txt;
    this.xRatio = xRatio;
    this.vel = 0;
    this.acc = 0.15;
  }

  update() {
    this.vel += this.acc;
    this.y += this.vel;
  }

  display() {
    fill(255);
    noStroke();
    textAlign(CENTER, CENTER);
    textFont("Courier New");
    textSize(25);
    text(this.txt, this.x, this.y);
  }
}

class WordBody {
  constructor(x, y, txt, initialVelY) {
    this.txt = txt;

    textSize(25);
    let tw = textWidth(txt) - 6;
    let th = 20;

    this.body = Bodies.rectangle(x, y, tw, th, {
      restitution: 0.3,
      friction: 0.5,
      frictionAir: 0.01,
    });

    if (initialVelY !== undefined) {
      Body.setVelocity(this.body, { x: 0, y: initialVelY });
    }

    World.add(world, this.body);
  }

  show() {
    let pos = this.body.position;
    let angle = this.body.angle;

    push();
    translate(pos.x, pos.y);
    rotate(angle);
    fill(255);
    noStroke();
    textAlign(CENTER, CENTER);
    textFont("Courier New");
    textSize(25);
    text(this.txt, 0, 0);
    pop();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
