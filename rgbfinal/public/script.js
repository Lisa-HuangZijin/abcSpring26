// Matter.js — destructured inside setup() after CDN script loads
let Engine, World, Bodies, Body;

let socket;
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/canvas-photo/socket.io" });
} else {
  socket = io();
}

(function preloadFrames() {
  for (let i = 0; i <= 9; i++) {
    const img = new Image();
    img.src = `frames/frame${i}.jpg`;
  }
})();

function getUserId() {
  return localStorage.getItem("user-id"); // なければ null
}
function createUserId() {
  let id = crypto.randomUUID();
  localStorage.setItem("user-id", id);
  return id;
}
let myUserId = getUserId(); // 初回は null、Enter 後に設定される

let engine, world, ground;
let draggingPoint = null;

let ROWS = 16;
let COL_SPACING = 20;
let ROW_SPACING = 18;
let START_Y = 0;
let START_X = 10;

let chains = [];
let fallenBeads = []; // 所有掉落的珠子，全局共享
let introVisible = !localStorage.getItem("user-id"); // id なし = intro を表示
let pendingBreaks = [];

let interactRadius = 50;
let breakThreshold = 2.2;

let remotetouchs = {};

let lasttouchSend = 0;

let chainPalettes = {};
let chainPhotos = {}; // photoURL → p5 Image

// Extract N dominant colors from an image by shrinking it to a tiny canvas
function extractColors(imgEl, n) {
  const SIZE = 8; // 8×8 = 64像素
  const offscreen = document.createElement("canvas");
  offscreen.width = SIZE;
  offscreen.height = SIZE;
  const ctx = offscreen.getContext("2d");
  ctx.drawImage(imgEl, 0, 0, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

  // 收集所有像素，过滤太黑太白
  let pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const brightness = (r + g + b) / 3;
    if (brightness < 20 || brightness > 240) continue;
    pixels.push([r, g, b]);
  }
  if (pixels.length === 0) pixels = [[128, 128, 128]];

  // 随机取n个，打散顺序避免集中在图片某一区域
  for (let i = pixels.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pixels[i], pixels[j]] = [pixels[j], pixels[i]];
  }

  return pixels.slice(0, n);
}

function showPhotoPicker(onDone) {
  const overlay = document.getElementById("photo-overlay");
  const input = document.getElementById("photo-input");
  const previewArea = document.getElementById("preview-area");
  const previewImg = document.getElementById("preview-img");
  const swatches = document.getElementById("swatches");
  const finishBtn = document.getElementById("finish-btn");

  previewArea.style.display = "none";
  swatches.innerHTML = "";
  finishBtn.disabled = true;
  overlay.classList.remove("hidden"); // show overlay

  let currentPalette = null;

  input.value = "";
  input.onchange = async function () {
    const file = input.files[0];
    if (!file) return;

    let blobUrl;
    const isHeic =
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      file.name.toLowerCase().endsWith(".heic") ||
      file.name.toLowerCase().endsWith(".heif");

    if (isHeic && typeof heic2any !== "undefined") {
      try {
        const jpegBlob = await heic2any({
          blob: file,
          toType: "image/jpeg",
          quality: 0.85,
        });
        blobUrl = URL.createObjectURL(
          Array.isArray(jpegBlob) ? jpegBlob[0] : jpegBlob,
        );
      } catch (err) {
        blobUrl = URL.createObjectURL(file);
      }
    } else {
      blobUrl = URL.createObjectURL(file);
    }

    previewImg.onload = function () {
      currentPalette = extractColors(previewImg, 5);
      swatches.innerHTML = "";
      for (let rgb of currentPalette) {
        const div = document.createElement("div");
        div.className = "swatch";
        div.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        swatches.appendChild(div);
      }
      previewArea.style.display = "flex";
      finishBtn.disabled = false;
    };
    previewImg.src = blobUrl;
  };

  function compressPhoto(imgEl) {
    const W = 40,
      H = 48;
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const ctx = off.getContext("2d");
    const srcRatio = imgEl.naturalWidth / imgEl.naturalHeight;
    const dstRatio = W / H;
    let sx, sy, sw, sh;
    if (srcRatio > dstRatio) {
      sh = imgEl.naturalHeight;
      sw = sh * dstRatio;
      sx = (imgEl.naturalWidth - sw) / 2;
      sy = 0;
    } else {
      sw = imgEl.naturalWidth;
      sh = sw / dstRatio;
      sx = 0;
      sy = (imgEl.naturalHeight - sh) / 2;
    }
    ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, W, H);
    return off.toDataURL("image/jpeg", 0.7);
  }

  finishBtn.onclick = async function () {
    if (!currentPalette) return;
    overlay.classList.add("hidden");
    finishBtn.disabled = true;
    try {
      const dataURL = compressPhoto(previewImg);
      const fetchRes = await fetch(dataURL);
      const blob = await fetchRes.blob();
      const uploadRes = await fetch("upload-photo", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      const { url } = await uploadRes.json();
      onDone(currentPalette, url);
    } catch (e) {
      console.error("photo upload failed", e);
      onDone(currentPalette, null);
    }
  };
}

