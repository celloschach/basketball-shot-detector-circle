const video         = document.getElementById('video');
const videoCanvas   = document.getElementById('videoCanvas');
const overlayCanvas = document.getElementById('overlayCanvas');
const vCtx          = videoCanvas.getContext('2d', { willReadFrequently: true });
const oCtx          = overlayCanvas.getContext('2d');

const statusBadge = document.getElementById('statusBadge');
const statusText  = document.getElementById('statusText');
const posXEl      = document.getElementById('posX');
const posYEl      = document.getElementById('posY');
const bWidthEl    = document.getElementById('bWidth');
const bHeightEl   = document.getElementById('bHeight');
const confEl      = document.getElementById('confidence');

const rMinSlider  = document.getElementById('rMin');
const gMinSlider  = document.getElementById('gMin');
const bMaxSlider  = document.getElementById('bMax');
const minPxSlider = document.getElementById('minPx');

rMinSlider.addEventListener('input',  () => document.getElementById('rMinVal').textContent  = rMinSlider.value);
gMinSlider.addEventListener('input',  () => document.getElementById('gMinVal').textContent  = gMinSlider.value);
bMaxSlider.addEventListener('input',  () => document.getElementById('bMaxVal').textContent  = bMaxSlider.value);
minPxSlider.addEventListener('input', () => document.getElementById('minPxVal').textContent = minPxSlider.value);

async function startCamera() {
  try {
    setStatus('detecting', 'Kamera wird gestartet…');

    // Schritt 1: Stream holen
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });

    // Schritt 2: Stream zuweisen
    video.srcObject = stream;

    // Schritt 3: Warten bis Metadaten + Bilddaten wirklich da sind
    await new Promise((resolve) => {
      video.oncanplay = resolve;
    });

    // Schritt 4: Video abspielen
    await video.play();

    // Schritt 5: Erst JETZT Canvas-Größe setzen (videoWidth ist jetzt garantiert > 0)
    const W = video.videoWidth;
    const H = video.videoHeight;

    videoCanvas.width    = W;
    videoCanvas.height   = H;
    overlayCanvas.width  = W;
    overlayCanvas.height = H;

    console.log(`Kamera bereit: ${W}x${H}`);
    setStatus('detecting', 'Suche Basketball…');

    // Schritt 6: Loop starten
    requestAnimationFrame(processFrame);

  } catch (err) {
    console.error('Fehler:', err);

    if (err.name === 'NotAllowedError') {
      setStatus('lost', 'Kamera-Erlaubnis verweigert');
    } else if (err.name === 'NotFoundError') {
      setStatus('lost', 'Keine Kamera gefunden');
    } else {
      setStatus('lost', 'Kamera-Fehler: ' + err.message);
    }
  }
}

let smoothBox = null;

function processFrame() {
  const W = videoCanvas.width;
  const H = videoCanvas.height;

  vCtx.drawImage(video, 0, 0, W, H);

  const frame = vCtx.getImageData(0, 0, W, H);
  const data  = frame.data;

  const R_MIN  = parseInt(rMinSlider.value);
  const G_MIN  = parseInt(gMinSlider.value);
  const B_MAX  = parseInt(bMaxSlider.value);
  const MIN_PX = parseInt(minPxSlider.value);

  let minX = W, minY = H, maxX = 0, maxY = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4 * 2) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (r > R_MIN && g > G_MIN && g < 200 && b < B_MAX && r > g + 30 && r > b + 60) {
      const pixelIndex = (i / 4);
      const px = (pixelIndex * 2) % W;
      const py = Math.floor((pixelIndex * 2) / W);

      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      count++;
    }
  }

  oCtx.clearRect(0, 0, W, H);

  if (count > MIN_PX) {
    const rawBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    const ratio = rawBox.w / (rawBox.h || 1);
    const isReasonable = ratio > 0.3 && ratio < 3.5;

    if (isReasonable) {
      const pad = 20;
      rawBox.x = Math.max(0, rawBox.x - pad);
      rawBox.y = Math.max(0, rawBox.y - pad);
      rawBox.w = Math.min(W - rawBox.x, rawBox.w + pad * 2);
      rawBox.h = Math.min(H - rawBox.y, rawBox.h + pad * 2);

      if (!smoothBox) {
        smoothBox = { ...rawBox };
      } else {
        const alpha = 0.35;
        smoothBox.x = lerp(smoothBox.x, rawBox.x, alpha);
        smoothBox.y = lerp(smoothBox.y, rawBox.y, alpha);
        smoothBox.w = lerp(smoothBox.w, rawBox.w, alpha);
        smoothBox.h = lerp(smoothBox.h, rawBox.h, alpha);
      }

      drawTrackingBox(smoothBox, count, W, H);
      updateStats(smoothBox, count, MIN_PX);
      setStatus('detecting', '🏀 Basketball erkannt');
    }
  } else {
    if (smoothBox) {
      drawFadingBox(smoothBox);
      smoothBox = null;
    }
    setStatus('lost', 'Kein Basketball gefunden');
    updateStats(null);
  }

  requestAnimationFrame(processFrame);
}

