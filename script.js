const video     = document.getElementById("video");
const overlay   = document.getElementById("overlay");
const ctx       = overlay.getContext("2d");
const badge     = document.getElementById("statusBadge");
const statusTxt = document.getElementById("statusText");
const posXEl    = document.getElementById("posX");
const posYEl    = document.getElementById("posY");
const bRadiusEl = document.getElementById("bRadius");
const confEl    = document.getElementById("confidence");
const btnSwitch = document.getElementById("btnSwitch");

// Slider-Referenzen
const sliders = {
  rMin:      document.getElementById("rMin"),
  gMin:      document.getElementById("gMin"),
  gMax:      document.getElementById("gMax"),
  bMax:      document.getElementById("bMax"),
  rgDiff:    document.getElementById("rgDiff"),
  rbDiff:    document.getElementById("rbDiff"),
  minOrange: document.getElementById("minOrange"),
  hough:     document.getElementById("hough"),
};

// Slider-Anzeigen live updaten
Object.keys(sliders).forEach(key => {
  const display = document.getElementById(key + "Val");
  sliders[key].addEventListener("input", () => {
    display.textContent = sliders[key].value;
  });
});

let currentStream = null;
let facingMode    = "environment";
let loopRunning   = false;
let cvReady       = false;
let smooth        = null;

const SCALE = 0.5;
const tmp   = document.createElement("canvas");
const tCtx  = tmp.getContext("2d", { willReadFrequently: true });

// ── OpenCV bereit ─────────────────────────────────────────────────────────────
function onOpenCvReady() {
  cvReady = true;
  setStatus("lost", "Kamera startet…");
  startCamera();
}

// ── Kamera starten ────────────────────────────────────────────────────────────
async function startCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
    loopRunning   = false;
  }

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

// ── Loop starten wenn Video wirklich läuft ────────────────────────────────────
video.addEventListener("playing", function () {
  overlay.width  = video.videoWidth;
  overlay.height = video.videoHeight;
  tmp.width      = Math.floor(video.videoWidth  * SCALE);
  tmp.height     = Math.floor(video.videoHeight * SCALE);
  smooth         = null;

  if (!loopRunning && cvReady) {
    loopRunning = true;
    setStatus("lost", "Suche Basketball…");
    requestAnimationFrame(loop);
  }
});

// ── Kamera wechseln ───────────────────────────────────────────────────────────
btnSwitch.addEventListener("click", function () {
  facingMode  = facingMode === "environment" ? "user" : "environment";
  loopRunning = false;
  smooth      = null;
  startCamera();
});

// ── Orange-Anteil messen – Werte live von Slidern ─────────────────────────────
function getOrangeRatio(cx, cy, radius) {
  const R_MIN   = parseInt(sliders.rMin.value);
  const G_MIN   = parseInt(sliders.gMin.value);
  const G_MAX   = parseInt(sliders.gMax.value);
  const B_MAX   = parseInt(sliders.bMax.value);
  const RG_DIFF = parseInt(sliders.rgDiff.value);
  const RB_DIFF = parseInt(sliders.rbDiff.value);

  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(tmp.width  - 1, Math.ceil(cx + radius));
  const y1 = Math.min(tmp.height - 1, Math.ceil(cy + radius));
  const W  = x1 - x0 + 1;

  const pixels = tCtx.getImageData(x0, y0, W, y1 - y0 + 1);
  const data   = pixels.data;

  let total = 0, orange = 0;

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - cx, dy = py - cy;
      if (dx * dx + dy * dy > r2) continue;

      const i   = ((py - y0) * W + (px - x0)) * 4;
      const red = data[i];
      const grn = data[i + 1];
      const blu = data[i + 2];

      total++;

      // Farbbedingungen – alle über Slider steuerbar
      if (
        red > R_MIN &&
        grn > G_MIN &&
        grn < G_MAX &&
        blu < B_MAX &&
        red > grn + RG_DIFF &&
        red > blu + RB_DIFF
      ) {
        orange++;
      }
    }
  }

  return total > 0 ? orange / total : 0;
}

