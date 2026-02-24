// script.js — Combined color+geometry detection + smoothing tracking (no ML)
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
toggleDrawBtn.addEventListener('click', ()=>{ drawEnabled = !drawEnabled; toggleDrawBtn.textContent = `Zeichnen: ${drawEnabled? 'Ein':'Aus'}`; });

function log(s){
  const t = new Date().toLocaleTimeString();
  const d = document.createElement('div');
  d.textContent = `[${t}] ${s}`;
  logEl.prepend(d);
  while (logEl.children.length > 80) logEl.removeChild(logEl.lastChild);
}

function setStatus(s){ statusEl.textContent = s; log(s); }

// Camera
async function startCamera(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment", width:{ideal:1280}, height:{ideal:720} }, audio:false });
    video.srcObject = stream;
    video.onloadedmetadata = ()=>{ resizeOverlay(); setStatus('Kamera bereit'); };
  } catch(e){
    setStatus('Kamera Fehler: ' + e.message);
  }
}
function resizeOverlay(){
  const r = video.getBoundingClientRect();
  overlay.style.width = r.width + 'px';
  overlay.style.height = r.height + 'px';
  overlay.width = Math.max(1, Math.round(r.width));
  overlay.height = Math.max(1, Math.round(r.height));
}

// map proc coords to overlay (element-local coordinates). Takes into account object-fit:contain letterbox
function mapProcToOverlay(xProc,yProc,rProc,procW,procH){
  const rect = video.getBoundingClientRect();
  const elemW = rect.width, elemH = rect.height;
  const vidW = video.videoWidth || procW, vidH = video.videoHeight || procH;
  const scale = Math.min(elemW/vidW, elemH/vidH);
  const dispW = vidW*scale, dispH = vidH*scale;
  const offsetX = (elemW - dispW)/2, offsetY = (elemH - dispH)/2;
  const cx = offsetX + (xProc/procW)*dispW;
  const cy = offsetY + (yProc/procH)*dispH;
  const r = rProc * (dispW / procW);
  return {cx,cy,r};
}

// Kalman-like smoothing (simple exponential smoothing + velocity)
let track = {x:0,y:0,r:0,vx:0,vy:0,has:false, lastTs: null};
function updateTrack(detected, alpha, dt){
  if (!detected){
    // predict: apply velocity with damping
    if (!track.has) return null;
    const damp = 0.92;
    track.vx *= damp; track.vy *= damp;
    track.x += track.vx * dt;
    track.y += track.vy * dt;
    track.r *= 0.995;
    return {x:track.x, y:track.y, r:track.r};
  }
  const dx = detected.x - (track.has ? track.x : detected.x);
  const dy = detected.y - (track.has ? track.y : detected.y);
  // update velocity estimate
  if (!track.has){
    track.vx = 0; track.vy = 0;
    track.x = detected.x; track.y = detected.y; track.r = detected.r;
    track.has = true;
  } else {
    // simple velocity from delta / dt
    const newVx = dx / Math.max(1e-3, dt);
    const newVy = dy / Math.max(1e-3, dt);
    // blend velocities
    track.vx = 0.6*track.vx + 0.4*newVx;
    track.vy = 0.6*track.vy + 0.4*newVy;
    // exponential smoothing for position+radius
    track.x = alpha*detected.x + (1-alpha)*(track.x + track.vx*dt);
    track.y = alpha*detected.y + (1-alpha)*(track.y + track.vy*dt);
    track.r = alpha*detected.r + (1-alpha)*track.r;
  }
  return {x:track.x,y:track.y,r:track.r};
}

// OpenCV readiness
function onOpenCvReady(){
  setStatus('OpenCV geladen — starte Kamera');
  startCamera();
  setTimeout(mainLoop, 250);
}
if (typeof cv !== 'undefined'){
  if (cv.getBuildInformation) onOpenCvReady();
  else cv['onRuntimeInitialized'] = onOpenCvReady;
} else {
  const poll = setInterval(()=>{ if (typeof cv !== 'undefined' && cv.getBuildInformation){ clearInterval(poll); onOpenCvReady(); } }, 200);
}

