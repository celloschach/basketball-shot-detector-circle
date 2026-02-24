// script.js — nur Kreis-Erkennung, kein Zeichnen
const video = document.getElementById('video');
const overlay = document.getElementById('overlay'); // wird nicht gezeichnet, aber für Größenabgleich genutzt
const statusEl = document.getElementById('status');
const detEl = document.getElementById('det');

let cvReady = false;
let streaming = false;

function logStatus(s){ statusEl.textContent = s; }
function logDet(s){ detEl.textContent = s; console.log(s); }

// Kamera starten
async function startCamera(){
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
    video.onloadedmetadata = () => {
      streaming = true;
      // set overlay initial size to match visible video box
      resizeOverlayToVideo();
    };
  } catch (err) {
    logStatus('Kamera Fehler: ' + err.message);
  }
}

// overlay-Größe an sichtbare Videoanzeige anpassen (wichtig, damit Mapping stimmt)
function resizeOverlayToVideo(){
  // sichtbare Video-Größe im Layout (box, nicht video.videoWidth)
  const rect = video.getBoundingClientRect();
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
  overlay.width = Math.max(1, Math.round(rect.width));
  overlay.height = Math.max(1, Math.round(rect.height));
}

// OpenCV ready
function onOpenCvReady(){
  cvReady = true;
  logStatus('OpenCV geladen — starte Kamera');
  startCamera().then(()=> {
    setTimeout(startProcessing, 200); // kurz warten bis Video sichtbar
  });
}

if (typeof cv !== 'undefined') {
  if (cv.getBuildInformation) onOpenCvReady();
  else cv['onRuntimeInitialized'] = onOpenCvReady;
} else {
  const poll = setInterval(()=>{
    if (typeof cv !== 'undefined' && cv.getBuildInformation) {
      clearInterval(poll);
      onOpenCvReady();
    }
  }, 200);
}

// Hauptloop: HoughCircles, aber KEINE Zeichnung, nur Statusausgabe
function startProcessing(){
  if (!streaming || !cvReady) {
    setTimeout(startProcessing, 200);
    return;
  }
  resizeOverlayToVideo();

  // Verarbeitung auf kleinerer Auflösung fürs Tempo
  const procWidth = 480;
  const procHeight = Math.round(procWidth * (video.videoHeight / video.videoWidth));

  let cap = new cv.VideoCapture(video);
  let src = new cv.Mat(procHeight, procWidth, cv.CV_8UC4);
  let gray = new cv.Mat();
  let blur = new cv.Mat();
  let canny = new cv.Mat();
  let circles = new cv.Mat();

  let lastTime = performance.now();
  let fps = 0;

  function processFrame(){
    // Read frame scaled to src size
    try {
      cap.read(src);
    } catch (e) {
      // falls read fehlschlägt, nächster Frame
      requestAnimationFrame(processFrame);
      return;
    }

    // gray -> blur -> canny
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(9,9), 2, 2, cv.BORDER_DEFAULT);
    cv.Canny(blur, canny, 50, 150);

    // HoughCircles auf blurred (klassisch)
    circles.delete(); circles = new cv.Mat();
    const dp = 1.2;
    const minDist = Math.round(procHeight / 6);
    const param1 = 100;
    const param2 = 28; // niedriger erlaubt mehr Kandidaten
    const minRadius = Math.round(Math.min(procWidth, procHeight) * 0.03);
    const maxRadius = Math.round(Math.min(procWidth, procHeight) * 0.45);

    try {
      cv.HoughCircles(blur, circles, cv.HOUGH_GRADIENT, dp, minDist, param1, param2, minRadius, maxRadius);
    } catch (err) {
      // falls Hough Exceptions wirft, einfach weiter
      console.warn('HoughFehler', err);
    }

    let best = null;
    if (circles && circles.cols > 0) {
      for (let i=0;i<circles.cols;i++){
        const x = circles.data32F[i*3 + 0];
        const y = circles.data32F[i*3 + 1];
        const r = circles.data32F[i*3 + 2];

        // Edge score: Mittelwert der Canny-Werte entlang Umfang (samples)
        const samples = 48;
        let sum=0;
        for (let s=0;s<samples;s++){
          const theta = (s/samples)*2*Math.PI;
          const sx = Math.round(x + r*Math.cos(theta));
          const sy = Math.round(y + r*Math.sin(theta));
          if (sx>=0 && sx<canny.cols && sy>=0 && sy<canny.rows){
            sum += canny.ucharPtr(sy,sx)[0] / 255.0;
          }
        }
        const edgeScore = sum / samples;

        if (!best || edgeScore > best.edgeScore) {
          best = { x, y, r, edgeScore };
        }
      }
    }

    // Map best-Kreis von proc-Coords in sichtbare Video-Box-Koordinaten
    if (best) {
      // sichtbare Video-Rect
      const rect = video.getBoundingClientRect();
      const scaleX = rect.width / procWidth;
      const scaleY = rect.height / procHeight;
      const cxVis = best.x * scaleX + rect.left;
      const cyVis = best.y * scaleY + rect.top;
      const rVis = best.r * Math.max(scaleX, scaleY);

      // Ausgabe nur als Text und Konsole (keine Zeichnung)
      const out = `Kreis erkannt — score:${best.edgeScore.toFixed(2)}; proc(x,y,r)=(${Math.round(best.x)},${Math.round(best.y)},${Math.round(best.r)}) → sichtbar ~ (${Math.round(cxVis)},${Math.round(cyVis)}, r≈${Math.round(rVis)})`;
      logDet(out);
    } else {
      logDet('Kein Kreis erkannt');
    }

    // FPS
    const now = performance.now();
    fps = 1000 / (now - lastTime);
    lastTime = now;
    logStatus(`FPS: ${Math.round(fps)}`);

    requestAnimationFrame(processFrame);
  }

  requestAnimationFrame(processFrame);

  // Falls Fenstergröße sich ändert, overlay anpassen
  window.addEventListener('resize', resizeOverlayToVideo);
  video.addEventListener('resize', resizeOverlayToVideo);
}
