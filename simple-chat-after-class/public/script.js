let socket = io();

let formeElm = document.querySelector("#chatForm");
console.log(formeElm);
let msgInput = document.querySelector("#newMessage");
console.log(msgInput);
let nameInput = document.querySelector("#nameWrapper input"); // <---------

// LISTEN FOR NEWLY TYPES MESSAGES, 
formeElm.addEventListener("submit", newMessageSubmitted);

function newMessageSubmitted(event){
    console.log("typed a message!", event);
    event.preventDefault();

    // console.log(msgInput.value);
    let newMsg = msgInput.value;
    // appendMessage(newMsg)

    let messageData = { // <---------
        sender: nameInput.value, // <---------
        message: newMsg // <---------
    }
    // SEND THEM TO THE SERVER
    socket.emit("messageFromClient", messageData); // <---------

    // clear textbox:
    msgInput.value = "";    // <---------
}

// LISTEN FOR NEW MESSAGES FROM SERVER
// APPEND THEM TO THE MESSAGE BOX
// AUTO SCROLL TO BOTTOM
socket.on("messageFromServer", function(msgData){
    console.log("got a message i think? ", msgData);
    appendMessage(msgData)
})

// APPEND MESSAGES TO BOX
function appendMessage(data){  
    // console.log(data)
    // select list (ul) first
    let chatThreadList = document.querySelector("#threadWrapper ul");
    console.log(chatThreadList)

    // create new list item (li)
    let newListItem = document.createElement("li");

    //sender
    let who = document.createElement("span"); // <---------
    who.className = "who";  // <---------
    who.innerText = data.sender+":" || "anonymous:"; // <---------

    newListItem.append(who); // <---------

    //messsage
    let words = document.createElement("span"); // <---------
    words.className = "words"; // <---------
    words.innerText = data.message; // <---------

    newListItem.append(words); // <---------

    // append new li to the list 
    chatThreadList.append(newListItem);

    // scroll to bottom of textbox:
    chatThreadList.scrollTop = chatThreadList.scrollHeight;
}

// OPTIONAL: LISTEN FOR NEW NAME
// SEND IT TO SERVER
