// script.js — komplett neue, robuste Lösung (keine KI)
// Verhalten: HSV-Farbsegmentierung -> Konturen -> Rundheitsprüfung -> smoothing tracking -> 1 grüner Kreis+Box
// Logs auf Seite, alle Regler wirksam. OpenCV.js muss geladen sein (index.html lädt es synchron).

// UI
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');

const procSizeSelect = document.getElementById('procSize');
const sensSlider = document.getElementById('sensitivity');
const hLowerEl = document.getElementById('hLower');
const hUpperEl = document.getElementById('hUpper');
const sLowerEl = document.getElementById('sLower');
const sUpperEl = document.getElementById('sUpper');
const vLowerEl = document.getElementById('vLower');
const vUpperEl = document.getElementById('vUpper');
const alphaEl = document.getElementById('alpha');
const toggleDrawBtn = document.getElementById('toggleDraw');
const calibBtn = document.getElementById('calib');

let drawEnabled = true;
toggleDrawBtn.addEventListener('click', () => { drawEnabled = !drawEnabled; toggleDrawBtn.textContent = `Zeichnen: ${drawEnabled ? 'Ein' : 'Aus'}`; });

// logging helper (on-page + console)
function addLog(txt) {
  const t = new Date().toLocaleTimeString();
  const e = document.createElement('div');
  e.textContent = `[${t}] ${txt}`;
  logEl.prepend(e);
  if (logEl.children.length > 120) logEl.removeChild(logEl.lastChild);
  console.log(txt);
}
function setStatus(s) { statusEl.textContent = s; }

// camera start
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    video.onloadedmetadata = () => { resizeOverlay(); setStatus('Kamera bereit'); };
  } catch (e) {
    setStatus('Kamera Fehler: ' + e.message);
    addLog('Kamera Fehler: ' + e.message);
  }
}

// match overlay pixel size to visible video box
function resizeOverlay() {
  const r = video.getBoundingClientRect();
  overlay.style.width = r.width + 'px';
  overlay.style.height = r.height + 'px';
  overlay.width = Math.max(1, Math.round(r.width));
  overlay.height = Math.max(1, Math.round(r.height));
}

// mapping from proc coords -> overlay (element pixel coordinates) when object-fit:contain
function mapProcToOverlay(xProc, yProc, rProc, procW, procH) {
  const rect = video.getBoundingClientRect();
  const elemW = rect.width, elemH = rect.height;
  const vidW = video.videoWidth || procW, vidH = video.videoHeight || procH;
  const scale = Math.min(elemW / vidW, elemH / vidH);
  const dispW = vidW * scale, dispH = vidH * scale;
  const offsetX = (elemW - dispW) / 2, offsetY = (elemH - dispH) / 2;
  const cx = offsetX + (xProc / procW) * dispW;
  const cy = offsetY + (yProc / procH) * dispH;
  const r = rProc * (dispW / procW);
  return { cx, cy, r };
}

// simple tracking (exp smoothing + velocity predict)
const track = { x: 0, y: 0, r: 0, vx: 0, vy: 0, has: false, lastTs: null };
function updateTrack(detected, alpha, dt) {
  if (!detected) {
    if (!track.has) return null;
    const damp = 0.92;
    track.vx *= damp; track.vy *= damp;
    track.x += track.vx * dt; track.y += track.vy * dt;
    track.r *= 0.995;
    return { x: track.x, y: track.y, r: track.r };
  }
  if (!track.has) {
    track.x = detected.x; track.y = detected.y; track.r = detected.r;
    track.vx = 0; track.vy = 0; track.has = true;
    return { x: track.x, y: track.y, r: track.r };
  }
  // velocity estimate and smoothing
  const newVx = (detected.x - track.x) / Math.max(1e-3, dt);
  const newVy = (detected.y - track.y) / Math.max(1e-3, dt);
  track.vx = 0.6 * track.vx + 0.4 * newVx;
  track.vy = 0.6 * track.vy + 0.4 * newVy;
  track.x = alpha * detected.x + (1 - alpha) * (track.x + track.vx * dt);
  track.y = alpha * detected.y + (1 - alpha) * (track.y + track.vy * dt);
  track.r = alpha * detected.r + (1 - alpha) * track.r;
  return { x: track.x, y: track.y, r: track.r };
}

// OpenCV readiness and main loop
function onOpenCvReadyWrapper() {
  if (!cv || !cv.getBuildInformation) {
    setTimeout(onOpenCvReadyWrapper, 200);
    return;
  }
  setStatus('OpenCV geladen');
  addLog('OpenCV geladen: ' + cv.getBuildInformation().split('\n')[0]);
  startCamera();
  setTimeout(mainLoop, 300);
}
// If OpenCV sets onRuntimeInitialized, use it; otherwise poll
if (typeof cv !== 'undefined') {
  if (cv.getBuildInformation) onOpenCvReadyWrapper();
  else cv['onRuntimeInitialized'] = onOpenCvReadyWrapper;
} else {
  // very unlikely because index.html loads opencv.js synchronously, but safe fallback
  const poll = setInterval(() => {
    if (typeof cv !== 'undefined' && cv.getBuildInformation) {
      clearInterval(poll);
      onOpenCvReadyWrapper();
    }
  }, 200);
}

