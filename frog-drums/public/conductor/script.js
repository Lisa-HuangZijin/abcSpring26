let socket;
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/YOUR-NAME/YOUR-PORT/socket.io" }); // e.g. '/leon/port-4100/socket.io' or '/socket.io'
} else {
  socket = io();
}

// let readyButton = document.querySelector("#ready");
let mainWrapper = document.querySelector(".main-wrapper");
let w = window.innerWidth;
let h = window.innerHeight;
let frogs = [];

// socket communication

// inform server of my role
socket.emit("my-role", { role: "conductor" });
socket.on("frogs-already-online", function (data) {
  console.log("already-online", data);

  for (let i = 0; i < data.length; i++) {
    let frog = data[i];
    addFrog(frog.id, frog.frogIdx);
  }
});

//handle new frog
socket.on("new-frog", function (frog) {
  addFrog(frog.id, frog.frogIdx);
});

// handle deleting frogs
socket.on("delete-frog", function (frogId) {
  console.log(frogId, "disconnects");
  //find the related id, delete that div
  let frogDiv = document.querySelector("#A" + frogId);
  if (frogDiv) {
    frogDiv.remove();
  }
});

// addFrog("sdfobjweq", 0); // function test

function addFrog(socketID, frogIdx) {
  let imgWrapper = document.createElement("div");
  imgWrapper.className = "img-wrap";
  imgWrapper.id = "A" + socketID; // THIS IS IMPORTANT. EVERY FROG's HTML ID is the same as their socket Id
  imgWrapper.style.opacity = 0.3;
  imgElm = document.createElement("img");
  imgElm.src = "../imgs/frog" + frogIdx + ".png";
  imgWrapper.append(imgElm);
  mainWrapper.append(imgWrapper);

  // button socket communication:
  imgElm.addEventListener("click", function () {
    // handle opacity of frog button
    if (document.querySelector("#A" + socketID).style.opacity == 0.3) {
      document.querySelector("#A" + socketID).style.opacity = 1;
    } else {
      document.querySelector("#A" + socketID).style.opacity = 0.3;
    }

    console.log("clicked", socketID);
    // tell server we pressed the frig
    socket.emit("make-sound", socketID);
  });
}
