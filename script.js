const video     = document.getElementById("video");
const overlay   = document.getElementById("overlay");
const ctx       = overlay.getContext("2d");
const badge     = document.getElementById("statusBadge");
const statusTxt = document.getElementById("statusText");
const posXEl    = document.getElementById("posX");
const posYEl    = document.getElementById("posY");
const bWidthEl  = document.getElementById("bWidth");
const bHeightEl = document.getElementById("bHeight");
const confEl    = document.getElementById("confidence");
const btnSwitch = document.getElementById("btnSwitch");

let currentStream = null;
let facingMode    = "environment";
let loopRunning   = false;
let smoothBox     = null;

// ── Kamera starten ────────────────────────────────────────────────────────────
async function startCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
    loopRunning   = false;
  }

  setStatus("lost", "Kamera startet…");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    currentStream   = stream;
    video.srcObject = stream;
  } catch (err) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      currentStream   = stream;
      video.srcObject = stream;
    } catch (err2) {
      setStatus("lost", "Kein Kamera-Zugriff");
      console.error(err2);
    }
  }
}

// ── Loop starten sobald Video läuft ──────────────────────────────────────────
video.addEventListener("playing", function () {
  overlay.width  = video.videoWidth;
  overlay.height = video.videoHeight;
  smoothBox      = null;

  if (!loopRunning) {
    loopRunning = true;
    setStatus("lost", "Suche Basketball…");
    requestAnimationFrame(loop);
  }
});

// ── Kamera wechseln ───────────────────────────────────────────────────────────
btnSwitch.addEventListener("click", function () {
  facingMode  = facingMode === "environment" ? "user" : "environment";
  loopRunning = false;
  startCamera();
});

// ── Haupt-Loop ────────────────────────────────────────────────────────────────
function loop() {
  if (!loopRunning) return;

  const W = overlay.width;
  const H = overlay.height;

  // Kamerabild in temporären Canvas kopieren
  const tmp  = document.createElement("canvas");
  tmp.width  = W;
  tmp.height = H;
  const tCtx = tmp.getContext("2d");
  tCtx.drawImage(video, 0, 0, W, H);

  const imageData = tCtx.getImageData(0, 0, W, H);
  const data      = imageData.data;

  let minX = W, minY = H, maxX = 0, maxY = 0, count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Basketball-Orange: Rot hoch, Grün mittel, Blau niedrig
    if (
      r > 160 &&
      g > 50 && g < 160 &&
      b < 80 &&
      r > g + 40 &&
      r > b + 80
    ) {
      const idx = i / 4;
      const px  = idx % W;
      const py  = Math.floor(idx / W);

      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      count++;
    }
  }

  ctx.clearRect(0, 0, W, H);

  if (count > 400) {
    const bw = maxX - minX;
    const bh = maxY - minY;

    // Nur erkennen wenn die Form halbwegs rund ist
    const ratio = bw / (bh || 1);
    if (ratio > 0.4 && ratio < 2.5 && bw > 20 && bh > 20) {

      const rawBox = {
        x: minX - 12,
        y: minY - 12,
        w: bw + 24,
        h: bh + 24
      };

      // Smoothing
      if (!smoothBox) {
        smoothBox = { ...rawBox };
      } else {
        const a = 0.3;
        smoothBox.x += (rawBox.x - smoothBox.x) * a;
        smoothBox.y += (rawBox.y - smoothBox.y) * a;
        smoothBox.w += (rawBox.w - smoothBox.w) * a;
        smoothBox.h += (rawBox.h - smoothBox.h) * a;
      }

      drawTracking(smoothBox);
      updateStats(smoothBox, count);
      setStatus("found", "🏀 Erkannt");
    }
  } else {
    smoothBox = null;
    setStatus("lost", "Suche Basketball…");
    updateStats(null);
  }

  requestAnimationFrame(loop);
}

// ── Grünes Quadrat + grüner Kreis ────────────────────────────────────────────
function drawTracking(box) {
  const { x, y, w, h } = box;

  // Mittelpunkt & Kreisradius
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r  = Math.min(w, h) / 2;

  // ── 1) Grünes Quadrat (Bounding Box) ──
  ctx.strokeStyle = "#00ff87";
  ctx.lineWidth   = 2.5;
  ctx.shadowColor = "#00ff87";
  ctx.shadowBlur  = 20;
  ctx.strokeRect(x, y, w, h);

  // Eck-Akzente am Quadrat
  ctx.lineWidth  = 4;
  ctx.shadowBlur = 30;
  const c = Math.min(w, h) * 0.18;
  drawCorner(x,     y,      c,  c);
  drawCorner(x + w, y,     -c,  c);
  drawCorner(x,     y + h,  c, -c);
  drawCorner(x + w, y + h, -c, -c);

  // ── 2) Grüner Kreis um den Ball ──
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#00ff87";
  ctx.lineWidth   = 2.5;
  ctx.shadowColor = "#00ff87";
  ctx.shadowBlur  = 25;
  ctx.stroke();

  // ── 3) Kleines Kreuz im Mittelpunkt ──
  ctx.shadowBlur  = 8;
  ctx.strokeStyle = "rgba(0, 255, 135, 0.7)";
  ctx.lineWidth   = 1.5;
  const cr = 8;
  ctx.beginPath();
  ctx.moveTo(cx - cr, cy); ctx.lineTo(cx + cr, cy);
  ctx.moveTo(cx, cy - cr); ctx.lineTo(cx, cy + cr);
  ctx.stroke();

  // ── 4) Label ──
  ctx.shadowBlur = 0;
  const label = "BASKETBALL";
  ctx.font      = "bold 11px monospace";
  const tw      = ctx.measureText(label).width;
  const lx      = x;
  const ly      = y > 28 ? y - 10 : y + h + 20;

  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.beginPath();
  ctx.roundRect(lx - 4, ly - 15, tw + 12, 20, 4);
  ctx.fill();

  ctx.fillStyle = "#00ff87";
  ctx.fillText(label, lx + 2, ly);
}

function drawCorner(x, y, dx, dy) {
  ctx.beginPath();
  ctx.moveTo(x + dx, y);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + dy);
  ctx.stroke();
}

// ── UI ────────────────────────────────────────────────────────────────────────
function setStatus(type, msg) {
  badge.className       = "badge " + type;
  statusTxt.textContent = msg;
}

function updateStats(box, count) {
  if (!box) {
    posXEl.textContent    = "–";
    posYEl.textContent    = "–";
    bWidthEl.textContent  = "–";
    bHeightEl.textContent = "–";
    confEl.textContent    = "–";
    return;
  }
  posXEl.textContent    = `${Math.round(box.x + box.w / 2)} px`;
  posYEl.textContent    = `${Math.round(box.y + box.h / 2)} px`;
  bWidthEl.textContent  = `${Math.round(box.w)} px`;
  bHeightEl.textContent = `${Math.round(box.h)} px`;
  const conf = Math.min(100, Math.round((count / 1500) * 100));
  confEl.textContent    = `${conf}%`;
}

startCamera();
