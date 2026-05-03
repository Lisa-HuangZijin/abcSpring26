const express = require("express");
const https = require("https");
const fs = require("fs");

const app = express();
const portHTTPS = 3014;

const options = {
  key: fs.readFileSync("keys-for-local-https/localhost-key.pem"),
  cert: fs.readFileSync("keys-for-local-https/localhost.pem"),
};

const HTTPSserver = https.createServer(options, app);
const { Server } = require("socket.io");
const io = new Server(HTTPSserver);

app.use(express.static("public"));
app.use(express.json());

// ── Total columns in the curtain ──────────────────────────
const TOTAL_COLS = 20;

// ── colors.json structure ─────────────────────────────────
// Array of column entries:
// [
//   { colIndex: 3, palette: [[r,g,b], ...] },
//   { colIndex: 7, palette: [[r,g,b], ...] },
//   ...
// ]
// Empty columns (not yet claimed) show a default grey.

let columnData = [];

function loadColors() {
  try {
    const raw = fs.readFileSync("colors.json", "utf8");
    columnData = JSON.parse(raw);
    if (!Array.isArray(columnData)) columnData = [];
  } catch (e) {
    columnData = [];
    saveColors();
  }
}

function saveColors() {
  fs.writeFileSync("colors.json", JSON.stringify(columnData, null, 2), "utf8");
}

loadColors();

// ── Helper: find which columns are already taken ──────────
function takenCols() {
  return columnData.map((c) => c.colIndex);
}

// ── Assign a free column to a new user ───────────────────
// Returns colIndex (0-based), or -1 if curtain is full.
function assignColumn(requestedCol) {
  const taken = takenCols();

  // If client is requesting a specific col they already own, honour it
  if (requestedCol !== undefined && requestedCol !== null) {
    return requestedCol; // trust localStorage
  }

  // Find first free column
  for (let i = 0; i < TOTAL_COLS; i++) {
    if (!taken.includes(i)) return i;
  }
  return -1; // full
}

// ── REST: assign column ────────────────────────────────────
// Client calls this on first visit (or when localStorage has no col)
// Body: { existingCol: <number|null> }
// Returns: { colIndex: <number> }
app.post("/assign-column", (req, res) => {
  const existing = req.body.existingCol ?? null;
  const col = assignColumn(existing);
  if (col === -1) return res.status(503).json({ error: "curtain full" });
  console.log("Assigned column:", col);
  res.json({ colIndex: col });
});

// ── REST: save colors for a column ────────────────────────
// Body: { colIndex: <number>, palette: [[r,g,b], ...] }
app.post("/upload-colors", (req, res) => {
  const { colIndex, palette } = req.body;

  if (
    typeof colIndex !== "number" ||
    !Array.isArray(palette) ||
    !palette.length
  ) {
    return res.status(400).json({ error: "invalid body" });
  }

  // Upsert: replace existing entry for this col, or push new
  const idx = columnData.findIndex((c) => c.colIndex === colIndex);
  const entry = { colIndex, palette: palette.slice(0, 5) };
  if (idx >= 0) {
    columnData[idx] = entry;
  } else {
    columnData.push(entry);
  }

  saveColors();
  console.log(`Column ${colIndex} colors saved.`);
  res.sendStatus(200);

  // Broadcast so other online users see the new column colour
  io.emit("column-updated", entry);
});

// ── Socket ─────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  // Send full curtain state to new connection
  socket.emit("all-columns", { columns: columnData, total: TOTAL_COLS });

  socket.on("disconnect", () => console.log("disconnected:", socket.id));
});

// ── Start ──────────────────────────────────────────────────
HTTPSserver.listen(portHTTPS, () => {
  console.log("HTTPS Server running on port", portHTTPS);
});
