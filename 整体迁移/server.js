const express = require("express");
const https = require("https");
const fs = require("fs");

const app = express();
const portHTTPS = 3014;
const MAX_CHAINS = 5;

const options = {
  key: fs.readFileSync("keys-for-local-https/localhost-key.pem"),
  cert: fs.readFileSync("keys-for-local-https/localhost.pem"),
};

const HTTPSserver = https.createServer(options, app);
const { Server } = require("socket.io");
const io = new Server(HTTPSserver);

const USERS_FILE = "users.json";

function loadData() {
  if (!fs.existsSync(USERS_FILE))
    return { nextchainIndex: 0, users: [], fallenBeads: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    if (Array.isArray(raw))
      return { nextchainIndex: 0, users: [], fallenBeads: [] };
    raw.fallenBeads = raw.fallenBeads || [];
    return raw;
  } catch (e) {
    return { nextchainIndex: 0, users: [], fallenBeads: [] };
  }
}

function saveData() {
  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify({ nextchainIndex, users, fallenBeads }, null, 2),
    "utf8",
  );
}

let { nextchainIndex, users, fallenBeads } = loadData();

// All active chains across all users, sorted by chainIndex
function allChains() {
  return users
    .flatMap((u) => u.chains)
    .sort((a, b) => a.chainIndex - b.chainIndex);
}

// Position slot: nth chain in sorted order → 0-based index
function buildChainList() {
  return allChains().map((st, i) => {
    const u = users.find((u) => u.chains.includes(st));
    return {
      chainIndex: st.chainIndex,
      slot: i,
      seed: st.seed || 0,
      userId: u.id,
      hue: u.hue,
      palette: st.palette || [],
      breaks: st.breaks || [],
    };
  });
}

function findChain(chainIndex) {
  for (const u of users)
    for (const st of u.chains) if (st.chainIndex === chainIndex) return st;
  return null;
}

function hasRoom() {
  return (
    allChains().length < MAX_CHAINS ||
    allChains().some((st) => st.breaks.includes(1))
  );
}

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("connected", socket.id);

  socket.on("hello", ({ userId }) => {
    let user = users.find((u) => u.id === userId);
    if (!user) {
      user = { id: userId, hue: (users.length * 47) % 360, chains: [] };
      users.push(user);
      saveData();
      console.log("new user", userId);
    } else {
      console.log("returning user", userId);
    }
    socket.emit("chains-init", buildChainList());
    socket.emit("fallen-beads-init", fallenBeads);
  });

  socket.on("check-capacity", () => {
    socket.emit(hasRoom() ? "capacity-ok" : "add-chain-rejected");
  });

  socket.on("add-chain", ({ userId, palette }) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    const active = allChains();
    if (active.length >= MAX_CHAINS) {
      // Evict the oldest fully-broken chain
      const broken = active
        .filter((st) => st.breaks.includes(1))
        .sort((a, b) => a.chainIndex - b.chainIndex);
      if (!broken.length) {
        socket.emit("add-chain-rejected");
        return;
      }
      const evict = broken[0];
      const evictUser = users.find((u) => u.chains.includes(evict));
      evictUser.chains = evictUser.chains.filter((s) => s !== evict);
      io.emit("chain-evicted", { chainIndex: evict.chainIndex });
      console.log("evicted chain", evict.chainIndex);
    }

    const ci = nextchainIndex++;
    const seed = Math.floor(Math.random() * 1000000);
    user.chains.push({
      chainIndex: ci,
      seed,
      palette: palette || [],
      breaks: [],
    });
    saveData();

    // Rebroadcast full sorted list so everyone gets correct slots
    io.emit("chains-reset", buildChainList());
  });

  socket.on("chain-break", ({ chainIndex, row }) => {
    const st = findChain(chainIndex);
    if (st && !st.breaks.includes(row)) {
      st.breaks.push(row);
      saveData();
    }
    socket.broadcast.emit("remote-break", { chainIndex, row });
    if (st && st.breaks.includes(1))
      io.emit("chain-fully-broken", { chainIndex });
  });

  // Client sends ALL fallen beads as one flat array periodically
  socket.on("fallen-beads-update", (beads) => {
    fallenBeads = beads;
    saveData();
  });

  socket.on("touch-move", (data) => {
    socket.broadcast.emit("remote-touch", { ...data, socketId: socket.id });
  });

  socket.on("disconnect", () => {
    socket.broadcast.emit("remote-touch-gone", { socketId: socket.id });
    console.log("disconnected", socket.id);
  });
});

HTTPSserver.listen(portHTTPS, () =>
  console.log("HTTPS Server started at port", portHTTPS),
);
