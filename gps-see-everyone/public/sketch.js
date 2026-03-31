// ============================================================
//  GPS Cloth Stitching Sketch
//  Combines: cloth stitching interaction + Mappa/Leaflet GPS map
//
//  HOW IT WORKS:
//  - Cloths are placed near your real GPS location (stored as lat/lng)
//  - YOUR physical position replaces the mouse for hover detection
//  - Walk between two cloth pieces 4 times → they stitch together
//  - The stitched group moves toward the other piece on the map
// ============================================================

// ============================================================
//  GPS Sewing Sketch - Static Map Mode
// ============================================================

let mappa = new Mappa("Leaflet");
let myMap;
let canvas;
let currentLongitude = 0;
let currentLatitude = 0;
let mapInit = false;
let me;

// --- 布料系统全局变量 ---
let cloths = [];
let clusterGroups = [];
let permanentStitches = [];
let lastCloth = null;
let stitchCount = 0;
let currentGroupPair = [];
let activeStitch = null;

// 地图配置：锁定在 18 级缩放，适合步行比例
let mappa_options = {
  lat: 0,
  lng: 0,
  zoom: 20,
  style:
    "https://webst01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}",
};

function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");

  // 初始时允许点击，以便触发浏览器的 GPS 授权弹窗
  canvas.elt.style.pointerEvents = "auto";

  // 主动调用 requestGPS (确保 requestGPS.js 已加载)
  if (typeof requestGPS === "function") {
    requestGPS();
  }

  me = new MyPoint();
}

function draw() {
  clear();

  // 1. 当获取到第一个 GPS 坐标后初始化地图
  if (!mapInit && GPS_GRANTED && currentLongitude !== 0) {
    console.log("Starting static map...");
    mappa_options.lat = currentLatitude;
    mappa_options.lng = currentLongitude;
    myMap = mappa.tileMap(mappa_options);
    myMap.overlay(canvas);

    // 关键：在地图准备好后彻底禁用交互，防止用户手动缩放/移动地图
    myMap.onChange(() => {
      let leafletMap = myMap.map;
      leafletMap.dragging.disable();
      leafletMap.touchZoom.disable();
      leafletMap.doubleClickZoom.disable();
      leafletMap.scrollWheelZoom.disable();
      if (leafletMap.tap) leafletMap.tap.disable();

      updateMapContent();
    });

    mapInit = true;

    // 在用户周围 5-25 米范围内生成布料
    spawnCloths(currentLatitude, currentLongitude);
  }

  if (mapInit) {
    // 每一帧同步布料在屏幕上的像素位置
    syncClothPixels();

    // 处理缝合时的位移动画
    handleActiveStitch();

    // 绘制所有布料
    for (let c of cloths) c.display();

    // 自动检测缝合进度
    if (!activeStitch) {
      detectAutoStitch();
    }

    drawPermanentStitches();

    // 更新并绘制用户标记
    me.update();
    me.display();

    // 绘制进度条等 UI
    drawUI();
  }
}

// ─── 布料生成逻辑 (5-25m 间距) ─────────────────────────────
function spawnCloths(lat, lng) {
  cloths = [];
  clusterGroups = [];

  const MIN_DIST_M = 20; // 布料之间的最小中心间距
  const MAX_DIST_M = 30; // 布料离用户的最大距离
  const degLat = 1 / 111000;
  const degLng = 1 / (111000 * Math.cos((lat * Math.PI) / 180));

  function distM(a, b) {
    let dy = (a.lat - b.lat) / degLat;
    let dx = (a.lng - b.lng) / degLng;
    return Math.sqrt(dx * dx + dy * dy);
  }

  let placed = [];
  let attempts = 0;

  // 尝试生成 8 块布料
  while (placed.length < 8 && attempts < 5000) {
    attempts++;
    let angle = random(TWO_PI);
    let dist = random(5, MAX_DIST_M); // 散落在用户周围 5-25m 处

    let candidate = {
      lat: lat + Math.cos(angle) * dist * degLat,
      lng: lng + Math.sin(angle) * dist * degLng,
    };

    // 检查是否离已有布料太近 (保持 5m 以上距离)
    let tooClose = placed.some((p) => distM(candidate, p) < MIN_DIST_M);

    if (!tooClose) {
      placed.push(candidate);
      let c = new Cloth(candidate.lat, candidate.lng, placed.length - 1);
      cloths.push(c);
      clusterGroups.push([c]);
    }
  }
}

// ─── 核心功能函数 (由 draw 调用) ───────────────────────────
function syncClothPixels() {
  for (let c of cloths) {
    let px = myMap.latLngToPixel(c.lat, c.lng);
    c.pos.x = px.x;
    c.pos.y = px.y;
    c.w = metersToPixel(c.wMeters, c.lat);
    c.h = metersToPixel(c.hMeters, c.lat);
  }
}

function handleActiveStitch() {
  if (!activeStitch) return;
  let gA = getGroupOf(activeStitch.mover);
  let gB = getGroupOf(activeStitch.target);
  let vec = p5.Vector.sub(activeStitch.target.pos, activeStitch.mover.pos)
    .normalize()
    .mult(6);

  let collisionPair = null;
  for (let a of gA) {
    for (let b of gB) {
      if (isOverlapping(a, b)) {
        collisionPair = { a, b };
        break;
      }
    }
    if (collisionPair) break;
  }

  if (!collisionPair) {
    for (let m of gA) {
      m.pos.add(vec);
      m.updateLatLng(); // 将像素位移转换回经纬度
    }
  } else {
    findPlace(gA, gB, collisionPair.a, collisionPair.b);
    activeStitch = null;
  }
}

