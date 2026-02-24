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

// ── Kamera-State ─────────────────────────────────────────────────────────────
let currentStream   = null;
let facingMode      = "environment"; // startet mit Rückkamera
let loopRunning     = false;
let smoothBox       = null;

// ── Kamera starten ───────────────────────────────────────────────────────────
async function startCamera() {
  // Alten Stream stoppen falls vorhanden
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

    currentStream  = stream;
    video.srcObject = stream;

  } catch (err) {
    // Fallback: ohne facingMode probieren (z.B. Desktop ohne Rückkamera)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
      currentStream   = stream;
      video.srcObject = stream;
    } catch (err2) {
      setStatus("lost", "Kein Kamera-Zugriff");
      console.error(err2);
    }
  }
}

// ── Wenn Video wirklich läuft → Loop starten ─────────────────────────────────
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

// ── Kamera wechseln ──────────────────────────────────────────────────────────
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

  // Kamerabild in temporären Canvas zum Pixel-Lesen
  const tmp    = document.createElement("canvas");
  tmp.width    = W;
  tmp.height   = H;
  const tCtx   = tmp.getContext("2d");
  tCtx.drawImage(video, 0, 0, W, H);

  const imageData = tCtx.getImageData(0, 0, W, H);
  const data      = imageData.data;

  let minX = W, minY = H, maxX = 0, maxY = 0, count = 0;

  // Jeden 2. Pixel prüfen für Performance
  for (let i = 0; i < data.length; i += 8) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Basketball-Orange erkennen
    if (r > 150 && g > 60 && g < 180 && b < 80 && r > g + 30 && r > b + 70) {
      const idx = i / 4;
      const px  = (idx * 2) % W;
      const py  = Math.floor((idx * 2) / W);

      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      count++;
    }
  }

  ctx.clearRect(0, 0, W, H);

  if (count > 200) {
    const rawBox = {
      x: Math.max(0, minX - 15),
      y: Math.max(0, minY - 15),
      w: Math.min(W, (maxX - minX) + 30),
      h: Math.min(H, (maxY - minY) + 30)
    };

    const ratio = rawBox.w / (rawBox.h || 1);

    if (ratio > 0.25 && ratio < 4) {
      // Smoothing für flüssige Bewegung
      if (!smoothBox) {
        smoothBox = { ...rawBox };
      } else {
        const a = 0.3;
        smoothBox.x = smoothBox.x + (rawBox.x - smoothBox.x) * a;
        smoothBox.y = smoothBox.y + (rawBox.y - smoothBox.y) * a;
        smoothBox.w = smoothBox.w + (rawBox.w - smoothBox.w) * a;
        smoothBox.h = smoothBox.h + (rawBox.h - smoothBox.h) * a;
      }

      drawBox(smoothBox, W, H);
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

// ── Grüne Tracking-Box ────────────────────────────────────────────────────────
function drawBox(box, W, H) {
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  const cy = y + h / 2;

  // Haupt-Rechteck
  ctx.strokeStyle = "#00ff87";
  ctx.lineWidth   = 2;
  ctx.shadowColor = "#00ff87";
  ctx.shadowBlur  = 18;
  ctx.strokeRect(x, y, w, h);

  // Eck-Akzente
  ctx.lineWidth = 3.5;
  ctx.shadowBlur = 28;
  const c = Math.min(w, h) * 0.2;
  corner(x,     y,      c,  c);
  corner(x + w, y,     -c,  c);
  corner(x,     y + h,  c, -c);
  corner(x + w, y + h, -c, -c);

  // Kreuz in der Mitte
  ctx.shadowBlur  = 6;
  ctx.strokeStyle = "rgba(0,255,135,0.5)";
  ctx.lineWidth   = 1.5;
  const cr = 10;
  ctx.beginPath();
  ctx.moveTo(cx - cr, cy); ctx.lineTo(cx + cr, cy);
  ctx.moveTo(cx, cy - cr); ctx.lineTo(cx, cy + cr);
  ctx.stroke();

  // Label
  ctx.shadowBlur = 0;
  const label = `BASKETBALL`;
  ctx.font = "bold 11px 'DM Mono', monospace";
  const tw  = ctx.measureText(label).width;
  const lx  = Math.max(0, Math.min(x, W - tw - 16));
  const ly  = y > 28 ? y - 10 : y + h + 20;

  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.beginPath();
  ctx.roundRect(lx - 6, ly - 15, tw + 14, 20, 4);
  ctx.fill();

  ctx.fillStyle = "#00ff87";
  ctx.fillText(label, lx + 1, ly);
}

function corner(x, y, dx, dy) {
  ctx.beginPath();
  ctx.moveTo(x + dx, y);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + dy);
  ctx.stroke();
}

// ── UI-Helfer ────────────────────────────────────────────────────────────────
function setStatus(type, msg) {
  badge.className    = "badge " + type;
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
  const conf = Math.min(100, Math.round((count / 1000) * 100));
  confEl.textContent    = `${conf}%`;
}

// ── Start ─────────────────────────────────────────────────────────────────────
startCamera();
