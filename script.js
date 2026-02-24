// script.js — robuste Erkennung, Logs auf Seite, korrektes Mapping (object-fit: contain)
// Ersetze komplett deine alte script.js

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const detEl = document.getElementById('det');
const procSizeSelect = document.getElementById('procSize');
const sensSlider = document.getElementById('sensitivity');
const toggleDrawBtn = document.getElementById('toggleDraw');

let cvReady = false;
let streaming = false;
let drawEnabled = true;

toggleDrawBtn.addEventListener('click', () => {
  drawEnabled = !drawEnabled;
  toggleDrawBtn.textContent = `Zeichnen: ${drawEnabled ? 'Ein' : 'Aus'}`;
});

// Log helper (in-page)
const maxLogs = 50;
function addLog(text) {
  const now = new Date();
  const ts = now.toLocaleTimeString();
  const entry = `[${ts}] ${text}`;
  const p = document.createElement('div');
  p.textContent = entry;
  detEl.prepend(p);
  // limit entries
  while (detEl.children.length > maxLogs) detEl.removeChild(detEl.lastChild);
}

// Status
function setStatus(s){ statusEl.textContent = s; }

// Start camera
async function startCamera(){
  try {
    const constraints = {
      audio: false,
      video: { facingMode: "environment", width:{ ideal:1280 }, height:{ ideal:720 } }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      streaming = true;
      setStatus('Kamera bereit');
      resizeOverlay();
    };
  } catch (err) {
    setStatus('Kamera-Fehler: ' + err.message);
    addLog('Kamera Fehler: ' + err.message);
  }
}

// Ensure overlay canvas pixel dimensions match element layout box
function resizeOverlay() {
  const rect = video.getBoundingClientRect();
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
  overlay.width = Math.max(1, Math.round(rect.width));
  overlay.height = Math.max(1, Math.round(rect.height));
}

// Compute mapping from proc coords -> overlay canvas coordinates (element-local)
function mapProcToOverlay(xProc, yProc, rProc, procW, procH) {
  // visible element box size
  const rect = video.getBoundingClientRect();
  const elemW = rect.width;
  const elemH = rect.height;

  const vidW = video.videoWidth || procW;
  const vidH = video.videoHeight || procH;

  const scale = Math.min(elemW / vidW, elemH / vidH);
  const dispW = vidW * scale;
  const dispH = vidH * scale;
  const offsetX = (elemW - dispW) / 2;
  const offsetY = (elemH - dispH) / 2;

  const cx = offsetX + (xProc / procW) * dispW;
  const cy = offsetY + (yProc / procH) * dispH;
  // radius scaled proportional to displayed size
  const r = rProc * (dispW / procW);

  return { cx, cy, r };
}

// OpenCV ready
function onOpenCvReady() {
  cvReady = true;
  setStatus('OpenCV geladen — starte Kamera');
  startCamera().then(() => {
    setTimeout(mainLoop, 200); // kleines Delay damit Video sichtbar ist
  });
}

// Wait for cv
if (typeof cv !== 'undefined') {
  if (cv.getBuildInformation) onOpenCvReady();
  else cv['onRuntimeInitialized'] = onOpenCvReady;
} else {
  const poll = setInterval(() => {
    if (typeof cv !== 'undefined' && cv.getBuildInformation) {
      clearInterval(poll);
      onOpenCvReady();
    }
  }, 200);
}

