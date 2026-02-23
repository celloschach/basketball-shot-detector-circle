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
    detectCircles();
  });
}

function detectCircles() {
  if (!streamStarted || typeof cv === "undefined") {
    requestAnimationFrame(detectCircles);
    return;
  }

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  let src = cv.imread(canvas);
  let gray = new cv.Mat();
  let circles = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(9, 9), 2, 2);

  cv.HoughCircles(
    gray,
    circles,
    cv.HOUGH_GRADIENT,
    1,
    50,
    100,
    30,
    10,
    300
  );

  if (circles.cols > 0) {
    for (let i = 0; i < circles.cols; i++) {
      let x = circles.data32F[i * 3];
      let y = circles.data32F[i * 3 + 1];
      let r = circles.data32F[i * 3 + 2];

      ctx.strokeStyle = "lime";
      ctx.lineWidth = 4;

      // Kreis
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();

      // Rechteck
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    }
  }

  src.delete();
  gray.delete();
  circles.delete();

  requestAnimationFrame(detectCircles);
}

startCamera();