// calibration: sample center area -> set HSV sliders
calibBtn.addEventListener('click', () => {
  try {
    const tmp = document.createElement('canvas');
    const W = 160;
    const H = Math.round(W * (video.videoHeight / video.videoWidth || 9 / 16));
    tmp.width = W; tmp.height = H;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(video, 0, 0, W, H);
    const src = cv.imread(tmp);
    const hsv = new cv.Mat();
    cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
    const chs = new cv.MatVector();
    cv.split(hsv, chs);
    const h = chs.get(0), s = chs.get(1), v = chs.get(2);
    const hMin = cv.minMaxLoc(h).minVal, hMax = cv.minMaxLoc(h).maxVal;
    const sMin = cv.minMaxLoc(s).minVal, sMax = cv.minMaxLoc(s).maxVal;
    const vMin = cv.minMaxLoc(v).minVal, vMax = cv.minMaxLoc(v).maxVal;
    const marginH = 8, marginS = 30, marginV = 30;
    hLowerEl.value = Math.max(0, Math.round(hMin - marginH));
    hUpperEl.value = Math.min(179, Math.round(hMax + marginH));
    sLowerEl.value = Math.max(0, Math.round(sMin - marginS));
    sUpperEl.value = Math.min(255, Math.round(sMax + marginS));
    vLowerEl.value = Math.max(0, Math.round(vMin - marginV));
    vUpperEl.value = Math.min(255, Math.round(vMax + marginV));
    src.delete(); hsv.delete(); chs.delete(); h.delete(); s.delete(); v.delete();
    addLog('Kalibrierung: HSV-Mitte gesetzt');
  } catch (e) {
    addLog('Kalibrierung fehlgeschlagen: ' + e.message);
  }
});