function registerChainPhoto(chainIndex, photoURL) {
  if (!photoURL) return;
  if (chainPhotos[photoURL]) return; // 已加载过，不重复加载
  loadImage(photoURL, function (img) {
    chainPhotos[photoURL] = img;
  });
}

function makeSeedID(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function beadAppearance(chainIndex, hue, row, seed) {
  const randomN = makeSeedID(seed + row * 4);
  const type = Math.floor(randomN() * 3);
  const size = 10 + randomN() * 8;

  let rgb;
  const palette = chainPalettes[chainIndex];
  if (palette && palette.length >= 5) {
    const base = palette[row % 5];
    const variation = makeSeedID(seed + row * 4 + 1);
    rgb = [
      Math.min(255, Math.max(0, base[0] + (variation() - 0.5) * 20)),
      Math.min(255, Math.max(0, base[1] + (variation() - 0.5) * 20)),
      Math.min(255, Math.max(0, base[2] + (variation() - 0.5) * 20)),
    ];
  } else {
    rgb = [150, 150, 150];
  }

  return { type, size, rgb };
}

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const windBuffers = [];

// 预加载并解码
(function preloadSounds() {
  for (let i = 1; i <= 6; i++) {
    fetch(`sounds/wind${i}.mp3`)
      .then((r) => r.arrayBuffer())
      .then((buf) => audioCtx.decodeAudioData(buf))
      .then((decoded) => {
        windBuffers[i] = decoded;
      })
      .catch(() => {});
  }
})();

function playBreakSound() {
  const n = Math.floor(Math.random() * 6) + 1;
  const buf = windBuffers[n];
  if (!buf) return;
  const source = audioCtx.createBufferSource();
  source.buffer = buf;
  source.connect(audioCtx.destination);
  source.start(0);
}

let p5Ready = false;
let pendingChainsInit = null;
let pendingChainsAppend = [];

function setup() {
  ({ Engine, World, Bodies, Body } = Matter);

  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  rectMode(CENTER);

  engine = Engine.create();
  world = engine.world;
  rebuildGround();

  // p5 is ready — flush any socket data that arrived before setup() finished
  p5Ready = true;
  if (pendingChainsInit !== null) {
    rebuildchains(
      pendingChainsInit.chains,
      pendingChainsInit.orphanedBeads || [],
    );
    pendingChainsInit = null;
  }
  for (let sd of pendingChainsAppend) appendchains(sd);
  pendingChainsAppend = [];
}

function draw() {
  if (introVisible) {
    background(252);
    return;
  }
  background(252);
  broadcastTouch();

  updateChain();
  Engine.update(engine);
  drawCurtain();
}

function rebuildGround() {
  if (ground) World.remove(world, ground);
  ground = Bodies.rectangle(width / 2, height - 40, width * 4, 60, {
    isStatic: true,
  });
  World.add(world, ground);
}

function rebuildchains(serverchains, serverOrphanedBeads) {
  for (let b of fallenBeads) World.remove(world, b);
  fallenBeads = [];
  chains = [];

  rebuildGround();

  const activeChainIndices = new Set(
    (serverchains || []).map((sd) => sd.chainIndex),
  );
  for (let saved of serverOrphanedBeads || []) {
    if (activeChainIndices.has(saved.chainIndex)) continue;
    const isPhotoBead = saved.isPhoto || false;
    const sz = saved.size || 8;
    let restoredY = windowHeight - saved.yFromBottom;
    let bead = isPhotoBead
      ? Bodies.rectangle(saved.x, restoredY, sz * 1.2, sz * 1.5, {
          restitution: 0.05,
          friction: 0.8,
          frictionAir: 0.01,
        })
      : Bodies.circle(saved.x, restoredY, sz / 2, {
          restitution: 0.05,
          friction: 0.8,
          frictionAir: 0.01,
        });
    if (isPhotoBead && saved.photoURL && !chainPhotos[saved.photoURL]) {
      registerChainPhoto(saved.chainIndex, saved.photoURL);
    }
    bead.renderData = {
      type: saved.type || 0,
      size: sz,
      rgb: saved.rgb || [150, 150, 150],
      row: saved.row,
      chainIndex: saved.chainIndex,
      isPhoto: isPhotoBead,
      photoURL: saved.photoURL || null,
    };
    Body.setAngle(bead, saved.angle || 0);
    Body.setVelocity(bead, { x: 0, y: 0 });
    World.add(world, bead);
    fallenBeads.push(bead);
  }

  for (let sd of serverchains) {
    // Register palette by chainIndex so each chain keeps its own colors
    if (sd.palette && sd.palette.length > 0) {
      chainPalettes[sd.chainIndex] = sd.palette;
    }
    if (sd.photoURL) registerChainPhoto(sd.chainIndex, sd.photoURL);
    let chain = buildchain(
      sd.chainIndex,
      sd.userId,
      sd.hue,
      sd.seed || 0,
      sd.photoURL,
    );

    let sortedBreaks = [...sd.breaks].sort((a, b) => a - b);
    for (let row of sortedBreaks) applyChainBreak(chain, row, true);

    for (let saved of sd.fallenBeads) {
      // 优先用 saved 里存储的外观数据，避免 refresh 后重新计算颜色导致变色
      let type, size, rgb;
      if (saved.rgb) {
        type = saved.type;
        size = saved.size;
        rgb = saved.rgb;
      } else {
        let fallBead = beadAppearance(
          sd.chainIndex,
          sd.hue,
          saved.row,
          sd.seed || 0,
        );
        type = fallBead.type;
        size = fallBead.size;
        rgb = fallBead.rgb;
      }
      const isPhotoBead = saved.isPhoto || false;
      let restoredY = windowHeight - saved.yFromBottom;
      let bead = isPhotoBead
        ? Bodies.rectangle(saved.x, restoredY, size * 1.2, size * 1.5, {
            restitution: 0.05,
            friction: 0.8,
            frictionAir: 0.01,
          })
        : Bodies.circle(saved.x, restoredY, size / 2, {
            restitution: 0.05,
            friction: 0.8,
            frictionAir: 0.01,
          });
      if (isPhotoBead && saved.photoURL && !chainPhotos[saved.photoURL]) {
        registerChainPhoto(sd.chainIndex, saved.photoURL);
      }
      bead.renderData = {
        type,
        size,
        rgb,
        row: saved.row,
        chainIndex: sd.chainIndex,
        isPhoto: isPhotoBead,
        photoURL: saved.photoURL || null,
      };
      Body.setAngle(bead, saved.angle);
      Body.setVelocity(bead, { x: saved.vx || 0, y: saved.vy || 0 });
      World.add(world, bead);
      fallenBeads.push(bead);
    }

    chains.push(chain);
  }
}

function appendchains(newchainData) {
  for (let sd of newchainData) {
    if (chains.find((s) => s.chainIndex === sd.chainIndex)) continue;
    if (sd.palette && sd.palette.length > 0) {
      chainPalettes[sd.chainIndex] = sd.palette;
    }
    if (sd.photoURL) registerChainPhoto(sd.chainIndex, sd.photoURL);
    let chain = buildchain(
      sd.chainIndex,
      sd.userId,
      sd.hue,
      sd.seed || 0,
      sd.photoURL,
    );
    chains.push(chain);
  }
}

function buildchain(chainIndex, userId, hue, seed, photoURL) {
  let pts = [],
    stks = [];
  let cx = START_X + chainIndex * COL_SPACING;
  const lenRng = makeSeedID(seed + 999999);

  for (let r = 0; r <= ROWS; r++) {
    let b = beadAppearance(chainIndex, hue, r, seed);
    pts.push({
      x: cx,
      y: r * ROW_SPACING + START_Y,
      oldX: cx,
      oldY: r * ROW_SPACING + START_Y,
      pinned: r === 0,
      active: true,
      row: r,
      type: b.type,
      size: b.size,
      rgb: b.rgb,
      isPhoto: r === ROWS,
    });
  }

  for (let r = 0; r < ROWS; r++) {
    const isLastStick = r === ROWS - 1;
    let stickLength;
    if (isLastStick) {
      stickLength = ROW_SPACING * 2;
    } else {
      stickLength = ROW_SPACING * (0.8 + lenRng() * 0.6);
    }

    stks.push({
      p1: pts[r], // 线的上端连接第 r 颗珠子
      p2: pts[r + 1], // 线的下端连接第 r+1 颗珠子
      len: stickLength, // 这根线的自然长度
      active: true, // 这根线目前是完好的（没有被扯断）
    });
  }

  return {
    chainIndex,
    userId,
    hue,
    seed,
    photoURL: photoURL || null,
    points: pts,
    sticks: stks,
    brokenRows: new Set(),
  };
}

//广播touch
function broadcastTouch() {
  if (millis() - lasttouchSend < 33) return;
  lasttouchSend = millis();
  let tx = touches.length > 0 ? touches[0].x : mouseX;
  let ty = touches.length > 0 ? touches[0].y : mouseY;
  socket.emit("touch-move", {
    x: tx,
    y: ty,
    pressing: mouseIsPressed || touches.length > 0,
    userId: myUserId,
  });
}

function updateChain() {
  let gravity = 0.8,
    friction = 0.98;

  for (let st of chains) {
    for (let p of st.points) {
      if (!p.active || p.pinned) continue;
      let vx = (p.x - p.oldX) * friction;
      let vy = (p.y - p.oldY) * friction;
      p.oldX = p.x;
      p.oldY = p.y;
      p.x += vx;
      p.y += vy + gravity;
    }
  }

  handleInteractions();
  solveConstraints();

  if (pendingBreaks.length > 0) {
    let tx = touches.length > 0 ? touches[0].x : mouseX;
    let ty = touches.length > 0 ? touches[0].y : mouseY;
    pendingBreaks.sort((a, b) => {
      let s1 = a.chain.sticks[a.si],
        s2 = b.chain.sticks[b.si];
      if (!s1 || !s2) return 0;
      return (
        dist(tx, ty, (s1.p1.x + s1.p2.x) / 2, (s1.p1.y + s1.p2.y) / 2) -
        dist(tx, ty, (s2.p1.x + s2.p2.x) / 2, (s2.p1.y + s2.p2.y) / 2)
      );
    });
    let best = pendingBreaks[0];
    let s = best.chain.sticks[best.si];
    if (s && s.active) {
      let breakRow = s.p2.row;
      s.active = false;
      applyChainBreak(best.chain, breakRow, false);
      playBreakSound();
      socket.emit("chain-break", {
        chainIndex: best.chain.chainIndex,
        row: breakRow,
      });
    }
    pendingBreaks = [];
  }
}

function solveConstraints() {
  let tx = touches.length > 0 ? touches[0].x : mouseX;
  let ty = touches.length > 0 ? touches[0].y : mouseY;
  let isInteracting = mouseIsPressed || touches.length > 0;

  let nearestchain = null,
    nearestDist = Infinity;
  if (isInteracting) {
    for (let st of chains) {
      for (let p of st.points) {
        if (!p.active) continue;
        let d = dist(tx, ty, p.x, p.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearestchain = st;
        }
      }
    }
  }

  pendingBreaks = [];

  for (let st of chains) {
    for (let iter = 0; iter < 15; iter++) {
      for (let j = 0; j < st.sticks.length; j++) {
        let s = st.sticks[j];
        if (!s.active) continue;
        let dx = s.p2.x - s.p1.x,
          dy = s.p2.y - s.p1.y;
        let d = sqrt(dx * dx + dy * dy);

        if (
          d > s.len * breakThreshold &&
          isInteracting &&
          st === nearestchain &&
          iter === 14
        ) {
          pendingBreaks.push({ chain: st, si: j });
        }

        let diff = ((s.len - d) / d / 2) * 0.8;
        let ox = dx * diff,
          oy = dy * diff;
        if (!s.p1.pinned && s.p1.active && s.p1 !== draggingPoint) {
          s.p1.x -= ox;
          s.p1.y -= oy;
        }
        if (!s.p2.pinned && s.p2.active && s.p2 !== draggingPoint) {
          s.p2.x += ox;
          s.p2.y += oy;
        }
      }
    }
  }
}

function handleInteractions() {
  let tx = touches.length > 0 ? touches[0].x : mouseX;
  let ty = touches.length > 0 ? touches[0].y : mouseY;
  let ptx = touches.length > 0 ? touches[0].px || tx : pmouseX;
  let pty = touches.length > 0 ? touches[0].py || ty : pmouseY;
  let isInteracting = mouseIsPressed || touches.length > 0;

  if (draggingPoint && draggingPoint.active) {
    draggingPoint.x = tx;
    draggingPoint.y = ty;
    draggingPoint.oldX = tx;
    draggingPoint.oldY = ty;
  }

  if (isInteracting) {
    // 推 chain 上的珠子
    for (let st of chains) {
      for (let p of st.points) {
        if (!p.active || p.pinned || p === draggingPoint) continue;
        let d = dist(tx, ty, p.x, p.y);
        if (d < interactRadius) {
          let angle = atan2(p.y - ty, p.x - tx);
          let force = (interactRadius - d) * 0.15;
          p.x += cos(angle) * force + (tx - ptx) * 0.2;
          p.y += sin(angle) * force + (ty - pty) * 0.2;
        }
      }
    }
  }

  for (let id in remotetouchs) {
    let rt = remotetouchs[id];
    if (!rt.pressing) continue;
    for (let st of chains) {
      for (let p of st.points) {
        if (!p.active || p.pinned) continue;
        let d = dist(rt.x, rt.y, p.x, p.y);
        if (d < interactRadius) {
          let angle = atan2(p.y - rt.y, p.x - rt.x);
          let force = (interactRadius - d) * 0.15;
          p.x += cos(angle) * force;
          p.y += sin(angle) * force;
        }
      }
    }
  }
}

function applyChainBreak(chain, startRow, silent) {
  if (chain.brokenRows.has(startRow)) return;
  chain.brokenRows.add(startRow);

  for (let r = startRow; r <= ROWS; r++) {
    let p = chain.points[r];
    if (!p || !p.active) continue;
    p.active = false;

    if (!silent) {
      let vx = p.x - p.oldX,
        vy = p.y - p.oldY;
      let fallingBead = beadAppearance(
        chain.chainIndex,
        chain.hue,
        r,
        chain.seed || 0,
      );
      const isPhotoBead = r === ROWS;
      const beadW = isPhotoBead ? fallingBead.size * 1.2 : fallingBead.size;
      const beadH = isPhotoBead ? fallingBead.size * 1.5 : fallingBead.size;
      let bead = isPhotoBead
        ? Bodies.rectangle(p.x, p.y, beadW, beadH, {
            restitution: 0.05,
            friction: 0.8,
            frictionAir: 0.01,
          })
        : Bodies.circle(p.x, p.y, fallingBead.size / 2, {
            restitution: 0.05,
            friction: 0.8,
            frictionAir: 0.01,
          });
      bead.renderData = {
        type: fallingBead.type,
        size: fallingBead.size,
        rgb: fallingBead.rgb,
        row: r,
        chainIndex: chain.chainIndex,
        isPhoto: isPhotoBead,
        photoURL: isPhotoBead ? chain.photoURL || null : null,
      };
      Body.setVelocity(bead, { x: vx, y: vy });
      World.add(world, bead);
      fallenBeads.push(bead);
    }
  }

  for (let i = chain.sticks.length - 1; i >= 0; i--) {
    if (!chain.sticks[i].p1.active || !chain.sticks[i].p2.active) {
      chain.sticks[i].active = false;
      chain.sticks.splice(i, 1);
    }
  }

  // 断链瞬间立刻把珠子位置保存到服务器
  if (!silent) {
    let beads = fallenBeads
      .filter(
        (b) =>
          b.renderData.chainIndex === chain.chainIndex && !b.renderData.evicted,
      )
      .map((b) => ({
        x: b.position.x,
        yFromBottom: windowHeight - b.position.y,
        angle: b.angle,
        vx: b.velocity.x,
        vy: b.velocity.y,
        row: b.renderData.row,
        type: b.renderData.type,
        size: b.renderData.size,
        rgb: b.renderData.rgb,
        isPhoto: b.renderData.isPhoto || false,
        photoURL: b.renderData.photoURL || null,
      }));
    if (beads.length > 0) {
      socket.emit("fallen-beads-update", {
        chainIndex: chain.chainIndex,
        beads,
      });
    }
  }
}

function drawCurtain() {
  for (let st of chains) {
    stroke(180, 150);
    strokeWeight(1.5);
    for (let s of st.sticks) {
      if (s.active) line(s.p1.x, s.p1.y, s.p2.x, s.p2.y);
    }
    noStroke();
    for (let p of st.points) {
      if (!p.active || p.pinned) continue;
      if (p.isPhoto) {
        drawPhotoBead(p.x, p.y, 0, chainPhotos[st.photoURL], p.size);
      } else {
        drawBeadShape(p.x, p.y, 0, p.type, p.size, p.rgb);
      }
    }
  }

  // 全局掉落珠子全部放进fallenBeads
  noStroke();
  for (let b of fallenBeads) {
    let d = b.renderData;
    if (d.isPhoto) {
      drawPhotoBead(
        b.position.x,
        b.position.y,
        b.angle,
        chainPhotos[d.photoURL],
        d.size,
      );
    } else {
      drawBeadShape(b.position.x, b.position.y, b.angle, d.type, d.size, d.rgb);
    }
  }

  // noStroke();
  // fill(0, 180, 120, 180);
  // for (let st of chains) {
  //   // 只有当整串还没完全毁坏时才显示绿点（chain 从 row 1 断裂 = 整串掉落）
  //   if (st.userId === myUserId && !st.brokenRows.has(1)) {
  //     ellipse(st.points[0].x, START_Y - 20, 8, 8);
  //   }
  // }

  for (let id in remotetouchs) {
    let rt = remotetouchs[id];
    let userchain = chains.find((s) => s.userId === rt.userId);
    let h = userchain ? userchain.hue : 200;
    colorMode(HSB, 360, 100, 100, 255);
    noStroke();
    fill(h, 70, 90, rt.pressing ? 220 : 130);
    circle(rt.x, rt.y, rt.pressing ? 22 : 14);
    colorMode(RGB, 255);
  }
}

function drawPhotoBead(x, y, angle, img, size) {
  const W = size * 1.2;
  const H = size * 1.5;
  push();
  translate(x, y);
  rotate(angle);
  noStroke();
  if (img) {
    imageMode(CENTER);
    image(img, 0, 0, W, H);
    // stroke(255, 180);
    // strokeWeight(1);
    // noFill();
    // rect(0, 0, W, H);
  } else {
    fill(200);
    rect(0, 0, W, H);
  }
  pop();
}

function drawBeadShape(x, y, angle, type, size, rgb) {
  push();
  translate(x, y);
  rotate(angle);

  // 确保使用 RGB 模式
  colorMode(RGB, 255);
  fill(rgb[0], rgb[1], rgb[2]);

  if (type === 0) ellipse(0, 0, size, size);
  else if (type === 1) drawDiamond(0, 0, size * 0.7);
  else rect(0, 0, size, size);

  fill(255, 120); // 高光
  ellipse(-size / 4, -size / 4, size / 4, size / 4);
  pop();
}

function drawDiamond(x, y, s) {
  beginShape();
  vertex(0, -s);
  vertex(0.7 * s, 0);
  vertex(0, s);
  vertex(-0.7 * s, 0);
  endShape(CLOSE);
}

socket.on("chains-init", function (payload) {
  if (p5Ready) rebuildchains(payload.chains, payload.orphanedBeads || []);
  else pendingChainsInit = payload;
});
socket.on("chains-appended", function (ss) {
  if (p5Ready) appendchains(ss);
  else pendingChainsAppend.push(ss);
});
socket.on("chain-evicted", function ({ chainIndex }) {
  let idx = chains.findIndex((s) => s.chainIndex === chainIndex);
  if (idx === -1) return;
  // 珠子留在画面上继续堆着，但标记为 evicted，不再同步给 server
  // 避免 maybySaveBeads 把旧 chainIndex 的珠子和新 chain 的珠子混在一起发
  for (let b of fallenBeads) {
    if (b.renderData.chainIndex === chainIndex) {
      b.renderData.evicted = true;
    }
  }
  chains.splice(idx, 1);
  delete chainPalettes[chainIndex];
  // chainPhotos 以 photoURL 为 key，不需要按 chainIndex 删除
});
socket.on("remote-break", function ({ chainIndex, row }) {
  let st = chains.find((s) => s.chainIndex === chainIndex);
  if (st) applyChainBreak(st, row, false);
  playBreakSound();
});
socket.on("remote-touch", function ({ socketId, x, y, pressing, userId }) {
  remotetouchs[socketId] = { x, y, pressing, userId, lastSeen: Date.now() };
});
socket.on("remote-touch-gone", function ({ socketId }) {
  delete remotetouchs[socketId];
});

setInterval(function () {
  let now = Date.now();
  for (let id in remotetouchs) {
    if (now - remotetouchs[id].lastSeen > 3000) delete remotetouchs[id];
  }
}, 2000);

// ── Init flow ─────────────────────────────────────────────────────────────────
function showCurtain() {
  document.getElementById("photo-overlay").classList.add("hidden");
}

(function () {
  const overlay = document.getElementById("intro-overlay");

  if (myUserId) {
    if (overlay) overlay.classList.add("hidden");
    socket.emit("hello", { userId: myUserId });
    return;
  }

  if (overlay) {
    overlay.classList.remove("hidden");
    overlay.classList.add("visible");
  }

  const animEl = document.getElementById("intro-anim");
  if (animEl) animEl.classList.add("visible");

  const btn = document.getElementById("intro-btn");
  if (btn) {
    btn.addEventListener(
      "click",
      function () {
        btn.disabled = true;
        audioCtx.resume();

        document.getElementById("intro-title").style.display = "none";
        document.getElementById("intro-sub").style.display = "none";
        btn.style.display = "none";
        if (animEl) animEl.classList.add("playing");

        myUserId = createUserId();
        socket.emit("hello", { userId: myUserId });
        setTimeout(function () {
          introVisible = false;
          if (overlay) {
            overlay.classList.add("fade-out");
            if (animEl) animEl.classList.add("fade-out");
            overlay.addEventListener(
              "transitionend",
              function () {
                overlay.classList.add("hidden");
                if (animEl) animEl.style.display = "none";
              },
              { once: true },
            );
          }
        }, 2000);
      },
      { once: true },
    );
  }
})();

let _toastEl = null,
  _toastTimer = null;
function showToast(msg) {
  if (!_toastEl) {
    _toastEl = document.createElement("div");
    Object.assign(_toastEl.style, {
      position: "fixed",
      bottom: "88px",
      left: "50%",
      transform: "translateX(-50%) translateY(12px)",
      background: "rgba(30,30,30,0.92)",
      color: "#fff",
      padding: "11px 20px",
      borderRadius: "20px",
      fontSize: "14px",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 0.25s ease, transform 0.25s ease",
      zIndex: "99999",
      whiteSpace: "nowrap",
    });
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  _toastEl.getBoundingClientRect();
  _toastEl.style.opacity = "1";
  _toastEl.style.transform = "translateX(-50%) translateY(0)";
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () {
    _toastEl.style.opacity = "0";
    _toastEl.style.transform = "translateX(-50%) translateY(12px)";
  }, 2800);
}

const MAX_CHAINS = 5;

(function () {
  let btn = document.getElementById("addchainButton");
  if (!btn) return;
  btn.addEventListener("click", function () {
    // 检查是否已满：超过 MAX_CHAINS 且没有完全断裂（breaks 包含 row 1）的空位
    const fullyBroken = chains.filter((s) => s.brokenRows.has(1));
    if (chains.length >= MAX_CHAINS && fullyBroken.length === 0) {
      showToast("已满，请完整扯烂一串帘子来腾出位置");
      return;
    }
    showPhotoPicker(function (palette, photoURL) {
      socket.emit("add-chain", { userId: myUserId, palette, photoURL });
    });
  });
})();

function mousePressed() {
  draggingPoint = findPoint(mouseX, mouseY);
}
function mouseReleased() {
  draggingPoint = null;
}

document.addEventListener(
  "touchstart",
  function (e) {
    const overlay = document.getElementById("photo-overlay");
    if (overlay && !overlay.classList.contains("hidden")) return;
    const t = e.touches[0];
    draggingPoint = findPoint(t.clientX, t.clientY);
  },
  { passive: true },
);

document.addEventListener(
  "touchend",
  function () {
    draggingPoint = null;
  },
  { passive: true },
);

function findPoint(x, y) {
  let best = 30,
    sel = null;
  for (let st of chains)
    for (let p of st.points) {
      if (!p.active || p.pinned) continue;
      let d = dist(x, y, p.x, p.y);
      if (d < best) {
        best = d;
        sel = p;
      }
    }
  return sel;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  rebuildGround();
}
