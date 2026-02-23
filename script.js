const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let streamStarted = false;

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  });

  video.srcObject = stream;

  video.addEventListener("loadedmetadata", () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    streamStarted = true;
    detect();
  });
}

function detect() {
  if (!streamStarted || typeof cv === "undefined") {
    requestAnimationFrame(detect);
    return;
  }

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  let src = cv.imread(canvas);
  let gray = new cv.Mat();
  let circles = new cv.Mat();
  let edges = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(9, 9), 2, 2);
  cv.Canny(gray, edges, 50, 150);

  cv.HoughCircles(
    gray,
    circles,
    cv.HOUGH_GRADIENT,
    1,
    60,
    100,
    35,
    20,
    600
  );

  let best = null;
  let bestScore = 0;

  // -------- Nur bester Kreis wird gewählt --------
  for (let i = 0; i < circles.cols; i++) {

    let x = circles.data32F[i * 3];
    let y = circles.data32F[i * 3 + 1];
    let r = circles.data32F[i * 3 + 2];

    let score = computeScore(edges, x, y, r);

    if (score > bestScore) {
      bestScore = score;
      best = { x, y, r };
    }
  }

  // Nur anzeigen wenn Kreis wirklich stark genug
  if (best && bestScore > 0.35) {

    ctx.strokeStyle = "lime";
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.arc(best.x, best.y, best.r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeRect(
      best.x - best.r,
      best.y - best.r,
      best.r * 2,
      best.r * 2
    );
  }

  src.delete();
  gray.delete();
  circles.delete();
  edges.delete();

  requestAnimationFrame(detect);
}

// --------------------------------------------------
// 🔥 Score = Kantenanteil auf dem Kreisumfang
// --------------------------------------------------
function computeScore(edges, x, y, r) {

  let hits = 0;
  let samples = 240;

  for (let i = 0; i < samples; i++) {

    let angle = (i * 2 * Math.PI) / samples;
    let px = Math.round(x + r * Math.cos(angle));
    let py = Math.round(y + r * Math.sin(angle));

    if (
      px >= 0 &&
      py >= 0 &&
      px < edges.cols &&
      py < edges.rows
    ) {

      if (edges.ucharPtr(py, px)[0] > 0) {
        hits++;
      }
    }
  }

  return hits / samples;
}

startCamera();
