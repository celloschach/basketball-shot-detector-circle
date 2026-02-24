// script.js
// Browser-seitige Basketball-Kreiserkennung mit OpenCV.js
// Nutzungsweise: öffne die Seite, erlaube Kamera; OpenCV.js initialisiert automatisch.
// Ziel: exakt ein grüner Kreis + grüne Bounding Box, in Echtzeit.

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const modeSelect = document.getElementById('mode');
const procSizeSelect = document.getElementById('procSize');
const calibrateBtn = document.getElementById('calibrate');

let streaming = false;
let streamWidth = 640, streamHeight = 480;
let procWidth = parseInt(procSizeSelect.value, 10);
let procHeight = 0;

let cvReady = false;
let processing = false;

// HSV calibration defaults for "orange" (can be tuned)
let hsvLower = [5, 120, 120];   // H,S,V
let hsvUpper = [25, 255, 255];

function logStatus(s){
  statusEl.textContent = s;
}

// Kamerazugriff
async function startCamera() {
  try {
    const constraints = {
      audio: false,
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.addEventListener('loadedmetadata', () => {
      streamWidth = video.videoWidth || 640;
      streamHeight = video.videoHeight || 480;
      adjustCanvasSizes();
      streaming = true;
    });
  } catch (err) {
    logStatus('Kamera nicht verfügbar: ' + err.message);
  }
}

function adjustCanvasSizes() {
  // Overlay gleiche Pixelgröße wie Video-Element (CSS mirrored)
  // Set canvas to actual video pixel size to keep detection accurate.
  const rectW = streamWidth;
  const rectH = streamHeight;
  overlay.width = rectW;
  overlay.height = rectH;

  // set processing size according to procWidth preserving aspect ratio
  procWidth = parseInt(procSizeSelect.value, 10);
  procHeight = Math.round(procWidth * streamHeight / streamWidth);
}

// OpenCV ready
function onOpenCvReady() {
  cvReady = true;
  logStatus('OpenCV geladen');
  startProcessingLoop();
}

// Wait for opencv.js runtime
if (typeof cv !== 'undefined') {
  if (cv.getBuildInformation) {
    onOpenCvReady();
  } else {
    cv['onRuntimeInitialized'] = onOpenCvReady;
  }
} else {
  // Fallback: poll until cv exists
  const cvPoll = setInterval(() => {
    if (typeof cv !== 'undefined' && cv.getBuildInformation) {
      clearInterval(cvPoll);
      onOpenCvReady();
    }
  }, 200);
}

// Utility: draw circle and bounding box on overlay canvas (mirrored)
function drawResult(ctx, cx, cy, r) {
  ctx.save();
  ctx.clearRect(0,0,overlay.width,overlay.height);

  ctx.strokeStyle = '#2ecc71';
  ctx.lineWidth = Math.max(3, Math.round(r * 0.06));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.stroke();

  // Bounding box
  const x1 = cx - r, y1 = cy - r, w = r*2, h = r*2;
  ctx.lineWidth = 2;
  ctx.strokeRect(x1, y1, w, h);

  ctx.restore();
}

// Hauptverarbeitungsloop mit OpenCV.js
async function startProcessingLoop() {
  await startCamera();
  if (!streaming) {
    logStatus('Warte auf Kamerastart...');
    // still proceed when loadedmetadata fires
  }
  // Wait for video metadata loaded or a short timeout
  const waitForVideo = new Promise(resolve => {
    if (streaming) resolve();
    else {
      video.addEventListener('loadedmetadata', () => resolve(), {once:true});
      setTimeout(resolve, 2000);
    }
  });
  await waitForVideo;

  adjustCanvasSizes();

  // allocate mats
  let cap = new cv.VideoCapture(video);

  // we create processing mats at a smaller resolution to speed up
  let procSize = { width: procWidth, height: procHeight };
  let src = new cv.Mat(procSize.height, procSize.width, cv.CV_8UC4);
  let gray = new cv.Mat();
  let blurred = new cv.Mat();
  let canny = new cv.Mat();
  let circles = new cv.Mat();

  // Mats for color scoring
  let hsv = new cv.Mat();
  let maskOrange = new cv.Mat();
  let maskCircle = new cv.Mat();

  const overlayCtx = overlay.getContext('2d');

  let lastTime = performance.now();
  let fps = 0;
  function process() {
    if (!cvReady) {
      requestAnimationFrame(process);
      return;
    }
    if (processing) {
      requestAnimationFrame(process);
      return;
    }
    processing = true;

    // set proc size dynamic
    procWidth = parseInt(procSizeSelect.value, 10);
    procHeight = Math.round(procWidth * streamHeight / streamWidth);
    if (src.cols !== procWidth || src.rows !== procHeight) {
      src.delete();
      src = new cv.Mat(procHeight, procWidth, cv.CV_8UC4);
    }

    // capture frame to src (resized)
    cap.read(src); // reads current frame scaled to mat size

    // convert to gray
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // blur
    const ksize = new cv.Size(9,9);
    cv.GaussianBlur(gray, blurred, ksize, 2, 2, cv.BORDER_DEFAULT);

    // Canny for edges (param1 acts as high threshold)
    const cannyThresh1 = 50;
    const cannyThresh2 = 150;
    cv.Canny(blurred, canny, cannyThresh1, cannyThresh2);

    // HoughCircles
    circles.delete();
    circles = new cv.Mat();
    // dp: inverse ratio, minDist: min distance between centers
    const dp = 1.2;
    const minDist = Math.round(procHeight / 6);
    const param1 = 100; // higher Canny threshold for Hough
    const param2 = 30;  // accumulator threshold (smaller detects more circles)
    const minRadius = Math.round(Math.min(procWidth, procHeight) * 0.04);
    const maxRadius = Math.round(Math.min(procWidth, procHeight) * 0.35);

    try {
      cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT, dp, minDist, param1, param2, minRadius, maxRadius);
    } catch (e) {
      // Hough can throw if parameters invalid; ignore
      circles = new cv.Mat();
    }

    // If circles found, evaluate scores
    let best = null; // {cx,cy,r,score,edgeScore,colorScore}
    if (circles && circles.cols > 0) {
      // Prepare full-size mapping: circles are in proc-size coordinates, map to overlay pixel coords
      for (let i = 0; i < circles.cols; ++i) {
        const x = circles.data32F[i*3];
        const y = circles.data32F[i*3 + 1];
        const radius = circles.data32F[i*3 + 2];

        // Edge score: sample N points along circumference on the canny image
        const samples = 64;
        let edgeSum = 0;
        for (let s = 0; s < samples; ++s) {
          const theta = (s / samples) * 2 * Math.PI;
          const sx = Math.round(x + radius * Math.cos(theta));
          const sy = Math.round(y + radius * Math.sin(theta));
          if (sx >= 0 && sx < canny.cols && sy >= 0 && sy < canny.rows) {
            const val = canny.ucharPtr(sy, sx)[0]; // 0 or 255
            edgeSum += val / 255.0;
          }
        }
        const edgeScore = edgeSum / samples; // 0..1

        // Color score: count orange pixels inside circle in HSV
        // Convert src to HSV once per frame; do here lazily
        cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
        cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

        // Prepare mask for the circle (single-channel uchar mat)
        maskCircle.delete();
        maskCircle = new cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC1);
        cv.circle(maskCircle, new cv.Point(Math.round(x), Math.round(y)), Math.round(radius), new cv.Scalar(255), -1);

        // threshold for orange
        const lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), hsvLower);
        const upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), hsvUpper);

        cv.inRange(hsv, lower, upper, maskOrange);

        // maskOrange now contains orange pixels; apply circle mask
        cv.bitwise_and(maskOrange, maskCircle, maskOrange);

        const orangeCount = cv.countNonZero(maskOrange);
        const circleArea = Math.PI * radius * radius;
        const colorScore = Math.min(1, orangeCount / Math.max(1, circleArea)); // normalized 0..1 (approx)

        lower.delete(); upper.delete();

        // Scoring decision: mode
        const mode = modeSelect.value; // 'auto','edge','color'
        let finalScore = 0;
        if (mode === 'edge') finalScore = edgeScore;
        else if (mode === 'color') finalScore = colorScore;
        else {
          // auto: prefer color if above threshold, else edge. If both present, combine.
          if (colorScore > 0.08) {
            // combine with weights (favor color slightly)
            finalScore = colorScore * 0.7 + edgeScore * 0.3;
          } else {
            finalScore = edgeScore;
          }
        }

        if (!best || finalScore > best.score) {
          best = {
            cx: x,
            cy: y,
            r: radius,
            score: finalScore,
            edgeScore,
            colorScore
          };
        }
      }
    }

    // Draw overlay (map coordinates from proc-size to overlay (video) size)
    overlayCtx.clearRect(0,0,overlay.width,overlay.height);
    if (best) {
      const scaleX = overlay.width / src.cols;
      const scaleY = overlay.height / src.rows;
      const cx = best.cx * scaleX;
      const cy = best.cy * scaleY;
      const r = best.r * Math.max(scaleX, scaleY);
      drawResult(overlayCtx, cx, cy, r);

      // Optionally show debug info
      logStatus(`Kreis gefunden — score:${best.score.toFixed(2)} edge:${best.edgeScore.toFixed(2)} color:${best.colorScore.toFixed(2)} fps:${Math.round(fps)}`);
    } else {
      logStatus(`Kein Kreis — fps:${Math.round(fps)}`);
    }

    // FPS calc
    const now = performance.now();
    fps = 1000 / (now - lastTime);
    lastTime = now;

    processing = false;
    requestAnimationFrame(process);
  }

  requestAnimationFrame(process);

  // calibrate button: sample current frame region to set hsvLower/hsvUpper
  calibrateBtn.addEventListener('click', () => {
    // capture center region of current video frame (proc size)
    const sx = Math.max(0, Math.floor(src.cols/2 - src.cols*0.08));
    const sy = Math.max(0, Math.floor(src.rows/2 - src.rows*0.08));
    const w = Math.min(src.cols - sx, Math.floor(src.cols*0.16));
    const h = Math.min(src.rows - sy, Math.floor(src.rows*0.16));
    const sample = src.roi(new cv.Rect(sx, sy, w, h));
    const sampleHSV = new cv.Mat();
    cv.cvtColor(sample, sampleHSV, cv.COLOR_RGBA2RGB);
    cv.cvtColor(sampleHSV, sampleHSV, cv.COLOR_RGB2HSV);

    // compute min/max per channel
    const channels = new cv.MatVector();
    cv.split(sampleHSV, channels);
    const hCh = channels.get(0);
    const sCh = channels.get(1);
    const vCh = channels.get(2);
    const minMaxH = cv.minMaxLoc(hCh);
    const minMaxS = cv.minMaxLoc(sCh);
    const minMaxV = cv.minMaxLoc(vCh);
    // set small margins
    const marginH = 8;
    const marginS = 30;
    const marginV = 30;
    hsvLower = [
      Math.max(0, minMaxH.minVal - marginH),
      Math.max(50, minMaxS.minVal - marginS),
      Math.max(50, minMaxV.minVal - marginV)
    ];
    hsvUpper = [
      Math.min(179, minMaxH.maxVal + marginH),
      Math.min(255, minMaxS.maxVal + marginS),
      Math.min(255, minMaxV.maxVal + marginV)
    ];

    // cleanup
    sample.delete(); sampleHSV.delete(); channels.delete();
    hCh.delete(); sCh.delete(); vCh.delete();
    logStatus(`HSV kalibriert: [${hsvLower.map(v=>Math.round(v)).join(',')}] - [${hsvUpper.map(v=>Math.round(v)).join(',')}]`);
  });

  // Update processing size on change
  procSizeSelect.addEventListener('change', () => {
    adjustCanvasSizes();
  });
}

// handle page visibility: stop processing if not visible to save CPU (optional)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    logStatus('Seite nicht sichtbar — Energie sparen');
  } else {
    logStatus(cvReady ? 'OpenCV geladen' : 'Warte auf OpenCV');
  }
});
