const express = require("express");
// const http = require("http"); // we try to make HTTPS work

const https = require("https");
// to read certificates from the filesystem (fs)
const fs = require("fs");

const app = express(); // the server "app", the server behaviour

const portHTTPS = 4250; // port for https
// const portHTTP = 3001; // port for http

// returning to the client anything that is
// inside the public folder
app.use(express.static("public"));

// Creating object of key and certificate
// for SSL
const options = {
  key: fs.readFileSync("keys-for-local-https/localhost-key.pem"),
  cert: fs.readFileSync("keys-for-local-https/localhost.pem"),
};

const HTTPSserver = https.createServer(options, app);

const { Server } = require("socket.io");
const io = new Server(HTTPSserver);

io.on("connection", (socket) => {
  console.log("a user connected");

  socket.on("messageFromClient", function (incomingMessage) {
    console.log(incomingMessage); //只看这个lable的data

    let msgForAllClients = {
      sender: "unknown",
      message: incomingMessage,
    };

    io.emit("messageFromServer", msgForAllClients);
  });

  socket.on("disconnect", () => {
    //listen for everyone to connect
    console.log("user disconnected"); //所以disconnect前提是connect//然后是listen to the exact client to disconnect
  }); //像是io大盒子里的小盒子
});

HTTPSserver.listen(portHTTPS, function (req, res) {
  console.log("HTTPS Server started at port", portHTTPS);
});

// Creating servers and make them listen at their ports:
// https.createServer(options, app).listen(portHTTPS, function (req, res) {
//   console.log("HTTPS Server started at port", portHTTPS);
// });

// if we ALSO serve on http we can incommend this, but right now we don't
// http.createServer(app).listen(portHTTP, function (req, res) {
//     console.log("HTTP Server started at port", portHTTP);
// });
