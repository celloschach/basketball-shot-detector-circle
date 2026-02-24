// script.js
// Direkt einsatzbereit — benutzt OpenCV.js im Browser.
// Hinweise: HSV-Werte ggf. anpassen (je nach Beleuchtung / Ballfarbe).

let video = document.getElementById('video');
let overlay = document.getElementById('overlay');
let ctx = overlay.getContext('2d');

let cap = null;
let running = false;
let prevBox = null; // für Glättung (lerp)

const WIDTH = 640;
const HEIGHT = 480;

// Kamera starten
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: WIDTH, height: HEIGHT, facingMode: "environment" },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    cap = new cv.VideoCapture(video);
    running = true;
    requestAnimationFrame(processFrame);
  } catch (err) {
    console.error('Kamera-Fehler:', err);
  }
}

// Linear interpolation für Glättung
function lerp(a, b, t) { return a + (b - a) * t; }

// Hauptverarbeitung (Frame für Frame)
function processFrame() {
  if (!running) return;

  // Sicherheitscheck
  if (video.readyState < 2) {
    requestAnimationFrame(processFrame);
    return;
  }

  // Mats erzeugen
  let src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
  let hsv = new cv.Mat();
  let mask = new cv.Mat();

  // Capture
  cap.read(src); // liest aktuellen Frame in src

  // RGBA -> RGB -> HSV
  cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
  cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

  // HSV Bereich für orange / basketball (werte anpassen falls nötig)
  // H: 5..25, S: 120..255, V: 90..255  (typische Werte für orange)
  let lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [5, 120, 90, 0]);
  let upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [25, 255, 255, 255]);
  cv.inRange(hsv, lower, upper, mask);

  // Morphologische Operationen zur Rauschreduktion
  let M = cv.Mat.ones(5, 5, cv.CV_8U);
  cv.morphologyEx(mask, mask, cv.MORPH_OPEN, M);
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, M);

  // Konturen finden
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  // größte Kontur suchen
  let maxArea = 0;
  let maxRect = null;
  for (let i = 0; i < contours.size(); ++i) {
    let cnt = contours.get(i);
    let area = cv.contourArea(cnt);
    if (area > maxArea) {
      maxArea = area;
      maxRect = cv.boundingRect(cnt);
    }
    cnt.delete();
  }

  // Zeichnen auf overlay
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (maxRect && maxArea > 500) { // threshold um kleine Störflecken zu ignorieren
    // Glättung: vorherige Box und neue Box mischen
    let target = { x: maxRect.x, y: maxRect.y, w: maxRect.width, h: maxRect.height };
    if (!prevBox) prevBox = target;
    // stärkeres Gewicht auf alten Wert für ruhigere Bewegung
    prevBox.x = lerp(prevBox.x, target.x, 0.35);
    prevBox.y = lerp(prevBox.y, target.y, 0.35);
    prevBox.w = lerp(prevBox.w, target.w, 0.35);
    prevBox.h = lerp(prevBox.h, target.h, 0.35);

    // Rechteck zeichnen (grün)
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#00ff00';
    ctx.beginPath();
    ctx.rect(prevBox.x, prevBox.y, prevBox.w, prevBox.h);
    ctx.stroke();

    // optional: Mittelpunkt + Info
    ctx.fillStyle = '#00ff00';
    ctx.font = '16px sans-serif';
    ctx.fillText('Basketball', prevBox.x, Math.max(16, prevBox.y - 6));
  } else {
    // Kein Ball sichtbar -> prevBox langsam ausblenden
    if (prevBox) {
      prevBox.x = lerp(prevBox.x, prevBox.x + prevBox.w/2, 0.1);
      prevBox.y = lerp(prevBox.y, prevBox.y + prevBox.h/2, 0.1);
      prevBox.w *= 0.95; prevBox.h *= 0.95;
      if (prevBox.w < 4 || prevBox.h < 4) prevBox = null;
    }
  }

  // Aufräumen
  src.delete(); hsv.delete(); mask.delete();
  lower.delete(); upper.delete(); M.delete();
  contours.delete(); hierarchy.delete();

  requestAnimationFrame(processFrame);
}

// Warte bis OpenCV geladen ist
if (typeof cv === 'undefined') {
  // Falls opencv noch nicht geladen ist, registriere onload
  document.addEventListener('opencvready', startCamera);
} else {
  cv['onRuntimeInitialized'] = () => {
    startCamera();
  };
}
