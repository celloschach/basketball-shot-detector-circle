const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let streamStarted = false;

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
  let hsv = new cv.Mat();
  let gray = new cv.Mat();
  let circles = new cv.Mat();

  cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
  cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(9, 9), 2, 2);

  // Hough Circles
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
  let bestOrangeCount = 0;

  // HSV Bereich für Orange
  let lower = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [5, 100, 100, 0]);
  let upper = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [20, 255, 255, 255]);
  let mask = new cv.Mat();

  cv.inRange(hsv, lower, upper, mask);

  // Für jeden Kreis prüfen wie viele orange Pixel drin liegen
  for (let i = 0; i < circles.cols; i++) {

    let x = circles.data32F[i * 3];
    let y = circles.data32F[i * 3 + 1];
    let r = circles.data32F[i * 3 + 2];

    let count = countOrangePixels(mask, x, y, r);

    if (count > bestOrangeCount) {
      bestOrangeCount = count;
      best = { x, y, r };
    }
  }

  // Nur besten Kreis zeichnen
  if (best && bestOrangeCount > 50) {

    ctx.strokeStyle = "lime";
    ctx.lineWidth = 5;

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
  hsv.delete();
  gray.delete();
  circles.delete();
  mask.delete();
  lower.delete();
  upper.delete();

  requestAnimationFrame(detect);
}

// 🔥 Zählt wie viele orange Pixel innerhalb des Kreises liegen
function countOrangePixels(mask, x, y, r) {

  let count = 0;
  let samples = 200;

  for (let i = 0; i < samples; i++) {

    let angle = (i * 2 * Math.PI) / samples;
    let px = Math.round(x + r * Math.cos(angle));
    let py = Math.round(y + r * Math.sin(angle));

    if (
      px >= 0 &&
      py >= 0 &&
      px < mask.cols &&
      py < mask.rows
    ) {

      if (mask.ucharPtr(py, px)[0] > 0) {
        count++;
      }
    }
  }

  return count;
}

startCamera();
