let socket;

const formeElm = document.querySelector("#chatForm");
const msgInput = document.querySelector("#newMessage");

if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/lisa/port-4250/socket.io" });
} else {
  socket = io();
}

socket.on("connect", () => {
  console.log("User connected, ID:", socket.id);
  socket.emit("my-role", { role: "user" });
});

formeElm.addEventListener("submit", newMessageSubmitted);

function newMessageSubmitted(event) {
  event.preventDefault();

  let newText = msgInput.value.trim();

  if (newText.length > 0) {
    sendMessage(newText);

    // --- 新增：创建并添加消失的消息 ---
    appendFadingMessage(newText);

    msgInput.value = "";
    console.log("Message sent to server:", newText);
  }
}

function appendFadingMessage(txt) {
  const wrapper = document.querySelector(".canvas-wrapper");

  // 1. 创建容器
  const msgContainer = document.createElement("div");
  msgContainer.className = "fade-out-msg";

  // 2. 构造内部 HTML (气泡 + 对应的 User 头像)
  // 这里直接复用了你之前的 user-style 气泡和头像 SVG 代码
  msgContainer.innerHTML = `
  <svg class="error-icon" width="40" height="40" viewBox="0 0 22 40" fill="none" stroke="#ff4444" stroke-width="1.5">
  <circle cx="11" cy="20" r="10"></circle>
  <line x1="11" y1="14" x2="11" y2="21" stroke-width="2"></line>
  <line x1="11" y1="24" x2="11" y2="27" stroke-width="2"></line>
</svg>
    <div class="bubble user-style">${txt}</div>
    <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="19" stroke="rgba(255,255,255,0.4)" stroke-width="1" fill="rgba(255,255,255,0.4)" />
    </svg>
  `;

  wrapper.appendChild(msgContainer);

  setTimeout(() => {
    msgContainer.remove();
  }, 1500);
}

function sendMessage(txt) {
  let data = { text: txt };
  socket.emit("send-to-phone", data);
}

// 这行代码会“唤醒”移动端浏览器的 :active 状态
document.addEventListener("touchstart", function () {}, true);
