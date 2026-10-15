/**
 * make-icons.js — 生成扩展图标 PNG（无需第三方依赖，直接写 PNG 字节）
 *
 * 图形：圆角方块渐变底 + 白色 "FBA" 风格上升箭头 + 货币点
 * 使用 Node 内置 zlib 手写 PNG 编码。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- 绘制 ---
function lerp(a, b, t) { return a + (b - a) * t; }

function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

/** 点到线段的距离，用于画粗线（箭头杆） */
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function render(size) {
  const S = size;
  const px = Buffer.alloc(S * S * 4);
  const ss = 3; // 超采样抗锯齿

  // 主题色
  const gradTop = [47, 138, 245];   // #2f8af5
  const gradBot = [24, 96, 214];    // #1860d6
  const white = [255, 255, 255];

  // 背景圆角矩形参数（留 1px 透明边）
  const pad = Math.max(0.5, S * 0.045);
  const x0 = pad, y0 = pad, x1 = S - pad, y1 = S - pad;
  const r = S * 0.225; // 圆角半径

  // 箭头折线（归一化 0..1 坐标，基于内容区）
  // 从右下 到 左上，带一个小回折，形成增长趋势
  const pts = [
    [0.22, 0.70],
    [0.42, 0.50],
    [0.56, 0.62],
    [0.80, 0.32]
  ];
  const strokeW = 0.085;

  function insideRoundRect(fx, fy) {
    const cx = Math.max(x0 + r, Math.min(fx, x1 - r));
    const cy = Math.max(y0 + r, Math.min(fy, y1 - r));
    if (fx >= x0 + r && fx <= x1 - r) return fy >= y0 && fy <= y1;
    if (fy >= y0 + r && fy <= y1 - r) return fx >= x0 && fx <= x1;
    return Math.hypot(fx - cx, fy - cy) <= r;
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let acc = [0, 0, 0], accA = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = x + (sx + 0.5) / ss;
          const fy = y + (sy + 0.5) / ss;

          if (!insideRoundRect(fx, fy)) continue;

          // 渐变底色
          const t = (fy - y0) / Math.max(1, y1 - y0);
          let col = mix(gradTop, gradBot, t);
          let alpha = 1;

          // 箭头：折线描边
          let d = Infinity;
          for (let i = 0; i < pts.length - 1; i++) {
            const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
            d = Math.min(d, distToSeg(fx, fy, ax * S, ay * S, bx * S, by * S));
          }
          const half = (strokeW * S) / 2;
          // 平滑边缘
          const aa = Math.max(1.0, S / 64);
          const cov = Math.max(0, Math.min(1, (half - d) / aa + 0.5));
          if (cov > 0) {
            col = mix(col, white, cov);
            alpha = 1;
          }

          // 箭头头部（三角形，位于末端点左上方向）
          const tipX = pts[3][0] * S, tipY = pts[3][1] * S;
          const headLen = 0.20 * S, headHalf = 0.135 * S;
          // 以末端点为中心、朝向右上的三角形
          const ux = 0.7071, uy = -0.7071; // 指向右上
          const vx = 0.7071, vy = 0.7071;
          const dxp = fx - tipX, dyp = fy - tipY;
          const along = dxp * ux + dyp * uy;
          const perp = dxp * vx + dyp * vy;
          if (along >= -headLen && along <= 0 && Math.abs(perp) <= headHalf * (-along / headLen)) {
            col = white;
          }

          acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2];
          accA += alpha;
        }
      }

      const n = ss * ss;
      const idx = (y * S + x) * 4;
      if (accA === 0) {
        px[idx] = 0; px[idx + 1] = 0; px[idx + 2] = 0; px[idx + 3] = 0;
      } else {
        // 平均 RGB（只对覆盖到的采样做平均，避免边缘发暗）
        const cov = accA;
        px[idx] = Math.round(acc[0] / cov);
        px[idx + 1] = Math.round(acc[1] / cov);
        px[idx + 2] = Math.round(acc[2] / cov);
        px[idx + 3] = Math.round((cov / n) * 255);
      }
    }
  }

  return encodePNG(S, S, px);
}

const outDir = path.join(__dirname, '..', 'src', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const buf = render(size);
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, buf);
  console.log(`生成 ${file} (${buf.length} bytes)`);
}
console.log('图标生成完成');