// Processing loop
function mainLoop() {
  if (!streaming || !cvReady) {
    setTimeout(mainLoop, 200);
    return;
  }
  resizeOverlay();

  // Offscreen canvas for stable capture
  const procWidth = parseInt(procSizeSelect.value, 10);
  const procHeight = Math.round(procWidth * (video.videoHeight / video.videoWidth || 9/16));
  const procCanvas = document.createElement('canvas');
  procCanvas.width = procWidth;
  procCanvas.height = procHeight;
  const pCtx = procCanvas.getContext('2d');

  // Prepare OpenCV mats (we'll recreate src each frame with cv.imread)
  let gray = new cv.Mat();
  let blur = new cv.Mat();
  let canny = new cv.Mat();
  let circles = new cv.Mat();

  const overlayCtx = overlay.getContext('2d');
  overlayCtx.clearRect(0,0,overlay.width,overlay.height);

  let lastTime = performance.now();
  let fps = 0;

  function processFrame() {
    if (video.readyState < 2) {
      requestAnimationFrame(processFrame);
      return;
    }

    // draw video frame scaled to proc canvas
    pCtx.drawImage(video, 0, 0, procWidth, procHeight);

    // read into cv mat
    let src;
    try {
      src = cv.imread(procCanvas); // CV_8UC4
    } catch (err) {
      addLog('cv.imread fehlgeschlagen: ' + err.message);
      requestAnimationFrame(processFrame);
      return;
    }

    // gray -> blur -> canny
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(9,9), 2, 2, cv.BORDER_DEFAULT);
    cv.Canny(blur, canny, 50, 150);

    // HoughCircles (auf blur verbessert Stabilität)
    circles.delete(); circles = new cv.Mat();
    const dp = 1.2;
    const minDist = Math.max(20, Math.round(procHeight / 8));
    const param1 = 100;
    // sensitivity slider reduces param2 (lower = more circles)
    const param2 = Math.max(8, parseInt(sensSlider.value, 10)); // 10..40 mapped to param2
    const minRadius = Math.max(6, Math.round(Math.min(procWidth, procHeight) * 0.03));
    const maxRadius = Math.max(minRadius+2, Math.round(Math.min(procWidth, procHeight) * 0.45));

    try {
      cv.HoughCircles(blur, circles, cv.HOUGH_GRADIENT, dp, minDist, param1, param2, minRadius, maxRadius);
    } catch (e) {
      // ignore occasional Hough exceptions
      console.warn('Hough error', e);
    }

    // evaluate candidates (edge score)
    let best = null;
    if (circles && circles.cols > 0) {
      for (let i = 0; i < circles.cols; ++i) {
        const x = circles.data32F[i*3];
        const y = circles.data32F[i*3+1];
        const r = circles.data32F[i*3+2];

        // edgeScore: sample along circumference on canny
        const samples = 64;
        let sum = 0;
        for (let s = 0; s < samples; ++s) {
          const theta = (s / samples) * 2 * Math.PI;
          const sx = Math.round(x + r * Math.cos(theta));
          const sy = Math.round(y + r * Math.sin(theta));
          if (sx >= 0 && sx < canny.cols && sy >= 0 && sy < canny.rows) {
            sum += canny.ucharPtr(sy, sx)[0] / 255.0;
          }
        }
        const edgeScore = sum / samples;
        if (!best || edgeScore > best.edgeScore) {
          best = { x, y, r, edgeScore };
        }
      }
    }

    // draw best (if above threshold) and log to page
    overlayCtx.clearRect(0,0,overlay.width,overlay.height);
    if (best && best.edgeScore > 0.10) { // threshold can be tuned
      const mapped = mapProcToOverlay(best.x, best.y, best.r, procWidth, procHeight);
      if (drawEnabled) {
        // one green circle + bounding box
        overlayCtx.save();
        overlayCtx.lineWidth = Math.max(2, Math.round(mapped.r * 0.07));
        overlayCtx.strokeStyle = '#2ecc71';
        overlayCtx.beginPath();
        overlayCtx.arc(mapped.cx, mapped.cy, mapped.r, 0, Math.PI*2);
        overlayCtx.stroke();

        const bx = mapped.cx - mapped.r, by = mapped.cy - mapped.r, bw = mapped.r*2, bh = mapped.r*2;
        overlayCtx.lineWidth = 2;
        overlayCtx.strokeRect(bx, by, bw, bh);
        overlayCtx.restore();
      }
      addLog(`Kreis: score=${best.edgeScore.toFixed(2)} proc=(${Math.round(best.x)},${Math.round(best.y)},r=${Math.round(best.r)})`);
      setStatus(`Kreis erkannt — score ${best.edgeScore.toFixed(2)}`);
    } else {
      setStatus('Kein Kreis erkannt');
    }

    // cleanup src
    src.delete();

    // fps
    const now = performance.now();
    fps = 1000 / (now - lastTime);
    lastTime = now;
    // update every ~10 frames to avoid spamming UI status
    // but keep setStatus above for detection result

    requestAnimationFrame(processFrame);
  }

  requestAnimationFrame(processFrame);

  // keep overlay resized on viewport changes
  window.addEventListener('resize', resizeOverlay);
  video.addEventListener('resize', resizeOverlay);
}
