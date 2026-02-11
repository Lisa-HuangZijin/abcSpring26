// let socket = io();
// socket connection that works locally and on the server:
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/lisa/port-4250/socket.io" }); // e.g. '/leon/port-4100/socket.io' or '/socket.io'
} else {
  socket = io();
}

let formeElm = document.querySelector("#chatForm");
console.log(formeElm);
let msgInput = document.querySelector("#newMessage");
console.log(msgInput);

//socket.emit("message", newMsg);

// LISTEN FOR NEWLY TYPES MESSAGES,
formeElm.addEventListener("submit", newMessageSubmitted);

function newMessageSubmitted(event) {
  console.log("typed a message", event);
  event.preventDefault();

  //console.log(msgInput.value);
  let newMsg = msgInput.value;
  //   appendMessage(newMsg);

  // SEND THEM TO THE SERVER
  socket.emit("messageFromClient", newMsg);
}

// LISTEN FOR NEW MESSAGES FROM SERVER
// APPEND THEM TO THE MESSAGE BOX
// AUTO SCROLL TO BOTTOM
socket.on("messageFromServer", function (msgData) {
  console.log("got a message I think?", msgData);
  appendMessage(msgData.message);
});

// APPEND MESSAGES TO BOX
function appendMessage(txt) {
  console.log(txt);
  // select list (ul) first
  let chatThreadList = document.querySelector("#threadWrapper ul");
  console.log(chatThreadList);

  // create new list item (li)
  let newListItem = document.createElement("li");
  newListItem.innerText = txt;

  // append new li to the list
  chatThreadList.append(newListItem);

  // scroll to bottom of textbox:
  chatThreadList.scrollTop = chatThreadList.scrollHeight;
}

// OPTIONAL: LISTEN FOR NEW NAME
// SEND IT TO SERVER
