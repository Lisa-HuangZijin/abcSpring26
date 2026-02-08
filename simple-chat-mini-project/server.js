const express = require("express");
const https = require("https");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const portHTTPS = 3000;

app.use(express.static("public"));

const options = {
  key: fs.readFileSync("keys-for-local-https/localhost-key.pem"),
  cert: fs.readFileSync("keys-for-local-https/localhost.pem"),
};

const HTTPSserver = https.createServer(options, app);
const io = new Server(HTTPSserver);

const requests = new Map();

io.on("connection", function (socket) {
  console.log("[system] user connect" + "( ﾟ∀ ﾟ)");

  socket.on("messageFromClient", function (data) {
    if (data.type === "CHAT") {
      console.log("[chat] " + data.sender + ": " + data.message);
      io.emit("messageFromServer", data);
    } else if (data.type === "ORDER_POST") {
      requests.set(data.id, data);
      console.log(
        "[order placed]" +
          " | from: " +
          data.sender +
          " | content: " +
          data.message,
      );
      io.emit("messageFromServer", data);
    } else if (data.type === "ORDER_CLAIM") {
      const order = requests.get(data.requestId);

      if (order && order.status === "open") {
        order.status = "claimed";
        order.claimedBy = data.claimer;
        requests.set(data.requestId, order);

        console.log(
          ") ٩(ˊᗜˋ*)و" +
            "[mission is taken successfully] " +
            data.claimer +
            " takes " +
            order.sender +
            " 's order ( " +
            ")",
        );

        io.emit("messageFromServer", {
          type: "request_update",
          id: data.requestId,
          status: "claimed",
          claimedBy: data.claimer,
        });

        io.emit("messageFromServer", {
          type: "CHAT",
          sender: "SYSTEM🔈",
          message:
            "٩(ˊᗜˋ*)و " +
            data.claimer +
            " takes " +
            order.sender +
            "'s request！",
          isSystem: true,
        });
      }
    }
  });

  socket.on("disconnect", function () {
    console.log("[system] user disconnect (´-﹏-` )");
  });
});

HTTPSserver.listen(portHTTPS, function () {
  console.log("HTTPS Server started at port " + portHTTPS);
});