// ── Haupt-Loop ────────────────────────────────────────────────────────────────
function loop() {
  if (!loopRunning) return;

  const W  = overlay.width;
  const H  = overlay.height;
  const TW = tmp.width;
  const TH = tmp.height;

  tCtx.drawImage(video, 0, 0, TW, TH);

  let src     = cv.imread(tmp);
  let gray    = new cv.Mat();
  let blurred = new cv.Mat();
  let circles = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 1.5, 1.5);

    const houghParam2 = parseInt(sliders.hough.value);

    cv.HoughCircles(
      blurred,
      circles,
      cv.HOUGH_GRADIENT,
      1,
      Math.min(TW, TH) / 6,
      100,
      houghParam2,           // live per Slider steuerbar
      10,
      Math.min(TW, TH) / 2
    );

    ctx.clearRect(0, 0, W, H);

    let bestCircle = null;
    let bestOrange = -1;

    for (let i = 0; i < circles.cols; i++) {
      const cx = circles.data32F[i * 3]     / SCALE;
      const cy = circles.data32F[i * 3 + 1] / SCALE;
      const r  = circles.data32F[i * 3 + 2] / SCALE;

      const sCx   = circles.data32F[i * 3];
      const sCy   = circles.data32F[i * 3 + 1];
      const sR    = circles.data32F[i * 3 + 2];
      const ratio = getOrangeRatio(sCx, sCy, sR);

      if (ratio > bestOrange) {
        bestOrange = ratio;
        bestCircle = { cx, cy, r };
      }
    }

    const minOrange = parseInt(sliders.minOrange.value) / 100;

    if (bestCircle && bestOrange > minOrange) {
      if (!smooth) {
        smooth = { ...bestCircle };
      } else {
        const a = 0.4;
        smooth.cx += (bestCircle.cx - smooth.cx) * a;
        smooth.cy += (bestCircle.cy - smooth.cy) * a;
        smooth.r  += (bestCircle.r  - smooth.r)  * a;
      }

      drawTracking(smooth, W, H);
      updateStats(smooth, bestOrange);
      setStatus("found", "🏀 Erkannt");
    } else {
      smooth = null;
      setStatus("lost", "Suche Basketball…");
      updateStats(null);
    }

  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    circles.delete();
  }

  requestAnimationFrame(loop);
}

// ── Grüner Kreis 1:1 + knapp sitzendes Quadrat ───────────────────────────────
function drawTracking(ball, W, H) {
  const { cx, cy, r } = ball;

  const sqX = Math.max(0, cx - r);
  const sqY = Math.max(0, cy - r);
  const sqS = Math.min(r * 2, W - sqX, H - sqY);

  // 1) Grünes Quadrat
  ctx.save();
  ctx.strokeStyle = "#00ff87";
  ctx.lineWidth   = 2.5;
  ctx.shadowColor = "#00ff87";
  ctx.shadowBlur  = 18;
  ctx.strokeRect(sqX, sqY, sqS, sqS);

  ctx.lineWidth  = 4;
  ctx.shadowBlur = 28;
  const c = sqS * 0.18;
  drawCornerShape(sqX,       sqY,        c,  c);
  drawCornerShape(sqX + sqS, sqY,       -c,  c);
  drawCornerShape(sqX,       sqY + sqS,  c, -c);
  drawCornerShape(sqX + sqS, sqY + sqS, -c, -c);
  ctx.restore();

  // 2) Grüner Kreis – exakt 1:1 auf dem Ball
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#00ff87";
  ctx.lineWidth   = 2.5;
  ctx.shadowColor = "#00ff87";
  ctx.shadowBlur  = 22;
  ctx.stroke();
  ctx.restore();

  // 3) Kreuz im Mittelpunkt
  ctx.save();
  ctx.strokeStyle = "rgba(0,255,135,0.75)";
  ctx.lineWidth   = 1.5;
  ctx.shadowColor = "#00ff87";
  ctx.shadowBlur  = 8;
  const cr = 9;
  ctx.beginPath();
  ctx.moveTo(cx - cr, cy); ctx.lineTo(cx + cr, cy);
  ctx.moveTo(cx, cy - cr); ctx.lineTo(cx, cy + cr);
  ctx.stroke();
  ctx.restore();

  // 4) Label
  ctx.save();
  ctx.font = "bold 11px monospace";
  const label = "BASKETBALL";
  const tw    = ctx.measureText(label).width;
  const lx    = Math.max(0, sqX);
  const ly    = sqY > 26 ? sqY - 10 : sqY + sqS + 20;

  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(lx - 4, ly - 15, tw + 12, 20);
  ctx.fillStyle  = "#00ff87";
  ctx.shadowBlur = 0;
  ctx.fillText(label, lx + 2, ly);
  ctx.restore();
}

function drawCornerShape(x, y, dx, dy) {
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

function updateStats(ball, orangeRatio) {
  if (!ball) {
    posXEl.textContent    = "–";
    posYEl.textContent    = "–";
    bRadiusEl.textContent = "–";
    confEl.textContent    = "–";
    return;
  }
  posXEl.textContent    = `${Math.round(ball.cx)} px`;
  posYEl.textContent    = `${Math.round(ball.cy)} px`;
  bRadiusEl.textContent = `${Math.round(ball.r)} px`;
  confEl.textContent    = `${Math.round((orangeRatio || 0) * 100)}%`;
}

startCamera();
