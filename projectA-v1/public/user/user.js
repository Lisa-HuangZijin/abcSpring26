let socket;
let inputField;
let sendButton;

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");

  socket = io();
  //注册角色为 user
  socket.on("connect", () => {
    console.log("User connect，ID:", socket.id);
    socket.emit("my-role", { role: "user" });
  });

  //创建输入框
  // inputField = createInput("");
  // inputField.id("inputField");
  // document.querySelector("#inputField").addEventListener("input", function (e) {
  //   console.log(e.data);
  // });
  // inputField.position(width / 2 - 100, height / 2 - 20);
  // inputField.size(200, 30);
  // inputField.style("font-family", "Courier New");

  // //发送按钮
  // sendButton = createButton("SEND TO POND");
  // sendButton.position(width / 2 - 100, height / 2 + 30);
  // sendButton.size(200, 40);
  // sendButton.style("background-color", "#ffffff");
  // sendButton.style("font-family", "Courier New");
  // sendButton.mousePressed(sendMessage);
}

let formeElm = document.querySelector("#chatForm");
console.log(formeElm);
let msgInput = document.querySelector("#newMessage");
console.log(msgInput);

formeElm.addEventListener("submit", newMessageSubmitted);

function newMessageSubmitted(event) {
  console.log("typed a message!", event);
  event.preventDefault();

  // console.log(msgInput.value);
  let newText = msgInput.value;
  sendMessage(newText);
  // appendMessage(newMsg)

  // let messageData = {
  //   // <---------
  //   sender: nameInput.value, // <---------
  //   message: newMsg, // <---------
  // };
  // // SEND THEM TO THE SERVER
  // socket.emit("messageFromClient", messageData); // <---------

  // clear textbox:
  msgInput.value = ""; // <---------
}

function sendMessage(txt) {
  if (txt.length > 0) {
    let data = {
      text: txt,
    };

    socket.emit("send-to-phone", data);
    console.log("Sent to phone:", txt);

    //清空输入框
    // inputField.value("");
  }
}

function draw() {
  background(11, 21, 107);

  fill(255);
  noStroke();
  textAlign(CENTER);
  textFont("Courier New");
  textSize(20);
  text("WRITE YOUR MESSAGE", width / 2, height / 2 - 60);
}
