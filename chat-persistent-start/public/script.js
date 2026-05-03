function getOrCreateUserId() {
  let userID = localStorage.getItem("user-id");
  console.log(userID);
  // check if we have a userID already in local storage
  // if yes, return it
  // if not, create one and return it
  if (userID == undefined) {
    userID = "";
    userID = crypto.randomUUID();
    localStorage.setItem("user-id", userID);
    //make a new one
  }
  return userID;
}

let nameInput = document.querySelector("#nameInput");

const myUserId = getOrCreateUserId(); //refresh之后get这个
console.log("My userID:", myUserId);

//check if we have a username already

function getOrCreateUsername() {
  let username = localStorage.getItem("user-name");
  //console.log(userID);
  // check if we have a userID already in local storage
  // if yes, return it
  // if not, create one and return it
  if (username == undefined) {
    username = "";
    localStorage.setItem("user-name", username);
    //make a new one
  } else {
    nameInput.value = username;
  }
  return username;
}
let myUsername = getOrCreateUsername();

// start socket
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/lisa/port-4250/socket.io" }); // yields '/leon/port-4100/socket.io' or '/socket.io'
} else {
  socket = io();
}

let myInfo = {
  userId: myUserId,
  username: myUsername,
};
// "login" to server, sending out "identify"
// emit some message to server

console.log(myInfo);
socket.emit("identify", myInfo);

//handle username change
nameInput.addEventListener("change", function () {
  console.log("changed name", nameInput.value);
  let name = nameInput.value;
  console.log(nameInput.value);
  localStorage.setItem("user-name", name);
  // locally
  // tell server about it
});

let formeElm = document.querySelector("#chatForm");
console.log(formeElm);
let msgInput = document.querySelector("#newMessage");
console.log(msgInput);

// LISTEN FOR NEWLY TYPED MESSAGES,
// SEND THEM TO THE SERVER
formeElm.addEventListener("submit", newMessagesSubmitted);

function newMessagesSubmitted(event) {
  console.log(event);
  //stop form element from refreshing the page
  event.preventDefault();

  let newMsg = msgInput.value;
  console.log(newMsg);

  // appendMessage(newMsg); // just for fun,
  // actuaally we need to
  // send the new message to
  // the server first:
  socket.emit("message-from-client", {
    message: newMsg,
  });

  // clear out input:
  msgInput.value = "";
}

socket.on("message-from-server", function (data) {
  // waht do to with the messaeg from server
  console.log("got message", data);
  appendMessage(data);
});

socket.on("chat-history", function (data) {
  // deal with chat history
});

// APPEND MESSAGES TO BOX
// APPEND MESSAGES TO BOX
function appendMessage(data) {
  // console.log(data)
  // select list (ul) first
  let chatThreadList = document.querySelector("#threadWrapper ul");
  console.log(chatThreadList);

  // create new list item (li)
  let newListItem = document.createElement("li");
  if (data.sender.userId == myUserId) {
    newListItem.className = "fromMe";
  } else {
    newListItem.className = "fromOthers";
  }

  //sender
  let who = document.createElement("span");
  who.className = "who";
  who.innerText = data.sender.username || "anon";

  newListItem.append(who);

  //messsage
  let words = document.createElement("span");
  words.className = "words";
  words.innerText = data.text;

  newListItem.append(words);

  // append new li to the list
  chatThreadList.append(newListItem);

  // scroll to bottom of textbox:
  chatThreadList.scrollTop = chatThreadList.scrollHeight;
}
