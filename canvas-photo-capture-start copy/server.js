const express = require("express");

const https = require("https");
const fs = require("fs");

const app = express();
const portHTTPS = 3014;

const options = {
  key: fs.readFileSync("keys-for-local-https/localhost-key.pem"),
  cert: fs.readFileSync("keys-for-local-https/localhost.pem"),
};

let HTTPSserver = https.createServer(options, app);

const { Server } = require("socket.io");
const io = new Server(HTTPSserver);

const USERS_FILE = "users.json";

function loadData() {
  //说这可以防止崩溃
  if (!fs.existsSync(USERS_FILE)) return { nextchainIndex: 0, users: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));

    if (Array.isArray(raw)) {
      let next = 0;
      const migrated = raw.map((u) => {
        const oldchains = u.chains || {};
        const newchains = [];
        for (let li = 0; li < (u.chainCount || 1); li++) {
          const old = oldchains[li] || {};
          newchains.push({
            chainIndex: next++,
            seed: Math.floor(Math.random() * 1000000),
            breaks: old.breaks || [],
            fallenBeads: old.fallenBeads || [],
          });
        }
        return { id: u.id, hue: u.hue, chains: newchains };
      });
      return { nextchainIndex: next, users: migrated };
    }
    return raw;
  } catch (e) {
    return { nextchainIndex: 0, users: [] };
  }
}

function saveData() {
  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify({ nextchainIndex, users }, null, 2),
    "utf8",
  );
}

let { nextchainIndex, users } = loadData();

//把每个user的chain集合在一起
function buildChainList() {
  const list = [];
  for (const u of users) {
    //几个玩家
    for (const st of u.chains) {
      //玩家手里的线
      list.push({
        chainIndex: st.chainIndex,
        seed: st.seed || 0, // random seed for bead appearance //防止找不到崩溃
        userId: u.id,
        hue: u.hue,
        breaks: st.breaks || [],
        fallenBeads: st.fallenBeads || [],
      });
    }
  }
  // Sort by chainIndex so clients always get them in order
  list.sort((a, b) => a.chainIndex - b.chainIndex);
  //gemini教我的：JavaScript 的 sort 方法会两两取出数组中的元素（我们叫它们 a 和 b），并根据你提供的函数返回值来决定谁排在前面
  return list;
}

// Find the chain data object for a given global chainIndex
function findchainData(chainIndex) {
  for (const u of users) {
    const st = u.chains.find((s) => s.chainIndex === chainIndex);
    if (st) return st;
  }
  return null;
}

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("connected", socket.id);

  socket.on("hello", ({ userId }) => {
    let user = users.find((u) => u.id === userId);
    let isNew = !user;

    if (isNew) {
      const hue = (users.length * 47) % 360;
      const ci = nextchainIndex++;
      const seed = Math.floor(Math.random() * 1000000); // random seed for bead appearance
      user = {
        id: userId,
        hue,
        chains: [{ chainIndex: ci, seed, breaks: [], fallenBeads: [] }],
      };
      users.push(user);
      saveData();
      console.log("new user", userId, "hue", hue, "chainIndex", ci);
    } else {
      console.log(
        "returning user",
        userId,
        "chains:",
        user.chains.map((s) => s.chainIndex),
      );
    }

    socket.emit("chains-init", buildChainList());

    // New user's first chain → everyone else
    if (isNew) {
      const newchains = buildChainList().filter((s) => s.userId === userId);
      socket.broadcast.emit("chains-appended", newchains);
    }
  });

  socket.on("add-chain", ({ userId }) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    const ci = nextchainIndex++;
    const seed = Math.floor(Math.random() * 1000000);
    user.chains.push({ chainIndex: ci, seed, breaks: [], fallenBeads: [] });
    saveData();
    console.log("user", userId, "added chain", ci);
    const newchain = buildChainList().find((s) => s.chainIndex === ci);
    io.emit("chains-appended", [newchain]);
  });

  socket.on("chain-break", ({ chainIndex, row }) => {
    const st = findchainData(chainIndex);
    if (st && !st.breaks.includes(row)) {
      st.breaks.push(row);
      saveData();
    }
    socket.broadcast.emit("remote-break", { chainIndex, row });
  });

  // fallBeads: [{ x, yFromBottom, angle, vx, vy, row }]
  socket.on("fallen-beads-update", ({ chainIndex, beads }) => {
    const st = findchainData(chainIndex);
    if (st) {
      st.fallenBeads = beads;
      saveData();
    }
  });

  socket.on("touch-move", (data) => {
    socket.broadcast.emit("remote-touch", { ...data, socketId: socket.id });
  });

  socket.on("disconnect", () => {
    socket.broadcast.emit("remote-touch-gone", { socketId: socket.id }); //除发送者以外，防止重复
    console.log("disconnected", socket.id);
  });
});

HTTPSserver.listen(portHTTPS, () => {
  console.log("HTTPS Server started at port", portHTTPS);
});
