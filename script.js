const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let streamStarted = false;

let trackedBall = null;
let lostFrames = 0;

const MAX_DISTANCE = 120;
const MAX_LOST_FRAMES = 8;

async function startCamera() {

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment",
      width: { ideal: 640 },
      height: { ideal: 480 }
    },
    audio: false
  });

  video.srcObject = stream;

  video.addEventListener("loadedmetadata", () => {
    canvas.width = 640;
    canvas.height = 480;
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
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 1);
  cv.Canny(gray, edges, 50, 150);

  cv.HoughCircles(
    gray,
    circles,
    cv.HOUGH_GRADIENT,
    1,
    80,
    80,
    25,
    20,
    500
  );

  let best = null;
  let bestScore = 0;

  // 🔥 Weniger Kreise → schneller
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

  // Tracking
  if (best && bestScore > 0.35) {

    if (!trackedBall) {
      trackedBall = best;
      lostFrames = 0;
    } else {

      let dx = best.x - trackedBall.x;
      let dy = best.y - trackedBall.y;
      let dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < MAX_DISTANCE) {
        trackedBall = best;
        lostFrames = 0;
      } else {
        lostFrames++;
      }
    }
  } else {
    lostFrames++;
  }

  if (lostFrames > MAX_LOST_FRAMES) {
    trackedBall = null;
  }

  // Zeichnen
  if (trackedBall) {

    ctx.strokeStyle = "lime";
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.arc(trackedBall.x, trackedBall.y, trackedBall.r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeRect(
      trackedBall.x - trackedBall.r,
      trackedBall.y - trackedBall.r,
      trackedBall.r * 2,
      trackedBall.r * 2
    );
  }

  src.delete();
  gray.delete();
  circles.delete();
  edges.delete();

  requestAnimationFrame(detect);
}

// 🔥 Schneller Score
function computeScore(edges, x, y, r) {

  let hits = 0;
  let samples = 60; // reduziert → schneller

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