// Calibration: sample small center area to set HSV
calibBtn.addEventListener('click', ()=>{
  // draw current video to small canvas and read pixels
  const tmp = document.createElement('canvas');
  const W = 160, H = Math.round(160 * (video.videoHeight / video.videoWidth || 9/16));
  tmp.width = W; tmp.height = H;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(video, (video.videoWidth - video.videoWidth)/2, (video.videoHeight - video.video.videoHeight)/2, video.videoWidth, video.videoHeight, 0,0,W,H);
  // we will use OpenCV to compute min/max HSV
  try {
    const src = cv.imread(tmp);
    const hsv = new cv.Mat();
    cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
    const chs = new cv.MatVector();
    cv.split(hsv, chs);
    const h = chs.get(0), s = chs.get(1), v = chs.get(2);
    const minMaxH = cv.minMaxLoc(h), minMaxS = cv.minMaxLoc(s), minMaxV = cv.minMaxLoc(v);
    let marginH = 10, marginS = 40, marginV = 40;
    hLowerEl.value = Math.max(0, Math.round(minMaxH.minVal - marginH));
    hUpperEl.value = Math.min(179, Math.round(minMaxH.maxVal + marginH));
    sLowerEl.value = Math.max(0, Math.round(minMaxS.minVal - marginS));
    sUpperEl.value = Math.min(255, Math.round(minMaxS.maxVal + marginS));
    vLowerEl.value = Math.max(0, Math.round(minMaxV.minVal - marginV));
    vUpperEl.value = Math.min(255, Math.round(minMaxV.maxVal + marginV));
    src.delete(); hsv.delete(); chs.delete(); h.delete(); s.delete(); v.delete();
    log('HSV kalibriert (Mitte)');
  } catch(e){
    log('Kalibrierung fehlgeschlagen: ' + e.message);
  }
});

