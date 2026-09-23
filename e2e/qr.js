// Reads back a QR code drawn with half blocks by `remotty pair`, the way a
// camera sees it on a dark terminal. Independent of the Go encoder (jsQR).
import jsQR from 'jsqr';

export function readTerminalQR(output) {
  const rows = output.split('\n').filter((l) => l.startsWith('██'));
  if (rows.length === 0) return null;
  const cell = 6;
  const width = [...rows[0]].length * cell;
  const height = rows.length * cell * 2;
  const px = new Uint8ClampedArray(width * height * 4);
  const paint = (x0, y0, v) => {
    for (let y = y0; y < y0 + cell; y++) {
      for (let x = x0; x < x0 + cell; x++) {
        const i = (y * width + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = v;
        px[i + 3] = 255;
      }
    }
  };
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    paint(x * cell, y * 2 * cell, ch === '█' || ch === '▀' ? 230 : 20);
    paint(x * cell, (y * 2 + 1) * cell, ch === '█' || ch === '▄' ? 230 : 20);
  }));
  return jsQR(px, width, height)?.data ?? null;
}
