(() => {
  const uploadSection = document.getElementById('upload-section');
  const editorSection = document.getElementById('editor-section');
  const photoInput = document.getElementById('photoInput');
  const canvas = document.getElementById('photoCanvas');
  const ctx = canvas.getContext('2d');
  const statusLine = document.getElementById('statusLine');
  const thresholdSlider = document.getElementById('thresholdSlider');
  const radiusSlider = document.getElementById('radiusSlider');
  const sampleControls = document.getElementById('sample-controls');
  const editControls = document.getElementById('edit-controls');
  const deleteHoldBtn = document.getElementById('deleteHoldBtn');

  let photoImg = null;
  let holds = [];
  let active = new Set();
  let mode = 'sample';
  let selectedId = null;
  let dragId = null;

  function setStatus(msg) {
    statusLine.textContent = msg;
  }

  // ---- color math ----------------------------------------------------
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : (d / max) * 100;
    const v = max * 100;
    return { h, s, v };
  }

  function colorDistance(a, b) {
    const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)) / 360 * 100;
    const ds = Math.abs(a.s - b.s);
    const dv = Math.abs(a.v - b.v);
    return dh * 1.5 + ds * 0.7 + dv * 0.4;
  }

  // ---- blob detection --------------------------------------------------
  function detectHoldsAt(px, py) {
    const w = canvas.width, h = canvas.height;
    const img = ctx.getImageData(0, 0, w, h).data;
    const idx = (x, y) => (y * w + x) * 4;

    const sampleIdx = idx(px, py);
    const target = rgbToHsv(img[sampleIdx], img[sampleIdx + 1], img[sampleIdx + 2]);
    const threshold = parseFloat(thresholdSlider.value);

    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = idx(x, y);
        const c = rgbToHsv(img[i], img[i + 1], img[i + 2]);
        if (colorDistance(target, c) <= threshold) mask[y * w + x] = 1;
      }
    }

    const visited = new Uint8Array(w * h);
    const minArea = Math.max(20, w * h * 0.00015);
    const maxArea = w * h * 0.06;
    const blobs = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!mask[p] || visited[p]) continue;
        // BFS flood fill
        const stack = [p];
        visited[p] = 1;
        let sumX = 0, sumY = 0, count = 0;
        while (stack.length) {
          const cur = stack.pop();
          const cx = cur % w, cy = (cur / w) | 0;
          sumX += cx; sumY += cy; count++;
          const neighbors = [
            [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
          ];
          for (const [nx, ny] of neighbors) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const np = ny * w + nx;
            if (mask[np] && !visited[np]) {
              visited[np] = 1;
              stack.push(np);
            }
          }
        }
        if (count >= minArea && count <= maxArea) {
          blobs.push({ x: sumX / count, y: sumY / count, r: Math.sqrt(count / Math.PI) });
        }
      }
    }

    // Skip blobs that overlap an existing marker (any color) to avoid duplicates.
    const fresh = blobs.filter((b) =>
      !holds.some((h2) => Math.hypot(h2.x - b.x, h2.y - b.y) < (h2.r + b.r) * 0.8)
    );

    const hex = `#${img[sampleIdx].toString(16).padStart(2, '0')}${img[sampleIdx + 1]
      .toString(16)
      .padStart(2, '0')}${img[sampleIdx + 2].toString(16).padStart(2, '0')}`;

    for (const b of fresh) {
      holds.push({ id: makeId(), x: b.x, y: b.y, r: Math.max(8, Math.min(40, b.r)), color: hex });
    }
    setStatus(fresh.length ? `Detected ${fresh.length} new hold(s).` : 'No new holds found — try adjusting sensitivity.');
    saveHolds();
    render();
  }

  function makeId() {
    return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // ---- persistence ----------------------------------------------------
  async function saveHolds() {
    await fetch('/api/holds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holds }),
    });
  }

  async function saveActive() {
    await fetch('/api/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: [...active] }),
    });
  }

  // ---- rendering --------------------------------------------------------
  function render() {
    if (!photoImg) return;
    ctx.drawImage(photoImg, 0, 0, canvas.width, canvas.height);
    for (const hd of holds) {
      const isActive = active.has(hd.id);
      const isSelected = mode === 'edit' && hd.id === selectedId;
      ctx.beginPath();
      ctx.arc(hd.x, hd.y, hd.r, 0, Math.PI * 2);
      if (mode === 'route' && isActive) {
        ctx.fillStyle = 'rgba(60, 220, 100, 0.45)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
      } else {
        ctx.strokeStyle = isSelected ? '#ff4040' : 'rgba(255,255,0,0.85)';
        ctx.lineWidth = isSelected ? 3 : 2;
        if (isSelected) ctx.setLineDash([6, 4]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ---- coordinate helpers ------------------------------------------------
  function eventToPhotoCoords(evt) {
    const rect = canvas.getBoundingClientRect();
    const point = evt.touches ? evt.touches[0] : evt;
    const x = ((point.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((point.clientY - rect.top) / rect.height) * canvas.height;
    return [x, y];
  }

  function findHoldAt(x, y) {
    for (let i = holds.length - 1; i >= 0; i--) {
      const hd = holds[i];
      if (Math.hypot(hd.x - x, hd.y - y) <= hd.r + 4) return hd;
    }
    return null;
  }

  // ---- interaction --------------------------------------------------------
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.mode;
      sampleControls.hidden = mode !== 'sample';
      editControls.hidden = mode !== 'edit';
      selectedId = null;
      render();
    });
  });

  deleteHoldBtn.addEventListener('click', () => {
    if (!selectedId) return;
    holds = holds.filter((h) => h.id !== selectedId);
    active.delete(selectedId);
    selectedId = null;
    saveHolds();
    saveActive();
    render();
  });

  radiusSlider.addEventListener('input', () => {
    const hd = holds.find((h) => h.id === selectedId);
    if (!hd) return;
    hd.r = parseFloat(radiusSlider.value);
    render();
  });
  radiusSlider.addEventListener('change', saveHolds);

  function pointerDown(evt) {
    evt.preventDefault();
    const [x, y] = eventToPhotoCoords(evt);

    if (mode === 'sample') {
      detectHoldsAt(Math.round(x), Math.round(y));
    } else if (mode === 'add') {
      holds.push({ id: makeId(), x, y, r: parseFloat(radiusSlider.value) || 18, color: '#888888' });
      saveHolds();
      render();
    } else if (mode === 'edit') {
      const hit = findHoldAt(x, y);
      selectedId = hit ? hit.id : null;
      if (hit) {
        radiusSlider.value = hit.r;
        dragId = hit.id;
      }
      render();
    } else if (mode === 'route') {
      const hit = findHoldAt(x, y);
      if (hit) {
        if (active.has(hit.id)) active.delete(hit.id);
        else active.add(hit.id);
        saveActive();
        setStatus(`${active.size} hold(s) active in route.`);
        render();
      }
    }
  }

  function pointerMove(evt) {
    if (mode !== 'edit' || !dragId) return;
    evt.preventDefault();
    const [x, y] = eventToPhotoCoords(evt);
    const hd = holds.find((h) => h.id === dragId);
    if (hd) {
      hd.x = x;
      hd.y = y;
      render();
    }
  }

  function pointerUp() {
    if (dragId) saveHolds();
    dragId = null;
  }

  canvas.addEventListener('mousedown', pointerDown);
  canvas.addEventListener('mousemove', pointerMove);
  window.addEventListener('mouseup', pointerUp);
  canvas.addEventListener('touchstart', pointerDown, { passive: false });
  canvas.addEventListener('touchmove', pointerMove, { passive: false });
  window.addEventListener('touchend', pointerUp);

  // ---- photo upload -------------------------------------------------------
  photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = async () => {
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      off.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = off.toDataURL('image/jpeg', 0.85);
      setStatus('Uploading photo…');
      const res = await fetch('/api/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, width: w, height: h }),
      });
      const state = await res.json();
      applyState(state);
      setStatus('Photo saved. Tap a hold to detect its color.');
    };
    img.src = URL.createObjectURL(file);
  });

  // ---- state loading ----------------------------------------------------
  function loadPhoto() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = `/photo.jpg?t=${Date.now()}`;
    });
  }

  async function applyState(state) {
    holds = state.holds || [];
    active = new Set(state.active || []);
    if (state.photo) {
      uploadSection.hidden = false;
      editorSection.hidden = false;
      canvas.width = state.photo.width;
      canvas.height = state.photo.height;
      photoImg = await loadPhoto();
      render();
    } else {
      editorSection.hidden = true;
    }
  }

  async function init() {
    const res = await fetch('/api/state');
    const state = await res.json();
    await applyState(state);
  }

  init();
})();