function drawTrackingBox(box, count, W, H) {
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  const cy = y + h / 2;

  oCtx.strokeStyle = '#22ff7a';
  oCtx.lineWidth   = 2.5;
  oCtx.shadowColor = '#22ff7a';
  oCtx.shadowBlur  = 12;
  oCtx.strokeRect(x, y, w, h);

  oCtx.shadowBlur = 20;
  oCtx.lineWidth  = 4;
  const corner = Math.min(w, h) * 0.22;
  drawCorner(oCtx, x,     y,      corner,  corner);
  drawCorner(oCtx, x + w, y,     -corner,  corner);
  drawCorner(oCtx, x,     y + h,  corner, -corner);
  drawCorner(oCtx, x + w, y + h, -corner, -corner);

  oCtx.shadowBlur  = 8;
  oCtx.strokeStyle = 'rgba(34,255,122,0.6)';
  oCtx.lineWidth   = 1.5;
  const cross = 12;
  oCtx.beginPath();
  oCtx.moveTo(cx - cross, cy); oCtx.lineTo(cx + cross, cy);
  oCtx.moveTo(cx, cy - cross); oCtx.lineTo(cx, cy + cross);
  oCtx.stroke();

  oCtx.shadowBlur = 0;
  const label = `BASKETBALL  ${w.toFixed(0)}×${h.toFixed(0)}px`;
  oCtx.font = 'bold 11px Courier New';
  const tw = oCtx.measureText(label).width;
  const lx = Math.min(x, W - tw - 14);
  const ly = y > 24 ? y - 26 : y + h + 8;

  oCtx.fillStyle = 'rgba(0,0,0,0.65)';
  oCtx.fillRect(lx - 4, ly - 14, tw + 12, 20);
  oCtx.fillStyle = '#22ff7a';
  oCtx.fillText(label, lx + 2, ly);
}

function drawCorner(ctx, x, y, dx, dy) {
  ctx.beginPath();
  ctx.moveTo(x + dx, y);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + dy);
  ctx.stroke();
}

function drawFadingBox(box) {
  oCtx.strokeStyle = 'rgba(34,255,122,0.25)';
  oCtx.lineWidth = 1.5;
  oCtx.strokeRect(box.x, box.y, box.w, box.h);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function setStatus(type, msg) {
  statusBadge.className = 'status-badge ' + type;
  statusText.textContent = msg;
}

function updateStats(box, count, minPx) {
  if (!box) {
    posXEl.textContent   = '–';
    posYEl.textContent   = '–';
    bWidthEl.textContent  = '–';
    bHeightEl.textContent = '–';
    confEl.textContent   = '–';
    return;
  }
  posXEl.textContent    = `${(box.x + box.w / 2).toFixed(0)} px`;
  posYEl.textContent    = `${(box.y + box.h / 2).toFixed(0)} px`;
  bWidthEl.textContent  = `${box.w.toFixed(0)} px`;
  bHeightEl.textContent = `${box.h.toFixed(0)} px`;
  const conf = Math.min(100, Math.round((count / (minPx * 5)) * 100));
  confEl.textContent = `${conf} %`;
}

startCamera();