// main processing loop
function mainLoop() {
  resizeOverlay();
  const overlayCtx = overlay.getContext('2d');

  // create processing canvas (offscreen)
  let procW = parseInt(procSizeSelect.value, 10);
  let procH = Math.round(procW * (video.videoHeight / video.videoWidth || 9 / 16));
  const pcanvas = document.createElement('canvas');
  pcanvas.width = procW; pcanvas.height = procH;
  const pctx = pcanvas.getContext('2d');

  // allocate mats to reuse
  let src = new cv.Mat(procH, procW, cv.CV_8UC4);
  let hsv = new cv.Mat();
  let mask = new cv.Mat();
  let kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();

  let lastTs = performance.now();

  function processFrame() {
    if (video.readyState < 2) { requestAnimationFrame(processFrame); return; }

    // stable capture
    pctx.drawImage(video, 0, 0, procW, procH);

    // load into cv mat
    try {
      src.delete();
    } catch (e) { /* ignore */ }
    src = cv.imread(pcanvas);

    // HSV threshold
    cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
    const lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [parseInt(hLowerEl.value), parseInt(sLowerEl.value), parseInt(vLowerEl.value)]);
    const upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [parseInt(hUpperEl.value), parseInt(sUpperEl.value), parseInt(vUpperEl.value)]);
    cv.inRange(hsv, lower, upper, mask);
    lower.delete(); upper.delete();

    // morphological clean
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);

    // find contours
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < 250) { cnt.delete(); continue; } // ignore too small
      const perimeter = cv.arcLength(cnt, true);
      const circularity = (4 * Math.PI * area) / (Math.max(1, perimeter * perimeter)); // 0..1
      const mec = cv.minEnclosingCircle(cnt);
      const cx = mec.center.x, cy = mec.center.y, r = mec.radius;
      // compute color ratio (mask pixels inside circle)
      const maskCircle = new cv.Mat.zeros(mask.rows, mask.cols, cv.CV_8UC1);
      cv.circle(maskCircle, new cv.Point(Math.round(cx), Math.round(cy)), Math.max(1, Math.round(r)), new cv.Scalar(255), -1);
      const masked = new cv.Mat();
      cv.bitwise_and(mask, maskCircle, masked);
      const orangeCount = cv.countNonZero(masked);
      const circleArea = Math.PI * r * r;
      const colorRatio = orangeCount / (circleArea + 1e-6); // normalized roughly 0..1
      // store candidate
      candidates.push({ cx, cy, r, area, circularity, colorRatio });
      // cleanup
      maskCircle.delete(); masked.delete(); cnt.delete();
    }

    // pick best by combined score: prioritize colorRatio and circularity
    let best = null;
    for (const c of candidates) {
      // weights tuned for basketball: favor color but require some roundness
      const combined = 0.65 * c.colorRatio + 0.35 * c.circularity;
      // penalize tiny circles
      const penalty = (c.r < Math.min(procW, procH) * 0.03) ? 0.0 : 1.0;
      const score = combined * penalty;
      if (!best || score > best.score) best = { ...c, score };
    }

    // fallback: Hough if no candidates
    if (!best) {
      try {
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, gray, new cv.Size(9, 9), 2, 2);
        const circles = new cv.Mat();
        const dp = 1.2;
        const minDist = Math.max(20, Math.round(procH / 8));
        const param1 = 100;
        const param2 = Math.max(8, parseInt(sensSlider.value, 10));
        const minR = Math.max(6, Math.round(Math.min(procW, procH) * 0.03));
        const maxR = Math.max(minR + 2, Math.round(Math.min(procW, procH) * 0.45));
        cv.HoughCircles(gray, circles, cv.HOUGH_GRADIENT, dp, minDist, param1, param2, minR, maxR);
        if (circles && circles.cols > 0) {
          // evaluate by edge sampling on gray
          const edges = new cv.Mat();
          cv.Canny(gray, edges, 60, 140);
          for (let i = 0; i < circles.cols; i++) {
            const x = circles.data32F[i * 3], y = circles.data32F[i * 3 + 1], r = circles.data32F[i * 3 + 2];
            let sum = 0, samples = 36;
            for (let s = 0; s < samples; s++) {
              const t = (s / samples) * 2 * Math.PI;
              const sx = Math.round(x + r * Math.cos(t)), sy = Math.round(y + r * Math.sin(t));
              if (sx >= 0 && sx < edges.cols && sy >= 0 && sy < edges.rows) sum += edges.ucharPtr(sy, sx)[0] / 255.0;
            }
            const edgeScore = sum / samples;
            if (!best || edgeScore > best.score) best = { cx: x, cy: y, r: r, score: edgeScore, circularity: edgeScore, colorRatio: 0 };
          }
          edges.delete();
        }
        gray.delete(); circles.delete();
      } catch (e) { /* ignore */ }
    }

    // decide detection threshold
    let detected = null;
    if (best && (best.score > 0.08 || best.circularity > 0.5 || best.colorRatio > 0.08)) {
      detected = { x: best.cx, y: best.cy, r: Math.max(4, best.r) };
      addLog(`Det: score=${best.score.toFixed(2)} circ=${(best.circularity||0).toFixed(2)} color=${(best.colorRatio||0).toFixed(2)} r=${Math.round(best.r)}`);
      setStatus(`Kreis erkannt — score ${best.score.toFixed(2)}`);
    } else {
      setStatus('Kein Kreis erkannt');
    }

    // smoothing & draw
    const now = performance.now();
    const dt = Math.max(0.001, (now - (track.lastTs || now)) / 1000.0);
    track.lastTs = now;
    const alpha = parseInt(alphaEl.value, 10) / 100.0;
    const smooth = updateTrack(detected, alpha, dt);
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    if (smooth) {
      const mapped = mapProcToOverlay(smooth.x, smooth.y, smooth.r, procW, procH);
      if (drawEnabled) {
        overlayCtx.save();
        overlayCtx.strokeStyle = '#2ecc71';
        overlayCtx.lineWidth = Math.max(2, Math.round(mapped.r * 0.06));
        overlayCtx.beginPath();
        overlayCtx.arc(mapped.cx, mapped.cy, mapped.r, 0, Math.PI * 2);
        overlayCtx.stroke();
        overlayCtx.lineWidth = 2;
        overlayCtx.strokeRect(mapped.cx - mapped.r, mapped.cy - mapped.r, mapped.r * 2, mapped.r * 2);
        overlayCtx.restore();
      }
    }

    // cleanup per-frame mats
    // src,hsv,mask,kernel,contours,hierarchy reused; we deleted per use items already
    requestAnimationFrame(processFrame);
  }

  requestAnimationFrame(processFrame);
  window.addEventListener('resize', resizeOverlay);
}

// start wrapper ensures OpenCV ready
// (index.html loads opencv.js synchronously so cv should be defined; fallback polling added)
(function init() {
  try {
    if (typeof cv !== 'undefined' && cv.getBuildInformation) onOpenCvReadyWrapper();
    else {
      // if opencv.js will set onRuntimeInitialized, it will call onOpenCvReadyWrapper
      if (typeof cv !== 'undefined') cv['onRuntimeInitialized'] = onOpenCvReadyWrapper;
      else {
        // poll as last fallback
        const poll = setInterval(() => {
          if (typeof cv !== 'undefined' && cv.getBuildInformation) {
            clearInterval(poll);
            onOpenCvReadyWrapper();
          }
        }, 200);
      }
    }
  } catch (e) {
    addLog('Init Fehler: ' + e.message);
  }
})();
