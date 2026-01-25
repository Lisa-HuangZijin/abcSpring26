let ballsTouched=[];


function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");

}

function draw() {
  background(90, 200, 190);
  syncBindings();
  
  fill(0);
  for (let f of ballsTouched) {
    circle(f.x, f.y, 50);
  }

}

// P5 touch events: https://p5js.org/reference/#Touch

function touchStarted() {
  console.log(touches);
  // syncBindings();
  //return false;

}

function touchMoved() {
  //syncBindings();
  //return false;
}

function touchEnded() {
  //syncBindings();
  //return false;
}

function syncBindings(){
  let newFingers=[];
  for (let t of touches){
    let existing=undefined;

for (let i=0; i<ballsTouched.length; i++) {
  let f=ballsTouched[i];
  if (f.id===t.id) {
    existing=f;
    break;
  }
}

    if (existing){
      existing.x=t.x;
      existing.y=t.y;
      newFingers.push(existing);
    }else{
      newFingers.push({
        id:t.id, 
        x:t.x,
        y:t.y
      })
    }
  }
  ballsTouched=newFingers;
}

function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
}

