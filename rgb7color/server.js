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
  if (!fs.existsSync(USERS_FILE))
    return { nextchainIndex: 0, users: [], orphanedBeads: [] };
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
    return { nextchainIndex: 0, users: [], orphanedBeads: [] };
  }
}

function saveData() {
  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify({ nextchainIndex, users, orphanedBeads }, null, 2),
    "utf8",
  );
}

let { nextchainIndex, users, orphanedBeads } = loadData();
orphanedBeads = orphanedBeads || [];

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
        palette: st.palette || [],
        photoURL: st.photoURL || null,
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

// 上传照片珠图片，存成文件，返回 URL 路径
app.post("/upload-photo", (req, res) => {
  const dir = "public/beadphotos";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = Date.now() + ".jpg";
  const filepath = dir + "/" + filename;
  const writeStream = fs.createWriteStream(filepath);
  req.pipe(writeStream);
  req.on("end", () => {
    res.json({ url: "beadphotos/" + filename });
  });
  req.on("error", (e) => {
    console.error("upload error", e);
    res.sendStatus(500);
  });
});

io.on("connection", (socket) => {
  console.log("connected", socket.id);

  socket.on("hello", ({ userId }) => {
    // userId なし = Enter をまだ押していない新規訪問者、ユーザー登録しない
    if (!userId) {
      socket.emit("chains-init", {
        chains: buildChainList(),
        orphanedBeads,
        isNewUser: true,
      });
      return;
    }

    let user = users.find((u) => u.id === userId);
    const isNewUser = !user;

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

    socket.emit("chains-init", {
      chains: buildChainList(),
      orphanedBeads,
      isNewUser,
    });
  });

  socket.on("add-chain", ({ userId, palette, photoURL }) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    const MAX_CHAINS = 5;

    // 无论是否满员，先把所有完全断裂的 chain 清理掉腾出空位
    for (const u of users) {
      const evicted = u.chains.filter((st) => st.breaks.includes(1));
      for (const st of evicted) {
        // 先清掉同 chainIndex 的旧条目，防止重复
        orphanedBeads = orphanedBeads.filter(
          (b) => b.chainIndex !== st.chainIndex,
        );
        if (st.fallenBeads && st.fallenBeads.length > 0) {
          // 照片珠带上 photoURL，方便 refresh 后恢复
          const beadsWithPhoto = st.fallenBeads.map((b) =>
            b.isPhoto
              ? { ...b, photoURL: b.photoURL || st.photoURL || null }
              : b,
          );
          orphanedBeads.push(...beadsWithPhoto);
        }
        u.chains = u.chains.filter((s) => s.chainIndex !== st.chainIndex);
        io.emit("chain-evicted", { chainIndex: st.chainIndex });
        console.log("evicted fully-broken chain", st.chainIndex);
      }
    }

    const allChains = users.flatMap((u) => u.chains);
    if (allChains.length >= MAX_CHAINS) {
      // 清理后仍然满员（没有完全断裂的可腾出），拒绝
      socket.emit("add-chain-rejected", { reason: "full" });
      return;
    }

    // 寻找最小的可用 chainIndex（优先填补空隙，而不是直接追加到末尾）
    const usedIndices = new Set(
      users.flatMap((u) => u.chains.map((s) => s.chainIndex)),
    );
    let ci = 0;
    while (usedIndices.has(ci)) ci++;
    // 如果没有空隙，ci 就是当前最大值+1；同步更新 nextchainIndex
    if (ci >= nextchainIndex) nextchainIndex = ci + 1;

    const seed = Math.floor(Math.random() * 1000000);
    user.chains.push({
      chainIndex: ci,
      seed,
      palette: palette || [],
      photoURL: photoURL || null,
      breaks: [],
      fallenBeads: [],
    });
    saveData();
    console.log("user", userId, "added chain", ci, "(smallest available slot)");
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
    const firstBead = beads && beads[0];
    if (st) {
      st.fallenBeads = beads;
      saveData();
    } else if (beads && beads.length > 0) {
      const oldPhotoURL =
        (
          orphanedBeads.find((b) => b.chainIndex === chainIndex && b.isPhoto) ||
          {}
        ).photoURL || null;
      orphanedBeads = orphanedBeads.filter((b) => b.chainIndex !== chainIndex);
      orphanedBeads.push(
        ...beads.map((b) => ({
          ...b,
          chainIndex,
          photoURL: b.isPhoto ? b.photoURL || oldPhotoURL : undefined,
        })),
      );
      saveData();
    }
    // 广播给其他客户端，让他们同步掉落珠子的新位置
    socket.broadcast.emit("remote-fallen-beads-update", { chainIndex, beads });
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
