// 4-point homography: maps points from one quad to another (projective transform).
// Used to translate hold positions from photo-pixel space into projector-canvas space
// after the user calibrates by dragging the projected photo's corners onto the real wall.
window.Homography = (() => {
  function solve8x8(A, b) {
    // Gaussian elimination with partial pivoting, A is 8x8, b is length 8.
    const n = 8;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
      }
      [M[col], M[pivot]] = [M[pivot], M[col]];
      const pv = M[col][col];
      if (Math.abs(pv) < 1e-12) throw new Error('Degenerate point configuration');
      for (let row = 0; row < n; row++) {
        if (row === col) continue;
        const factor = M[row][col] / pv;
        for (let c = col; c <= n; c++) M[row][c] -= factor * M[col][c];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  // src/dst: arrays of 4 [x, y] points, ordered consistently (e.g. TL, TR, BR, BL).
  // Returns a 3x3 matrix as a flat length-9 array (row-major, h33 = 1).
  function computeHomography(src, dst) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i];
      const [X, Y] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
      b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
      b.push(Y);
    }
    const h = solve8x8(A, b);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  function applyHomography(H, [x, y]) {
    const w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  }

  return { computeHomography, applyHomography };
})();
