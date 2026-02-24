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

let currentStream = null;
let facingMode    = "environment";
let loopRunning   = false;
let cvReady       = false;

// Smooth-Werte für flüssige Animation
let smooth = null;

// Einmal erstellen, nicht jeden Frame neu
const tmp  = document.createElement("canvas");
const tCtx = tmp.getContext("2d", { willReadFrequently: true });

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
    // Fallback ohne facingMode (Desktop)
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
  tmp.width      = video.videoWidth;
  tmp.height     = video.videoHeight;
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

// ── Wie viel Prozent der Pixel in einem Kreis sind orange? ───────────────────
function getOrangeRatio(cx, cy, radius) {
  const r2     = radius * radius;
  const x0     = Math.max(0, Math.floor(cx - radius));
  const y0     = Math.max(0, Math.floor(cy - radius));
  const x1     = Math.min(tmp.width  - 1, Math.ceil(cx + radius));
  const y1     = Math.min(tmp.height - 1, Math.ceil(cy + radius));
  const pixels = tCtx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  const data   = pixels.data;
  const W      = x1 - x0 + 1;

  let total = 0, orange = 0;

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy > r2) continue; // außerhalb des Kreises

      const i = ((py - y0) * W + (px - x0)) * 4;
      const red = data[i];
      const grn = data[i + 1];
      const blu = data[i + 2];

      total++;
      // Orange: Rot hoch, Grün mittel, Blau niedrig
      if (red > 130 && grn > 40 && grn < 200 && blu < 100 && red > grn + 20 && red > blu + 50) {
        orange++;
      }
    }
  }

  return total > 0 ? orange / total : 0;
}

// ── Haupt-Loop ────────────────────────────────────────────────────────────────
function loop() {
  if (!loopRunning) return;

  const W = overlay.width;
  const H = overlay.height;

  // Frame in Canvas ziehen
  tCtx.drawImage(video, 0, 0, W, H);

  // OpenCV Matrizen
  let src     = cv.imread(tmp);
  let gray    = new cv.Mat();
  let blurred = new cv.Mat();
  let circles = new cv.Mat();

  try {
    // Graustufen + Weichzeichnen für stabilere Kreiserkennung
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(11, 11), 2, 2);

    // Hough-Kreiserkennung
    // Parameter: dp=1, minDist=50, param1=120 (Canny), param2=25 (Akkumulator – niedrig = sensitiver), minR=15, maxR=300
    cv.HoughCircles(
      blurred,
      circles,
      cv.HOUGH_GRADIENT,
      1,
      Math.min(W, H) / 8,  // Mindestabstand zwischen zwei Kreisen
      120,                  // Canny-Schwelle (Kantenerkennung)
      25,                   // Akkumulator-Schwelle (niedriger = mehr Kreise)
      15,                   // Mindestradius in Pixel
      Math.min(W, H) / 2   // Maximalradius
    );

    ctx.clearRect(0, 0, W, H);

    let bestCircle  = null;
    let bestOrange  = -1;

    // Alle gefundenen Kreise prüfen – den mit dem höchsten Orange-Anteil nehmen
    for (let i = 0; i < circles.cols; i++) {
      const cx = circles.data32F[i * 3];
      const cy = circles.data32F[i * 3 + 1];
      const r  = circles.data32F[i * 3 + 2];

      const ratio = getOrangeRatio(cx, cy, r);

      if (ratio > bestOrange) {
        bestOrange  = ratio;
        bestCircle  = { cx, cy, r };
      }
    }

    // Nur anzeigen wenn Orange-Anteil > 15% (Farbe als Bestätigung)
    if (bestCircle && bestOrange > 0.15) {
      // Smoothing für flüssige Bewegung
      if (!smooth) {
        smooth = { ...bestCircle };
      } else {
        const a  = 0.3;
        smooth.cx += (bestCircle.cx - smooth.cx) * a;
        smooth.cy += (bestCircle.cy - smooth.cy) * a;
        smooth.r  += (bestCircle.r  - smooth.r)  * a;
      }

      drawTracking(smooth, W, H);
      updateStats(smooth, bestOrange);
      setStatus("found", `🏀 Erkannt`);
    } else {
      smooth = null;
      setStatus("lost", "Suche Basketball…");
      updateStats(null);
    }

  } finally {
    // OpenCV Speicher immer freigeben!
    src.delete();
    gray.delete();
    blurred.delete();
    circles.delete();
  }

  requestAnimationFrame(loop);
}

// ── Kreis 1:1 nachzeichnen + knapp sitzendes Quadrat ─────────────────────────
function drawTracking(ball, W, H) {
  const { cx, cy, r } = ball;

  // Bounding-Square: so knapp wie möglich um den Kreis
  const sqX = Math.max(0, cx - r);
  const sqY = Math.max(0, cy - r);
  const sqS = Math.min(r * 2, W - sqX, H - sqY); // quadratische Seite

  // ── 1) Grünes Quadrat – knapp um den Kreis ──
  ctx.save();
  ctx.strokeStyle = "#00ff87";
  ctx.lineWidth   = 2.5;
  ctx.shadowColor = "#00ff87";
  ctx.shadowBlur  = 18;
  ctx.strokeRect(sqX, sqY, sqS, sqS);

  // Eck-Akzente
  ctx.lineWidth  = 4;
  ctx.shadowBlur = 28;
  const c = sqS * 0.18;
  drawCornerShape(sqX,        sqY,         c,  c);
  drawCornerShape(sqX + sqS,  sqY,        -c,  c);
  drawCornerShape(sqX,        sqY + sqS,   c, -c);
  drawCornerShape(sqX + sqS,  sqY + sqS,  -c, -c);
  ctx.restore();

  // ── 2) Grüner Kreis – exakter Umriss des Balls 1:1 ──
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#00ff87";
  ctx.lineWidth   = 2.5;
  ctx.shadowColor = "#00ff87";
  ctx.shadowBlur  = 22;
  ctx.stroke();
  ctx.restore();

  // ── 3) Kreuz im Mittelpunkt ──
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

  // ── 4) Label oben links am Quadrat ──
  ctx.save();
  ctx.font = "bold 11px monospace";
  const label = "BASKETBALL";
  const tw    = ctx.measureText(label).width;
  const lx    = Math.max(0, sqX);
  const ly    = sqY > 26 ? sqY - 10 : sqY + sqS + 20;

  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(lx - 4, ly - 15, tw + 12, 20);
  ctx.fillStyle   = "#00ff87";
  ctx.shadowBlur  = 0;
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
    posXEl.textContent   = "–";
    posYEl.textContent   = "–";
    bRadiusEl.textContent = "–";
    confEl.textContent   = "–";
    return;
  }
  posXEl.textContent    = `${Math.round(ball.cx)} px`;
  posYEl.textContent    = `${Math.round(ball.cy)} px`;
  bRadiusEl.textContent = `${Math.round(ball.r)} px`;
  confEl.textContent    = `${Math.round(orangeRatio * 100)}%`;
}

// Kein startCamera() hier – wird von onOpenCvReady() aufgerufen sobald OpenCV geladen ist
