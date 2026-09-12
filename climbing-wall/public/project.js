(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const controls = document.getElementById('controls');
  const calibrateBtn = document.getElementById('calibrateBtn');
  const saveCalBtn = document.getElementById('saveCalBtn');
  const resetCalBtn = document.getElementById('resetCalBtn');

  let state = { photo: null, holds: [], active: [], calibration: null };
  let photoImg = null;
  let calibrating = false;
  let corners = null; // working copy while calibrating: [TL, TR, BR, BL] in canvas px
  let dragIndex = -1;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    render();
  }
  window.addEventListener('resize', resize);

  function defaultCorners() {
    const mx = canvas.width * 0.1, my = canvas.height * 0.1;
    return [
      [mx, my],
      [canvas.width - mx, my],
      [canvas.width - mx, canvas.height - my],
      [mx, canvas.height - my],
    ];
  }

  function photoCorners() {
    const w = state.photo.width, h = state.photo.height;
    return [[0, 0], [w, 0], [w, h], [0, h]];
  }

  // Draw `img` warped from src rect (photo pixel space) onto dst quad (canvas space)
  // by splitting into two triangles, each mapped with an affine transform. This is an
  // approximation of a true projective warp, accurate enough for visual calibration.
  function drawWarpedImage(img, dstQuad, alpha) {
    const [w, h] = [img.width, img.height];
    const src = [[0, 0], [w, 0], [w, h], [0, h]];
    ctx.save();
    ctx.globalAlpha = alpha;
    drawTriangle(img, [src[0], src[1], src[3]], [dstQuad[0], dstQuad[1], dstQuad[3]]);
    drawTriangle(img, [src[1], src[2], src[3]], [dstQuad[1], dstQuad[2], dstQuad[3]]);
    ctx.restore();
  }

  function drawTriangle(img, srcTri, dstTri) {
    const [[u0, v0], [u1, v1], [u2, v2]] = srcTri;
    const [[x0, y0], [x1, y1], [x2, y2]] = dstTri;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.clip();

    const denom = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
    const a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / denom;
    const b = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / denom;
    const c = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / denom;
    const d = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / denom;
    const e = (x0 * (u1 * v2 - u2 * v1) + x1 * (u2 * v0 - u0 * v2) + x2 * (u0 * v1 - u1 * v0)) / denom;
    const f = (y0 * (u1 * v2 - u2 * v1) + y1 * (u2 * v0 - u0 * v2) + y2 * (u0 * v1 - u1 * v0)) / denom;

    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.restore();
  }

  function render() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!state.photo) {
      drawMessage('Upload a wall photo from the control page first.');
      return;
    }

    if (calibrating) {
      if (photoImg) drawWarpedImage(photoImg, corners, 0.55);
      drawCornerHandles();
      drawMessage('Drag the corners until the photo lines up with the real wall, then Save alignment.');
      return;
    }

    if (!state.calibration) {
      drawMessage('Not calibrated yet — click Calibrate.');
      return;
    }

    const H = Homography.computeHomography(photoCorners(), state.calibration.corners);
    for (const hd of state.holds) {
      if (!state.active.includes(hd.id)) continue;
      const [cx, cy] = Homography.applyHomography(H, [hd.x, hd.y]);
      const [ex] = Homography.applyHomography(H, [hd.x + hd.r, hd.y]);
      const [, ey2] = Homography.applyHomography(H, [hd.x, hd.y + hd.r]);
      const r = (Math.abs(ex - cx) + Math.abs(ey2 - cy)) / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(r, 4));
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.6, 'rgba(255,240,150,0.9)');
      grad.addColorStop(1, 'rgba(255,240,150,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(r, 4), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMessage(text) {
    ctx.fillStyle = '#666';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }

  function drawCornerHandles() {
    ctx.strokeStyle = 'rgba(0,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    for (const [x, y] of corners) {
      ctx.fillStyle = '#00ffff';
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function pointToCanvas(evt) {
    const rect = canvas.getBoundingClientRect();
    const p = evt.touches ? evt.touches[0] : evt;
    return [p.clientX - rect.left, p.clientY - rect.top];
  }

  function pointerDown(evt) {
    if (!calibrating) return;
    evt.preventDefault();
    const [x, y] = pointToCanvas(evt);
    dragIndex = corners.findIndex(([cx, cy]) => Math.hypot(cx - x, cy - y) < 24);
  }

  function pointerMove(evt) {
    if (!calibrating || dragIndex < 0) return;
    evt.preventDefault();
    corners[dragIndex] = pointToCanvas(evt);
    render();
  }

  function pointerUp() {
    dragIndex = -1;
  }

  canvas.addEventListener('mousedown', pointerDown);
  canvas.addEventListener('mousemove', pointerMove);
  window.addEventListener('mouseup', pointerUp);
  canvas.addEventListener('touchstart', pointerDown, { passive: false });
  canvas.addEventListener('touchmove', pointerMove, { passive: false });
  window.addEventListener('touchend', pointerUp);

  calibrateBtn.addEventListener('click', () => {
    calibrating = true;
    corners = state.calibration ? state.calibration.corners.map((p) => [...p]) : defaultCorners();
    controls.classList.add('calibrating');
    calibrateBtn.hidden = true;
    saveCalBtn.hidden = false;
    resetCalBtn.hidden = false;
    render();
  });

  resetCalBtn.addEventListener('click', () => {
    corners = defaultCorners();
    render();
  });

  saveCalBtn.addEventListener('click', async () => {
    const res = await fetch('/api/calibration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corners }),
    });
    state = await res.json();
    calibrating = false;
    controls.classList.remove('calibrating');
    calibrateBtn.hidden = false;
    saveCalBtn.hidden = true;
    resetCalBtn.hidden = true;
    render();
  });

  function loadPhoto() {
    if (!state.photo) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = `/photo.jpg?t=${Date.now()}`;
    });
  }

  async function applyState(next) {
    const photoChanged = !state.photo || !next.photo || state.photo.width !== next.photo.width;
    state = next;
    if (photoChanged) photoImg = await loadPhoto();
    render();
  }

  async function init() {
    resize();
    const res = await fetch('/api/state');
    await applyState(await res.json());

    const stream = new EventSource('/api/state/stream');
    stream.onmessage = (evt) => applyState(JSON.parse(evt.data));
  }

  init();
})();
