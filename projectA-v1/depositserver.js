const express = require("express");
const https = require("https");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const portHTTPS = 4251;

app.use(express.static("public"));

const options = {
  key: fs.readFileSync("keys-for-local-https/localhost-key.pem"),
  cert: fs.readFileSync("keys-for-local-https/localhost.pem"),
};

let HTTPSserver = https.createServer(options, app);
const io = new Server(HTTPSserver);

let tabletID = null;
let phoneID = null;

let phoneWidth = 400;

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  //assign 角色
  socket.on("my-role", (data) => {
    socket.role = data.role;

    if (data.role === "tablet") {
      tabletID = socket.id;
      console.log("🟦tablet-is-ready:", socket.id);
    } else if (data.role === "phone") {
      phoneID = socket.id;
      console.log("🟩phone-is-ready:", socket.id);
    } else if (data.role === "user") {
      console.log("user-connects:", socket.id);
    }
  });

  socket.on("disconnect", () => {
    let roleName = socket.role || "unknown";
    console.log(`${roleName} disconnect:`, socket.id);

    if (socket.id === tabletID) tabletID = null;
    if (socket.id === phoneID) phoneID = null;
  });

  //拆分函数：优先按空格切，长单词强制截断
  function splitText(input, maxLength = 10) {
    let result = [];
    //按空格拆分并过滤空项
    let initialChunks = input.split(/\s+/).filter((s) => s.length > 0);

    initialChunks.forEach((chunk) => {
      if (chunk.length <= maxLength) {
        result.push(chunk);
      } else {
        //如果单词过长（无空格），强制按照maxLength切开
        for (let i = 0; i < chunk.length; i += maxLength) {
          result.push(chunk.substring(i, i + maxLength));
        }
      }
    });
    return result;
  }

  socket.on("send-to-phone", (data) => {
    console.log("recived-from-phone:", data.text);

    if (phoneID) {
      //调用拆分function
      const chunks = splitText(data.text, 10);

      chunks.forEach((chunk, index) => {
        //不要每个东西一起落下去，模拟“散落”效果
        setTimeout(() => {
          if (phoneID) {
            let dropX = Math.random();
            io.to(phoneID).emit("drop-in-phone", {
              text: chunk,
              x_ratio: dropX,
            });
          }
        }, index * 150); //每个碎片间隔120ms
      });
    } else {
      console.log("fail-to-load:phone-is-not-online");
    }
  });

  socket.on("update-phone-width", (data) => {
    phoneWidth = data.width;
    console.log("phone-width-update", phoneWidth);

    if (tabletID) {
      io.to(tabletID).emit("update-phone-layout", { width: phoneWidth });
    }
  });

  socket.on("phone-to-tablet", (data) => {
    if (tabletID) {
      io.to(tabletID).emit("new-letter", {
        text: data.text,
        x_ratio: data.x_ratio,
        currentPhoneWidth: phoneWidth,
      });
      //console.log(`转发给平板: ${data.text}, 宽度参考: ${phoneWidth}`);
    }
  });
});

HTTPSserver.listen(portHTTPS, () => {
  console.log("服务器启动: https://localhost:4250");
});