// Main loop
function mainLoop(){
  resizeOverlay();
  const overlayCtx = overlay.getContext('2d');
  overlayCtx.clearRect(0,0,overlay.width,overlay.height);

  // processing canvas
  let procW = parseInt(procSizeSelect.value,10);
  let procH = Math.round(procW * (video.videoHeight / video.videoWidth || 9/16));
  const pcanvas = document.createElement('canvas');
  pcanvas.width = procW; pcanvas.height = procH;
  const pctx = pcanvas.getContext('2d');

  // allocate mats once and reuse
  let src = new cv.Mat(procH, procW, cv.CV_8UC4);
  let hsv = new cv.Mat();
  let mask = new cv.Mat();
  let kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5,5));
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();

  let lastTs = performance.now();

  function processFrame(){
    if (video.readyState < 2){
      requestAnimationFrame(processFrame);
      return;
    }
    // draw image into proc canvas (stable even when object-fit is used)
    pctx.drawImage(video, 0, 0, procW, procH);

    // read into OpenCV
    try {
      src.delete(); // safe delete then recreate
    } catch(e){}
    src = cv.imread(pcanvas);

    // HSV thresholding for orange
    cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
    const lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [parseInt(hLowerEl.value), parseInt(sLowerEl.value), parseInt(vLowerEl.value)]);
    const upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [parseInt(hUpperEl.value), parseInt(sUpperEl.value), parseInt(vUpperEl.value)]);
    cv.inRange(hsv, lower, upper, mask);

    // Morphology to clean
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);

    // find contours on mask
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // Build candidate list
    let candidates = [];
    for (let i=0;i<contours.size();i++){
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < 200) { cnt.delete(); continue; } // ignore small blobs
      const moments = cv.moments(cnt);
      const cx = moments.m10 / moments.m00;
      const cy = moments.m01 / moments.m00;
      // minEnclosingCircle
      const circle = cv.minEnclosingCircle(cnt);
      const cxC = circle.center.x, cyC = circle.center.y, rC = circle.radius;
      // color score = area of mask inside circle / circle area
      const maskCircle = new cv.Mat.zeros(mask.rows, mask.cols, cv.CV_8UC1);
      cv.circle(maskCircle, new cv.Point(Math.round(cxC), Math.round(cyC)), Math.max(1, Math.round(rC)), new cv.Scalar(255), -1);
      const masked = new cv.Mat();
      cv.bitwise_and(mask, maskCircle, masked);
      const orangePixels = cv.countNonZero(masked);
      const circleArea = Math.PI * rC * rC;
      const colorScore = orangePixels / (circleArea + 1e-6); // ~0..1
      // edge score: Canny on ROI around circle
      const pad = Math.max(4, Math.round(rC*0.2));
      const rx = Math.max(0, Math.round(cxC - rC - pad));
      const ry = Math.max(0, Math.round(cyC - rC - pad));
      const rw = Math.min(mask.cols - rx, Math.round(2*rC + pad*2));
      const rh = Math.min(mask.rows - ry, Math.round(2*rC + pad*2));
      let edgeScore = 0;
      if (rw>10 && rh>10) {
        const roi = src.roi(new cv.Rect(rx, ry, rw, rh));
        const gray = new cv.Mat();
        cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, gray, new cv.Size(7,7), 2,2);
        const edges = new cv.Mat();
        cv.Canny(gray, edges, 60, 140);
        // sample circle perimeter mapped to roi coords
        const samples = 48;
        let sum = 0;
        for (let s=0;s<samples;s++){
          const theta = (s/samples)*2*Math.PI;
          const sx = Math.round((cxC - rx) + rC * Math.cos(theta));
          const sy = Math.round((cyC - ry) + rC * Math.sin(theta));
          if (sx>=0 && sx<edges.cols && sy>=0 && sy<edges.rows){
            sum += edges.ucharPtr(sy,sx)[0] / 255.0;
          }
        }
        edgeScore = sum / samples;
        roi.delete(); gray.delete(); edges.delete();
      }
      candidates.push({cx:cxC, cy:cyC, r:rC, area, colorScore, edgeScore});
      // cleanup
      maskCircle.delete(); masked.delete(); cnt.delete();
    }

    // Choose best candidate by combined score
    let best = null;
    for (const c of candidates){
      // combine: color is primary but require some edge evidence. Weights can be tuned.
      const combined = c.colorScore * 0.7 + c.edgeScore * 0.3;
      // penalize weird aspect (large radius with tiny area)
      if (!best || combined > best.score) best = {...c, score:combined};
    }

    // Hough fallback if no candidates but Hough finds something
    if (!best){
      try {
        const blur = new cv.Mat();
        cv.cvtColor(src, blur, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(blur, blur, new cv.Size(9,9),2,2);
        const circles = new cv.Mat();
        const dp = 1.2;
        const minDist = Math.round(procH/6);
        const param1 = 100;
        const param2 = Math.max(8, parseInt(sensSlider.value,10));
        const minR = Math.round(Math.min(procW,procH)*0.03);
        const maxR = Math.round(Math.min(procW,procH)*0.45);
        cv.HoughCircles(blur, circles, cv.HOUGH_GRADIENT, dp, minDist, param1, param2, minR, maxR);
        if (circles && circles.cols>0){
          // pick strongest by edge sampling
          for (let i=0;i<circles.cols;i++){
            const x = circles.data32F[i*3], y = circles.data32F[i*3+1], r = circles.data32F[i*3+2];
            // edge score sample from Canny
            const g = new cv.Mat();
            cv.Canny(blur, g, 60, 140);
            let sum=0, samples=48;
            for (let s=0;s<samples;s++){
              const t = (s/samples)*2*Math.PI;
              const sx = Math.round(x + r*Math.cos(t)), sy = Math.round(y + r*Math.sin(t));
              if (sx>=0 && sx<g.cols && sy>=0 && sy<g.rows) sum += g.ucharPtr(sy,sx)[0]/255.0;
            }
            const edgeScore = sum / samples;
            if (!best || edgeScore > best.edgeScore) best = {cx:x,cy:y,r:r,edgeScore,score:edgeScore};
            g.delete();
          }
        }
        blur.delete(); circles.delete();
      } catch(e){
        // ignore
      }
    }

    // smoothing & draw
    const now = performance.now();
    const dt = Math.max(0.001, (now - (track.lastTs || now))/1000.0);
    track.lastTs = now;
    const alpha = parseInt(alphaEl.value,10)/100.0;

    let detected = null;
    if (best && (best.score > 0.08 || best.edgeScore > 0.12)) {
      detected = {x: best.cx, y: best.cy, r: Math.max(4, best.r)};
      log(`Detected cand score=${(best.score||best.edgeScore).toFixed(2)} color=${(best.colorScore||0).toFixed(2)} edge=${(best.edgeScore||0).toFixed(2)}`);
    } else {
      // nothing reliable
    }

    const smooth = updateTrack(detected, alpha, dt);
    overlayCtx.clearRect(0,0,overlay.width,overlay.height);
    if (smooth){
      // map to overlay
      const mapped = mapProcToOverlay(smooth.x, smooth.y, smooth.r, procW, procH);
      if (drawEnabled){
        // draw green circle and bounding box (one only)
        overlayCtx.save();
        overlayCtx.strokeStyle = '#2ecc71';
        overlayCtx.lineWidth = Math.max(2, Math.round(mapped.r*0.06));
        overlayCtx.beginPath();
        overlayCtx.arc(mapped.cx, mapped.cy, mapped.r, 0, Math.PI*2);
        overlayCtx.stroke();
        overlayCtx.lineWidth = 2;
        overlayCtx.strokeRect(mapped.cx - mapped.r, mapped.cy - mapped.r, mapped.r*2, mapped.r*2);
        overlayCtx.restore();
      }
    } else {
      // nothing to draw
    }

    // cleanup
    // free mats that remain
    // (we reuse src,hsv,mask,kernel,contours,hierarchy across frames)
    // schedule next
    requestAnimationFrame(processFrame);
  }

  requestAnimationFrame(processFrame);
  window.addEventListener('resize', resizeOverlay);
}

// start
// small delay to ensure UI has mounted
setTimeout(()=>{ if (typeof cv !== 'undefined' && cv.getBuildInformation) onOpenCvReady(); }, 200);
