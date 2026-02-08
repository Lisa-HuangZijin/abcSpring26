let socket = io();
const requestMap = new Map();

let chatForm = document.querySelector("#chatForm");
let msgInput = document.querySelector("#newMessage");
let nameInput = document.querySelector("#nameWrapper input");
let postBtn = document.querySelector("#postRequestBtn");

//////////////message////////////////
function sendMessage(messageContent) {
  if (!messageContent) return;

  socket.emit("messageFromClient", {
    type: "CHAT",
    sender: document.querySelector("#nameWrapper input").value || "anonymous",
    message: messageContent,
  });
}

chatForm.addEventListener("submit", function (e) {
  e.preventDefault();

  const msg = msgInput.value.trim();
  if (msg) {
    sendMessage(msg);
    msgInput.value = "";
  }
});

let isCooldown = false;
function handleOrientation(event) {
  let beta = event.beta;
  //console.log(beta);

  if (beta < -40 && !isCooldown) {
    const msg = msgInput.value.trim();
    if (msg) {
      sendMessage(msg);
      isCooldown = true;
      msgInput.value = "";
      console.log("检测到翻转，消息已发出");
    }
  }

  if (beta > 0) {
    isCooldown = false; //防止疯狂倒出消息
  }
}

////////////////request//////////////////
postBtn.addEventListener("click", function () {
  const orderId = "request" + Date.now();
  socket.emit("messageFromClient", {
    type: "ORDER_POST",
    id: orderId,
    sender: nameInput.value || "anonymous",
    message: msgInput.value || "Mission Unlocked!",
    status: "open",
  });
  msgInput.value = "";
});

//////////////from server////////////////
socket.on("messageFromServer", function (data) {
  if (data.type === "CHAT" || data.type === "ORDER_POST") {
    appendMessage(data);
  } else if (data.type === "request_update") {
    const card = requestMap.get(data.id);
    if (card) {
      const btn = card.querySelector("button");
      if (btn) {
        btn.disabled = true;
        btn.innerText = "Mission Taken!";
        card.style.opacity = "0.6";

        startRain(); //给我下雨！！！
      }
    }
  }
});

function appendMessage(data) {
  let ul = document.querySelector("#threadWrapper ul");
  let card = document.createElement("li");

  let who = document.createElement("span");
  who.className = "who";
  who.innerText = (data.sender || "anonymous") + ":";
  card.append(who);

  let words = document.createElement("span");
  words.className = "words";
  words.innerText = data.message; //对message和request
  card.append(words);

  if (data.type === "ORDER_POST") {
    //如果是request
    card.className = "order-card";

    let btn = document.createElement("button");
    btn.className = "claim-btn";
    btn.innerText = "Leave it to me!";
    btn.onclick = function () {
      socket.emit("messageFromClient", {
        type: "ORDER_CLAIM",
        requestId: data.id,
        claimer: nameInput.value || "anonymous",
      });
    };
    card.append(btn);

    requestMap.set(data.id, card);
  }

  if (data.isSystem) card.style.color = "green";

  ul.append(card);
  ul.scrollTop = ul.scrollHeight;
}

function startRain() {
  const duration = 3000; // 下雨持续 3 秒
  const end = Date.now() + duration;

  const interval = setInterval(() => {
    if (Date.now() > end) {
      return clearInterval(interval);
    }

    const cheerRain = document.createElement("div");
    cheerRain.className = "cheerRain";
    cheerRain.innerText = "🎉";

    cheerRain.style.left = Math.random() * 100 + "vw"; //Viewport Width
    cheerRain.style.animationDuration = Math.random() * 2 + 2 + "s";
    cheerRain.style.fontSize = Math.random() * 20 + 20 + "px";

    document.body.appendChild(cheerRain);

    setTimeout(() => {
      cheerRain.remove();
    }, 4000);
  }, 100); //每100 毫秒生成一个 🎉
}
