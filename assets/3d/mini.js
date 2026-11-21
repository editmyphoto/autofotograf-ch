/* Aus der Sonnenstand-3D-Engine herausgelöst (poster.js: loadImage, sonne.js: toneMap). Nicht hier bearbeiten. */
const imgCache = new Map();
export function loadImage(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise(res => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
  imgCache.set(url, p);
  if (imgCache.size > 1500) imgCache.delete(imgCache.keys().next().value);
  return p;
}

export function toneMap(c2, t) {
  if (!t) return;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let x = v / 255;
    if (x < 0.6) x += t.shadows * (1 - x / 0.6) ** 2;
    if (x > 0.72) x = 0.72 + (x - 0.72) * t.highlights;
    lut[v] = Math.round(x ** t.gamma * 255);
  }
  const W = c2.canvas.width, H = c2.canvas.height, step = 512;
  for (let y0 = 0; y0 < H; y0 += step) {
    const im = c2.getImageData(0, y0, W, Math.min(step, H - y0)), d = im.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    c2.putImageData(im, 0, y0);
  }
}
