import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const iconPath = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png";
const splashPaths = [
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png",
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png",
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png",
];

function png(width, height, paint) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y, width, height);
      const offset = y * stride + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr(width, height)),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  return data;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function crc32(buf) {
  let crc = -1;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function inRoundedRect(x, y, left, top, right, bottom, radius) {
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function iconPaint(x, y, w, h) {
  const t = y / h;
  let r = mix(8, 23, t), g = mix(10, 26, t), b = mix(8, 18, t);
  const cx = w * 0.5, cy = h * 0.42;
  const glow = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / (w * 0.62));
  r = mix(r, 58, glow * 0.35); g = mix(g, 91, glow * 0.45); b = mix(b, 37, glow * 0.28);

  const boardLeft = w * 0.21, boardTop = h * 0.22, cell = w * 0.145;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const left = boardLeft + col * cell;
      const top = boardTop + row * cell;
      if (x >= left && x < left + cell && y >= top && y < top + cell) {
        const light = (row + col) % 2 === 0;
        r = light ? 232 : 109; g = light ? 225 : 139; b = light ? 198 : 86;
      }
    }
  }

  if (inRoundedRect(x, y, w * 0.33, h * 0.62, w * 0.67, h * 0.72, w * 0.035) ||
      inRoundedRect(x, y, w * 0.39, h * 0.48, w * 0.61, h * 0.64, w * 0.05) ||
      (x - cx) ** 2 + (y - h * 0.43) ** 2 < (w * 0.09) ** 2) {
    r = 183; g = 226; b = 107;
  }
  return [r, g, b, 255];
}

function splashPaint(x, y, w, h) {
  const t = y / h;
  let r = mix(8, 16, t), g = mix(9, 18, t), b = mix(7, 13, t);
  const glow = Math.max(0, 1 - Math.hypot(x - w * 0.5, y - h * 0.42) / (w * 0.5));
  r = mix(r, 34, glow * 0.45); g = mix(g, 53, glow * 0.55); b = mix(b, 24, glow * 0.38);
  const mark = iconPaint(
    Math.round((x - w * 0.36) / 0.28),
    Math.round((y - h * 0.28) / 0.28),
    1024,
    1024
  );
  if (x > w * 0.36 && x < w * 0.64 && y > h * 0.28 && y < h * 0.56) {
    r = mark[0]; g = mark[1]; b = mark[2];
  }
  return [r, g, b, 255];
}

await writeFile(iconPath, png(1024, 1024, iconPaint));
for (const path of splashPaths) {
  await writeFile(path, png(2732, 2732, splashPaint));
}
