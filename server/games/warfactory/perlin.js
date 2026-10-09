'use strict';

/**
 * 柏林噪声（移植自 https://gitee.com/sli97/pcg —— MIT / 地图随机生成）。
 * 原仓库：assets/Script/Utils/PerlinNoise.ts + generateNoiseMap（fBm 八度叠加）。
 */

class Grad {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  dot2(x, y) {
    return this.x * x + this.y * y;
  }
}

class PerlinNoise {
  constructor() {
    this.grad3 = [
      new Grad(1, 1, 0), new Grad(-1, 1, 0), new Grad(1, -1, 0), new Grad(-1, -1, 0),
      new Grad(1, 0, 1), new Grad(-1, 0, 1), new Grad(1, 0, -1), new Grad(-1, 0, -1),
      new Grad(0, 1, 1), new Grad(0, -1, 1), new Grad(0, 1, -1), new Grad(0, -1, -1),
    ];
    this.p = [
      151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240,
      21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88,
      237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83,
      111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216,
      80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186,
      3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58,
      17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
      129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193,
      238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
      184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128,
      195, 78, 66, 215, 61, 156, 180,
    ];
    this.perm = new Array(512);
    this.gradP = new Array(512);
    this.seed(0);
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  lerp(a, b, t) {
    return (1 - t) * a + t * b;
  }

  seed(seed) {
    if (seed > 0 && seed < 1) seed *= 65536;
    seed = Math.floor(seed);
    if (seed < 256) seed |= seed << 8;
    for (let i = 0; i < 256; i++) {
      let v;
      if (i & 1) v = this.p[i] ^ (seed & 255);
      else v = this.p[i] ^ ((seed >> 8) & 255);
      this.perm[i] = this.perm[i + 256] = v;
      this.gradP[i] = this.gradP[i + 256] = this.grad3[v % 12];
    }
    return this;
  }

  noise(x, y) {
    let X = Math.floor(x);
    let Y = Math.floor(y);
    x = x - X;
    y = y - Y;
    X = X & 255;
    Y = Y & 255;
    const n00 = this.gradP[X + this.perm[Y]].dot2(x, y);
    const n01 = this.gradP[X + this.perm[Y + 1]].dot2(x, y - 1);
    const n10 = this.gradP[X + 1 + this.perm[Y]].dot2(x - 1, y);
    const n11 = this.gradP[X + 1 + this.perm[Y + 1]].dot2(x - 1, y - 1);
    const u = this.fade(x);
    return this.lerp(this.lerp(n00, n10, u), this.lerp(n01, n11, u), this.fade(y));
  }
}

function invertLerp(min, max, value) {
  if (!(max > min)) return 0.5;
  return (value - min) / (max - min);
}

/**
 * 基于柏林噪声生成二维数组（归一化到 [0,1]）。
 * 与 Gitee pcg 的 generateNoiseMap 同口径：多八度 fBm + 全图 min/max 归一化。
 */
function generateNoiseMap(mapWidth, mapHeight, seed, scale, octaves, persistance, lacunarity, offset) {
  const perlin = new PerlinNoise().seed(seed || 1);
  const sc = Math.max(1e-3, Number(scale) || 40);
  const oct = Math.max(1, Math.round(Number(octaves) || 5));
  const pers = Number(persistance) != null && Number.isFinite(Number(persistance)) ? Number(persistance) : 0.5;
  const lac = Math.max(1, Number(lacunarity) || 2);
  const ox = (offset && offset.x) || 0;
  const oy = (offset && offset.y) || 0;

  let maxNoiseHeight = -Infinity;
  let minNoiseHeight = Infinity;
  const noiseMap = new Array(mapWidth);
  for (let x = 0; x < mapWidth; x++) noiseMap[x] = new Array(mapHeight).fill(0);

  const halfWidth = mapWidth / 2;
  const halfHeight = mapHeight / 2;

  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      let amplitude = 1;
      let frequency = 1;
      let noiseHeight = 0;
      for (let i = 0; i < oct; i++) {
        const sampleX = ((x - halfWidth + ox * mapWidth) / sc) * frequency;
        const sampleY = ((y - halfHeight + oy * mapHeight) / sc) * frequency;
        const perlinValue = perlin.noise(sampleX, sampleY) * 2 - 1;
        noiseHeight += perlinValue * amplitude;
        amplitude *= pers;
        frequency *= lac;
      }
      if (noiseHeight > maxNoiseHeight) maxNoiseHeight = noiseHeight;
      if (noiseHeight < minNoiseHeight) minNoiseHeight = noiseHeight;
      noiseMap[x][y] = noiseHeight;
    }
  }

  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      noiseMap[x][y] = invertLerp(minNoiseHeight, maxNoiseHeight, noiseMap[x][y]);
    }
  }
  return noiseMap;
}

module.exports = {
  PerlinNoise,
  generateNoiseMap,
  invertLerp,
};
