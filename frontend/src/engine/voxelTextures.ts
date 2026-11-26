import * as THREE from 'three';

export interface StylizedMaterials {
  waterNormalMap: THREE.CanvasTexture;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export function createSeamlessWaterNormalMap(): THREE.CanvasTexture {
  const size = 128;
  const heights = new Float32Array(size * size);
  const data = new Uint8ClampedArray(size * size * 4);
  const tau = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * tau;
      const v = (y / size) * tau;
      const w =
        Math.sin(u * 2 + v * 1) * 0.35 +
        Math.cos(u * 3 - v * 2) * 0.25 +
        Math.sin(u * 5 + v * 4) * 0.14 +
        Math.cos(u * 1 + v * 6) * 0.12;
      heights[y * size + x] = w;
    }
  }

  const strength = 1.45;
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx = (heights[y * size + xp] - heights[y * size + xm]) * strength;
      const dy = (heights[yp * size + x] - heights[ym * size + x]) * strength;
      let nx = -dx;
      let ny = dy;
      let nz = 1.0;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const idx = (y * size + x) * 4;
      data[idx] = clamp255((nx * 0.5 + 0.5) * 255);
      data[idx + 1] = clamp255((ny * 0.5 + 0.5) * 255);
      data[idx + 2] = clamp255((nz * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(data, size, size), 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createStylizedMaterials(): StylizedMaterials {
  return {
    waterNormalMap: createSeamlessWaterNormalMap(),
  };
}