// ─── 类定义 ──────────────────────────────────────────────
class Cloth {
  constructor(lat, lng, id) {
    this.lat = lat;
    this.lng = lng;
    this.pos = createVector(0, 0);
    this.wMeters = random(10, 18);
    this.hMeters = random(10, 18);
    this.w = 0;
    this.h = 0;
    this.id = id;
    this.color = color(
      random(200, 240),
      random(200, 240),
      random(200, 240),
      200,
    );
  }

  display() {
    let myGroup = getGroupOf(this);
    push();
    translate(this.pos.x, this.pos.y);
    rectMode(CENTER);

    if (currentGroupPair.includes(myGroup)) {
      stroke(30, 80, 50, 150);
      strokeWeight(4);
      noFill();
      rect(0, 0, this.w + 10, this.h + 10);
    }

    let isStandingOn = this.contains(me.x, me.y);
    stroke(isStandingOn ? "orange" : 150);
    strokeWeight(isStandingOn ? 4 : 1);
    fill(this.color);
    rect(0, 0, this.w, this.h);
    pop();
  }

  contains(px, py) {
    return (
      px > this.pos.x - this.w / 2 &&
      px < this.pos.x + this.w / 2 &&
      py > this.pos.y - this.h / 2 &&
      py < this.pos.y + this.h / 2
    );
  }

  getBounds() {
    return {
      l: this.pos.x - this.w / 2,
      r: this.pos.x + this.w / 2,
      t: this.pos.y - this.h / 2,
      b: this.pos.y + this.h / 2,
    };
  }

  updateLatLng() {
    let ll = myMap.pixelToLatLng(this.pos.x, this.pos.y);
    this.lat = ll.lat;
    this.lng = ll.lng;
  }
}

class MyPoint {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.goalX = 0;
    this.goalY = 0;
    this.accuracy = 0;
  }
  update() {
    this.x = lerp(this.x, this.goalX, 0.1);
    this.y = lerp(this.y, this.goalY, 0.1);
  }
  display() {
    push();
    translate(this.x, this.y);
    noFill();
    stroke(255, 0, 0, 100);
    let accPx = metersToPixel(this.accuracy, currentLatitude);
    circle(0, 0, accPx * 2);
    fill(0, 255, 100);
    noStroke();
    circle(0, 0, 15);
    pop();
  }
}

// ─── 其他辅助逻辑 (保持不变) ─────────────────────────────────
function detectAutoStitch() {
  let hovering = cloths.find((c) => c.contains(me.x, me.y));
  if (hovering && lastCloth && hovering !== lastCloth) {
    let g1 = getGroupOf(lastCloth),
      g2 = getGroupOf(hovering);
    if (g1 !== g2) {
      if (currentGroupPair.includes(g1) && currentGroupPair.includes(g2)) {
        stitchCount += 0.5;
        if (stitchCount >= 4) {
          activeStitch = { mover: lastCloth, target: hovering };
          stitchCount = 0;
          currentGroupPair = [];
        }
      } else {
        currentGroupPair = [g1, g2];
        stitchCount = 0.5;
      }
    }
  }
  if (hovering) lastCloth = hovering;
}

function findPlace(g1, g2, cA, cB) {
  let b1 = cA.getBounds(),
    b2 = cB.getBounds();
  let iL = max(b1.l, b2.l),
    iR = min(b1.r, b2.r),
    iT = max(b1.t, b2.t),
    iB = min(b1.b, b2.b);
  let stitchData = { hostCloth: cA, points: [] };
  for (let x = iL + 5; x < iR - 5; x += 10)
    stitchData.points.push(
      p5.Vector.sub(createVector(x, (iT + iB) / 2), cA.pos),
    );
  permanentStitches.push(stitchData);
  let newGroup = g1.concat(g2);
  clusterGroups = clusterGroups.filter((g) => g !== g1 && g !== g2);
  clusterGroups.push(newGroup);
}

function drawPermanentStitches() {
  push();
  stroke(30, 80, 50);
  strokeWeight(2);
  for (let s of permanentStitches) {
    for (let p of s.points) {
      let wP = p5.Vector.add(s.hostCloth.pos, p);
      line(wP.x - 4, wP.y - 4, wP.x + 4, wP.y + 4);
      line(wP.x + 4, wP.y - 4, wP.x - 4, wP.y + 4);
    }
  }
  pop();
}

function metersToPixel(meters, lat) {
  let z = myMap ? myMap.zoom() : 18;
  return (
    meters / ((156543.03392 * Math.cos((lat * PI) / 180)) / Math.pow(2, z))
  );
}

function isOverlapping(c1, c2) {
  let b1 = c1.getBounds(),
    b2 = c2.getBounds();
  return !(
    b1.r < b2.l + 1 ||
    b1.l > b2.r - 1 ||
    b1.b < b2.t + 1 ||
    b1.t > b2.b - 1
  );
}

function getGroupOf(c) {
  return clusterGroups.find((g) => g.includes(c));
}

function handleNewPosition(pos) {
  me.accuracy = pos.coords.accuracy;
  let lonlat = fixForChineseMap(pos);
  currentLongitude = lonlat[0];
  currentLatitude = lonlat[1];
  if (mapInit) updateMapContent();
}

function updateMapContent() {
  let p = myMap.latLngToPixel(currentLatitude, currentLongitude);
  me.goalX = p.x;
  me.goalY = p.y;
}

function drawUI() {
  if (stitchCount > 0) {
    fill(255, 200);
    rect(10, 10, 160, 40, 5);
    fill(30, 80, 50);
    rect(15, 30, (stitchCount / 4) * 150, 10, 2);
    fill(0);
    textSize(12);
    text("Stitching Progress", 15, 25);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
