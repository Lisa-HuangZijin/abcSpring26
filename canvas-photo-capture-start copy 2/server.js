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
        // palette 字段在旧格式里不存在，迁移时留空
        return {
          id: u.id,
          hue: u.hue,
          palette: u.palette || [],
          chains: newchains,
        };
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

// 把每个 user 的 chain 集合在一起，并带上各 chain 自己的 palette
function buildChainList() {
  const list = [];
  for (const u of users) {
    for (const st of u.chains) {
      list.push({
        chainIndex: st.chainIndex,
        seed: st.seed || 0,
        userId: u.id,
        hue: u.hue,
        palette: st.palette || [], // ← palette 现在在 chain 上
        breaks: st.breaks || [],
        fallenBeads: st.fallenBeads || [],
      });
    }
  }
  list.sort((a, b) => a.chainIndex - b.chainIndex);
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

    if (!user) {
      const hue = (users.length * 47) % 360;
      user = { id: userId, hue, chains: [] };
      users.push(user);
      saveData();
      console.log("new user", userId, "hue", hue, "(no chain yet)");
    } else {
      console.log(
        "returning user",
        userId,
        "chains:",
        user.chains.map((s) => s.chainIndex),
      );
    }

    socket.emit("chains-init", buildChainList());
  });

  socket.on("add-chain", ({ userId, palette }) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    const allChains = users.flatMap((u) => u.chains);
    const MAX_CHAINS = 30;

    if (allChains.length >= MAX_CHAINS) {
      // Only evict a chain broken from row 1 (entire chain has fallen)
      let evictChain = null;
      let evictUser = null;
      let oldestIndex = Infinity;

      for (const u of users) {
        for (const st of u.chains) {
          if (st.breaks.includes(1) && st.chainIndex < oldestIndex) {
            oldestIndex = st.chainIndex;
            evictChain = st;
            evictUser = u;
          }
        }
      }

      if (!evictChain) {
        // No fully-broken slot available — tell the client
        socket.emit("add-chain-rejected", { reason: "full" });
        return;
      }

      const evictedIndex = evictChain.chainIndex;
      evictUser.chains = evictUser.chains.filter(
        (s) => s.chainIndex !== evictedIndex,
      );
      saveData();
      io.emit("chain-evicted", { chainIndex: evictedIndex });
      console.log("evicted fully-broken chain", evictedIndex, "to make room");
    }

    const ci = nextchainIndex++;
    const seed = Math.floor(Math.random() * 1000000);
    user.chains.push({
      chainIndex: ci,
      seed,
      palette: palette || [],
      breaks: [],
      fallenBeads: [],
    });
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
    socket.broadcast.emit("remote-touch-gone", { socketId: socket.id });
    console.log("disconnected", socket.id);
  });
});

HTTPSserver.listen(portHTTPS, () => {
  console.log("HTTPS Server started at port", portHTTPS);
});
