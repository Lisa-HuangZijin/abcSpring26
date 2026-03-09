let socket;
let wordEntities = [];
let ripples = [];
let rippleCounter = 0;

let activePhoneWidth = 400;

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");

  if (
    location.hostname.toLowerCase().startsWith("browsercircus") ||
    location.hostname.toLowerCase().startsWith("www")
  ) {
    socket = io({ path: "/lisa/port-4250/tablet/socket.io" }); // e.g. '/leon/port-4100/socket.io' or '/socket.io'
  } else {
    socket = io();
  }

  socket.emit("my-role", { role: "tablet" });

  socket.on("update-phone-layout", (data) => {
    console.log("updated-phone-width:", data.width);
    activePhoneWidth = data.width;
  });

  //平板接收手机传输过来的文字和具体掉落位置
  socket.on("new-letter", (data) => {
    console.log("letter-recieved:", data.text);

    if (data.currentPhoneWidth) {
      activePhoneWidth = data.currentPhoneWidth;
    }

    let pW = activePhoneWidth;
    let offsetX = (width - pW) / 2;
    let targetX = offsetX + data.x_ratio * pW;

    let offsetY = (random(-60, 60) + random(-60, 60)) / 2;
    let targetY = height / 2 + offsetY;

    //targetY = height / 2 + random(-60, 60); //0.5 + (Math.random() - 0.5) * 0.4

    rippleCounter++;
    visualViewport;
    let rID = rippleCounter;

    ripples.push(new Ripple(targetX, targetY, rID));
    wordEntities.push(new AcidWord(targetX, targetY, data.text, rID));

    //socket.emit("update-word-count-toPile", { count: wordEntities.length });
  });
}

function draw() {
  background(11, 21, 107);
  //  for (let p of particles) {
  //   // p.update(ripples);
  //   // p.display();
  // }

  for (let i = ripples.length - 1; i >= 0; i--) {
    ripples[i].update();
    ripples[i].display();
    if (ripples[i].isDead) ripples.splice(i, 1);
  }

  for (let i = 0; i < wordEntities.length; i++) {
    let f = wordEntities[i];
    f.applyRepulsion(wordEntities, i); // 文字间小排斥
    f.update(ripples);
    f.display();
  }

  //可以看到检查
  // push();
  // stroke(255, 50);
  // let debugX = (width - activePhoneWidth) / 2;
  // line(debugX, 0, debugX, height);
  // line(debugX + activePhoneWidth, 0, debugX + activePhoneWidth, height);
  // pop();
}
