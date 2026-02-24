const video   = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx     = overlay.getContext("2d");
const status  = document.getElementById("status");
const posX    = document.getElementById("posX");
const posY    = document.getElementById("posY");

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    video.srcObject = stream;
    status.textContent = "Kamera läuft – suche Basketball…";
  } catch (err) {
    status.textContent = "Fehler: " + err.message;
    console.error(err);
  }
}

video.addEventListener("playing", function () {
  overlay.width  = video.videoWidth;
  overlay.height = video.videoHeight;
  requestAnimationFrame(loop);
});

function loop() {
  const W = overlay.width;
  const H = overlay.height;

  const tmp    = document.createElement("canvas");
  tmp.width    = W;
  tmp.height   = H;
  const tmpCtx = tmp.getContext("2d");
  tmpCtx.drawImage(video, 0, 0, W, H);

  const imageData = tmpCtx.getImageData(0, 0, W, H);
  const data      = imageData.data;

  let minX = W, minY = H, maxX = 0, maxY = 0, count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (r > 150 && g > 60 && g < 180 && b < 80 && r > g + 30 && r > b + 70) {
      const idx = i / 4;
      const px  = idx % W;
      const py  = Math.floor(idx / W);

      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      count++;
    }
  }

  ctx.clearRect(0, 0, W, H);

  if (count > 300) {
    const bx = minX - 10;
    const by = minY - 10;
    const bw = (maxX - minX) + 20;
    const bh = (maxY - minY) + 20;

    ctx.strokeStyle = "#22ff7a";
    ctx.lineWidth   = 3;
    ctx.shadowColor = "#22ff7a";
    ctx.shadowBlur  = 15;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.shadowBlur  = 0;
    ctx.fillStyle   = "rgba(0,0,0,0.6)";
    ctx.fillRect(bx, by - 22, 110, 20);
    ctx.fillStyle   = "#22ff7a";
    ctx.font        = "bold 12px monospace";
    ctx.fillText("🏀 BASKETBALL", bx + 4, by - 6);

    status.textContent = "Basketball erkannt!";
    posX.textContent   = Math.round(bx + bw / 2) + "px";
    posY.textContent   = Math.round(by + bh / 2) + "px";
  } else {
    status.textContent = "Kein Basketball gefunden";
    posX.textContent   = "–";
    posY.textContent   = "–";
  }

  requestAnimationFrame(loop);
}

startCamera();
