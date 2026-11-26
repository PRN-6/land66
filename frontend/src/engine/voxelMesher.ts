import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  BlockId,
  WORLD_DEPTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  blockIndex,
  type Vec3,
} from '../types/world';
import { getWorldMaterial } from './materialCatalog';

export interface AnimatedPondFish {
  mesh: THREE.Group;
  centerX: number;
  centerZ: number;
  y: number;
  radius: number;
  speed: number;
  phase: number;
}

export interface BuiltDioramaWorld {
  group: THREE.Group;
  torchPositions: Vec3[];
  cropMeshes: THREE.Object3D[];
  treeCanopies: THREE.Object3D[];
  pondFish: AnimatedPondFish[];
  foliagePositions: Vec3[];
  mistOrigins: Vec3[];
  waterMesh: THREE.Mesh | null;
}

function coordHash(x: number, y: number, z: number): number {
  let n = Math.imul(x + 13, 374761393) + Math.imul(y + 17, 668265263) + Math.imul(z + 31, 1442695041);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function getBlockParticleColor(block: number, material?: string | null): number {
  const matDef = getWorldMaterial(material);
  if (matDef) return matDef.hex;
  switch (block) {
    case BlockId.GRASS:
      return 0x93be68;
    case BlockId.DIRT:
    case BlockId.FARMLAND:
      return 0x8f6b50;
    case BlockId.STONE:
    case BlockId.COBBLESTONE:
      return 0x9aa3ab;
    case BlockId.WATER:
      return 0x67cbe0;
    case BlockId.WOOD_LOG:
      return 0x704d37;
    case BlockId.LEAVES:
    case BlockId.WILD_BERRY:
    case BlockId.SAPLING:
      return 0x7fb46e;
    case BlockId.WOOD_PLANK:
    case BlockId.DOOR_CLOSED:
    case BlockId.DOOR_OPEN:
    case BlockId.CHEST:
    case BlockId.CRAFTING_BENCH:
    case BlockId.FENCE:
      return 0xd7ab79;
    case BlockId.GLASS:
      return 0xc6eef9;
    case BlockId.BED:
      return 0xd96b68;
    case BlockId.TORCH:
      return 0xffcf70;
    case BlockId.CROP_WHEAT:
      return 0xebd16b;
    case BlockId.ROOF_SHINGLE:
      return 0x4f6d77;
    default:
      return 0xb4bec7;
  }
}

// Smooth shared primitives (reused across chunk rebuilds -> zero GPU geometry leaks)
const roundedGrassCapGeo = new RoundedBoxGeometry(1.03, 0.44, 1.03, 2, 0.16);
const roundedDirtBaseGeo = new RoundedBoxGeometry(1.01, 0.72, 1.01, 2, 0.12);
const roundedBlockGeo = new RoundedBoxGeometry(1.01, 1.01, 1.01, 2, 0.14);
const roundedStoneGeo = new RoundedBoxGeometry(1.02, 1.01, 1.02, 2, 0.16);
const roundedPlankGeo = new RoundedBoxGeometry(1.0, 1.0, 1.0, 2, 0.1);
const smoothSphereGeo = new THREE.SphereGeometry(0.5, 14, 12);
const smoothCylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const taperedCylGeo = new THREE.CylinderGeometry(0.36, 0.54, 1, 12);
const smoothConeGeo = new THREE.ConeGeometry(0.5, 1, 10);
const bladeConeGeo = new THREE.ConeGeometry(0.14, 1, 5);
const lilyDiscGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.04, 12, 1, false, 0.25, Math.PI * 1.82);
const waterBoxGeo = new THREE.BoxGeometry(1.01, 0.86, 1.01);
const koiBodyGeo = new THREE.CapsuleGeometry(0.06, 0.18, 4, 8);

const matCache: Record<string, THREE.MeshStandardMaterial> = {};
function getClayMat(
  key: string,
  color: number,
  extra?: Partial<THREE.MeshStandardMaterialParameters>,
): THREE.MeshStandardMaterial {
  if (!matCache[key]) {
    matCache[key] = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.78,
      metalness: 0.03,
      ...extra,
    });
  }
  return matCache[key];
}

function addPart(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  px: number,
  py: number,
  pz: number,
  sx: number,
  sy: number,
  sz: number,
  coord: { x: number; y: number; z: number },
  castShadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(px, py, pz);
  m.scale.set(sx, sy, sz);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  m.userData = { blockCoord: coord };
  parent.add(m);
  return m;
}

function addInstanceCoord(
  inst: THREE.InstancedMesh,
  index: number,
  matrix: THREE.Matrix4,
  color: THREE.Color,
): void {
  inst.setMatrixAt(index, matrix);
  inst.setColorAt(index, color);
}

export function isSolidTerrainOrBuild(block: number): boolean {
  return (
    block === BlockId.GRASS ||
    block === BlockId.DIRT ||
    block === BlockId.STONE ||
    block === BlockId.WOOD_PLANK ||
    block === BlockId.COBBLESTONE ||
    block === BlockId.ROOF_SHINGLE
  );
}

export function buildWorldMeshes(
  blocks: Uint8Array,
  blockMeta: Uint8Array,
  waterNormalMap: THREE.Texture,
  blockMaterials?: string[],
): BuiltDioramaWorld {
  const group = new THREE.Group();
  group.name = 'diorama_world';

  const torchPositions: Vec3[] = [];
  const cropMeshes: THREE.Object3D[] = [];
  const treeCanopies: THREE.Object3D[] = [];
  const pondFish: AnimatedPondFish[] = [];
  const foliagePositions: Vec3[] = [];
  const mistOrigins: Vec3[] = [];

  const getB = (x: number, y: number, z: number): number => {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH) {
      return BlockId.AIR;
    }
    return blocks[blockIndex(x, y, z)];
  };

  const getM = (x: number, y: number, z: number): string => {
    if (!blockMaterials || x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH) {
      return '';
    }
    return blockMaterials[blockIndex(x, y, z)] ?? '';
  };

  const isFullySurrounded = (x: number, y: number, z: number): boolean =>
    isSolidTerrainOrBuild(getB(x + 1, y, z)) &&
    isSolidTerrainOrBuild(getB(x - 1, y, z)) &&
    isSolidTerrainOrBuild(getB(x, y + 1, z)) &&
    isSolidTerrainOrBuild(getB(x, y - 1, z)) &&
    isSolidTerrainOrBuild(getB(x, y, z + 1)) &&
    isSolidTerrainOrBuild(getB(x, y, z - 1));

  // Track which LEAVES belong to sculpted organic trees so we don't draw double cube leaves
  const claimedLeafIndices = new Set<number>();
  const claimedLogIndices = new Set<number>();
  const treeDefs: Array<{
    baseX: number;
    baseY: number;
    baseZ: number;
    height: number;
    barkMatId: string;
    leafMatId: string;
  }> = [];

  for (let z = 0; z < WORLD_DEPTH; z++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        const idx = blockIndex(x, y, z);
        if (blocks[idx] !== BlockId.WOOD_LOG || claimedLogIndices.has(idx)) continue;
        // Only start from bottom of trunk column
        if (y > 0 && getB(x, y - 1, z) === BlockId.WOOD_LOG) continue;

        let h = 0;
        let cy = y;
        while (cy < WORLD_HEIGHT && getB(x, cy, z) === BlockId.WOOD_LOG) {
          claimedLogIndices.add(blockIndex(x, cy, z));
          h++;
          cy++;
        }

        // Check if leaves exist near top of this log column (i.e. it's a tree!)
        let leafCount = 0;
        let detectedLeafMat = '';
        for (let ly = y + Math.max(1, h - 1); ly <= Math.min(WORLD_HEIGHT - 1, y + h + 3); ly++) {
          for (let lz = Math.max(0, z - 2); lz <= Math.min(WORLD_DEPTH - 1, z + 2); lz++) {
            for (let lx = Math.max(0, x - 2); lx <= Math.min(WORLD_WIDTH - 1, x + 2); lx++) {
              const lIdx = blockIndex(lx, ly, lz);
              if (blocks[lIdx] === BlockId.LEAVES) {
                leafCount++;
                claimedLeafIndices.add(lIdx);
                if (!detectedLeafMat && blockMaterials?.[lIdx]) {
                  detectedLeafMat = blockMaterials[lIdx];
                }
              }
            }
          }
        }

        if (leafCount > 0) {
          const isBlossomHash = coordHash(x, y, z) > 0.78;
          const barkMatId = getM(x, y, z) || 'oak_bark';
          const leafMatId = detectedLeafMat || (isBlossomHash ? 'sakura_foliage' : 'oak_foliage');
          treeDefs.push({ baseX: x, baseY: y, baseZ: z, height: h, barkMatId, leafMatId });
        } else {
          // Unclaim single placed log if no leaves around
          for (let py = y; py < y + h; py++) {
            claimedLogIndices.delete(blockIndex(x, py, z));
          }
        }
      }
    }
  }

  // Collect instanced terrain/building blocks for crisp rounded diorama rendering
  const grassEntries: Array<{ x: number; y: number; z: number; material: string }> = [];
  const dirtEntries: Array<{ x: number; y: number; z: number; material: string }> = [];
  const stoneEntries: Array<{ x: number; y: number; z: number; isCobble: boolean; material: string }> = [];
  const specialStoneEntries: Array<{ x: number; y: number; z: number; material: string }> = [];
  const plankEntries: Array<{ x: number; y: number; z: number; material: string }> = [];
  const grassTufts: Array<{ x: number; y: number; z: number; scale: number; rot: number; tint: number }> = [];
  const flowerEntries: Array<{ x: number; y: number; z: number; petalColor: number }> = [];
  const pebbleEntries: Array<{ x: number; y: number; z: number; scale: number }> = [];
  const waterCells: Array<{ x: number; y: number; z: number }> = [];

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < WORLD_DEPTH; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const idx = blockIndex(x, y, z);
        const b = blocks[idx];
        if (b === BlockId.AIR) continue;
        const matId = blockMaterials?.[idx] ?? '';

        if (b === BlockId.WATER) {
          waterCells.push({ x, y, z });
          continue;
        }

        if (isSolidTerrainOrBuild(b) && isFullySurrounded(x, y, z)) {
          continue;
        }

        if (b === BlockId.GRASS) {
          grassEntries.push({ x, y, z, material: matId });
          if (getB(x, y + 1, z) === BlockId.AIR) {
            const r = coordHash(x, y, z);
            if (r < 0.42) {
              grassTufts.push({
                x: x + 0.25 + coordHash(x + 1, y, z) * 0.5,
                y: y + 1.0,
                z: z + 0.25 + coordHash(x, y, z + 1) * 0.5,
                scale: 0.75 + r * 0.8,
                rot: r * Math.PI * 2,
                tint: r,
              });
            } else if (r > 0.84) {
              flowerEntries.push({
                x: x + 0.25 + coordHash(x + 2, y, z) * 0.5,
                y: y + 1.0,
                z: z + 0.25 + coordHash(x, y, z + 2) * 0.5,
                petalColor: r > 0.92 ? 0xfce7f3 : r > 0.88 ? 0xfef3c7 : 0xffffff,
              });
            } else if (r > 0.77 && r <= 0.81) {
              pebbleEntries.push({
                x: x + 0.3 + coordHash(x + 3, y, z) * 0.4,
                y: y + 0.98,
                z: z + 0.3 + coordHash(x, y, z + 3) * 0.4,
                scale: 0.28 + (r - 0.77) * 5,
              });
            }
          }
          continue;
        }

        if (b === BlockId.DIRT) {
          dirtEntries.push({ x, y, z, material: matId });
          continue;
        }

        if (b === BlockId.STONE || b === BlockId.COBBLESTONE) {
          const matDef = getWorldMaterial(matId);
          if (matDef && matDef.finish !== 'matte') {
            specialStoneEntries.push({ x, y, z, material: matId });
          } else {
            stoneEntries.push({ x, y, z, isCobble: b === BlockId.COBBLESTONE, material: matId });
          }
          continue;
        }

        if (b === BlockId.WOOD_PLANK) {
          plankEntries.push({ x, y, z, material: matId });
          continue;
        }
      }
    }
  }

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  // 1. Grass Cushions (Rounded top turf + warm earth sub-block)
  if (grassEntries.length > 0) {
    const turfMat = getClayMat('diorama_turf', 0xffffff, { roughness: 0.84 });
    const dirtSubMat = getClayMat('diorama_dirt_sub', 0x917056, { roughness: 0.88 });
    const turfInst = new THREE.InstancedMesh(roundedGrassCapGeo, turfMat, grassEntries.length);
    const subInst = new THREE.InstancedMesh(roundedDirtBaseGeo, dirtSubMat, grassEntries.length);
    turfInst.castShadow = true;
    turfInst.receiveShadow = true;
    subInst.castShadow = true;
    subInst.receiveShadow = true;

    const palette = [0x90be65, 0x9ac66e, 0x84b35b, 0xa2cc74];
    for (let i = 0; i < grassEntries.length; i++) {
      const e = grassEntries[i];
      const h = coordHash(e.x, e.y, e.z);
      const matDef = getWorldMaterial(e.material);
      dummy.position.set(e.x + 0.5, e.y + 0.79, e.z + 0.5);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      tmpColor.setHex(matDef ? matDef.hex : palette[Math.floor(h * palette.length) % palette.length]);
      if (matDef) tmpColor.offsetHSL(0, 0, (h - 0.5) * 0.04);
      addInstanceCoord(turfInst, i, dummy.matrix, tmpColor);

      dummy.position.set(e.x + 0.5, e.y + 0.36, e.z + 0.5);
      dummy.updateMatrix();
      tmpColor.setHex(0x937157);
      addInstanceCoord(subInst, i, dummy.matrix, tmpColor);
    }
    turfInst.instanceMatrix.needsUpdate = true;
    if (turfInst.instanceColor) turfInst.instanceColor.needsUpdate = true;
    subInst.instanceMatrix.needsUpdate = true;
    group.add(turfInst, subInst);
  }

  // 2. Dirt blocks (supports clay_bank, sandy_bank, rich loam)
  if (dirtEntries.length > 0) {
    const dirtMat = getClayMat('diorama_dirt', 0xffffff, { roughness: 0.9 });
    const inst = new THREE.InstancedMesh(roundedBlockGeo, dirtMat, dirtEntries.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    for (let i = 0; i < dirtEntries.length; i++) {
      const e = dirtEntries[i];
      const h = coordHash(e.x, e.y, e.z);
      const matDef = getWorldMaterial(e.material);
      dummy.position.set(e.x + 0.5, e.y + 0.5, e.z + 0.5);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      tmpColor.setHex(matDef ? matDef.hex : h < 0.5 ? 0x8e6c53 : 0x826149);
      if (matDef) tmpColor.offsetHSL(0, 0, (h - 0.5) * 0.04);
      addInstanceCoord(inst, i, dummy.matrix, tmpColor);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  // 3. Stone, Strata & Masonry (Granite, Slate, Mossy Stone, Sandstone, Brick, Coal...)
  if (stoneEntries.length > 0) {
    const stoneMat = getClayMat('diorama_stone', 0xffffff, { roughness: 0.78 });
    const inst = new THREE.InstancedMesh(roundedStoneGeo, stoneMat, stoneEntries.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    const stonePalette = [0x9099a1, 0x9ca4ac, 0x848d95, 0xa8b0b7];
    for (let i = 0; i < stoneEntries.length; i++) {
      const e = stoneEntries[i];
      const h = coordHash(e.x, e.y, e.z);
      const matDef = getWorldMaterial(e.material);
      dummy.position.set(e.x + 0.5, e.y + 0.5, e.z + 0.5);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      if (matDef) {
        tmpColor.setHex(matDef.hex);
        tmpColor.offsetHSL(0, 0, (h - 0.5) * 0.04);
      } else {
        tmpColor.setHex(stonePalette[Math.floor(h * stonePalette.length) % stonePalette.length]);
        if (e.isCobble) tmpColor.offsetHSL(0.02, -0.02, 0.04);
      }
      addInstanceCoord(inst, i, dummy.matrix, tmpColor);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  // 3B. Special PBR Finishes: Metallic Ore Veins, Glossy Marble/Obsidian, Luminous Crystal/Sunstone
  for (const se of specialStoneEntries) {
    const matDef = getWorldMaterial(se.material);
    if (!matDef) continue;
    const coord = { x: se.x, y: se.y, z: se.z };

    if (matDef.finish === 'metallic') {
      if (matDef.id === 'copper_block') {
        const cMat = getClayMat(`sp_${matDef.id}`, matDef.hex, {
          roughness: matDef.roughness,
          metalness: matDef.metalness,
        });
        addPart(group, roundedStoneGeo, cMat, se.x + 0.5, se.y + 0.5, se.z + 0.5, 1, 1, 1, coord);
      } else {
        const hostMat = getClayMat('ore_host_stone', 0x737a82, { roughness: 0.84, metalness: 0.05 });
        const veinHex = matDef.id === 'gold_vein' ? 0xf2c144 : matDef.id === 'copper_vein' ? 0xd97d4f : 0xd09d78;
        const veinMat = getClayMat(`ore_nugget_${matDef.id}`, veinHex, {
          roughness: matDef.roughness,
          metalness: matDef.metalness,
        });
        const grp = new THREE.Group();
        grp.position.set(se.x + 0.5, se.y + 0.5, se.z + 0.5);
        addPart(grp, roundedStoneGeo, hostMat, 0, 0, 0, 1, 1, 1, coord);
        for (const [ox, oy, oz, r] of [
          [0.2, 0.48, 0.16, 0.22],
          [-0.22, 0.46, -0.18, 0.18],
          [0.48, 0.12, -0.14, 0.19],
          [-0.48, -0.1, 0.18, 0.18],
          [0.14, -0.08, 0.48, 0.19],
        ]) {
          addPart(grp, smoothSphereGeo, veinMat, ox, oy, oz, r, r * 0.85, r, coord);
        }
        group.add(grp);
      }
    } else if (matDef.finish === 'glossy') {
      const key = `phys_${matDef.id}`;
      let phys = matCache[key] as THREE.Material | undefined;
      if (!phys) {
        phys = new THREE.MeshPhysicalMaterial({
          color: matDef.hex,
          roughness: matDef.roughness,
          metalness: matDef.metalness,
          clearcoat: 0.78,
          clearcoatRoughness: 0.14,
        });
        matCache[key] = phys as THREE.MeshStandardMaterial;
      }
      addPart(group, roundedStoneGeo, phys, se.x + 0.5, se.y + 0.5, se.z + 0.5, 1, 1, 1, coord);
    } else if (matDef.finish === 'emissive') {
      const glowMat = getClayMat(`sp_${matDef.id}`, matDef.hex, {
        roughness: matDef.roughness,
        metalness: matDef.metalness,
        emissive: new THREE.Color(matDef.emissiveHex ?? matDef.hex),
        emissiveIntensity: matDef.emissiveIntensity ?? 1.35,
      });
      if (matDef.id === 'crystal_vein') {
        const hostMat = getClayMat('crystal_host', 0x56606b, { roughness: 0.76, metalness: 0.08 });
        const grp = new THREE.Group();
        grp.position.set(se.x + 0.5, se.y + 0.5, se.z + 0.5);
        addPart(grp, roundedStoneGeo, hostMat, 0, 0, 0, 1, 1, 1, coord);
        const s1 = addPart(grp, smoothConeGeo, glowMat, 0.06, 0.68, -0.05, 0.34, 0.65, 0.34, coord, false);
        s1.rotation.z = -0.22;
        const s2 = addPart(grp, smoothConeGeo, glowMat, -0.2, 0.58, 0.16, 0.24, 0.48, 0.24, coord, false);
        s2.rotation.z = 0.34;
        s2.rotation.x = 0.24;
        const s3 = addPart(grp, smoothConeGeo, glowMat, 0.46, 0.16, 0.18, 0.22, 0.42, 0.22, coord, false);
        s3.rotation.z = -1.1;
        group.add(grp);
      } else {
        addPart(group, roundedStoneGeo, glowMat, se.x + 0.5, se.y + 0.5, se.z + 0.5, 1, 1, 1, coord, false);
      }
    }
  }

  // 4. Wood Planks (Oak Boards, Walnut Timber, Bamboo Panels)
  if (plankEntries.length > 0) {
    const plankMat = getClayMat('diorama_plank', 0xffffff, { roughness: 0.7 });
    const inst = new THREE.InstancedMesh(roundedPlankGeo, plankMat, plankEntries.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    const plankPalette = [0xdcb587, 0xd1a574, 0xe2be93];
    for (let i = 0; i < plankEntries.length; i++) {
      const e = plankEntries[i];
      const h = coordHash(e.x, e.y, e.z);
      const matDef = getWorldMaterial(e.material);
      dummy.position.set(e.x + 0.5, e.y + 0.5, e.z + 0.5);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      if (matDef) {
        tmpColor.setHex(matDef.hex);
        tmpColor.offsetHSL(0, 0, (h - 0.5) * 0.03);
      } else {
        tmpColor.setHex(plankPalette[Math.floor(h * plankPalette.length) % plankPalette.length]);
      }
      addInstanceCoord(inst, i, dummy.matrix, tmpColor);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  // 5. Lush 3D Grass Tufts & Wildflowers & Mossy Pebbles
  if (grassTufts.length > 0) {
    const tuftMat = getClayMat('grass_tuft', 0xffffff, { roughness: 0.8 });
    const inst = new THREE.InstancedMesh(bladeConeGeo, tuftMat, grassTufts.length * 2);
    inst.receiveShadow = true;
    for (let i = 0; i < grassTufts.length; i++) {
      const g = grassTufts[i];
      for (let b = 0; b < 2; b++) {
        const idx = i * 2 + b;
        dummy.position.set(g.x + (b === 0 ? -0.06 : 0.07), g.y + 0.14 * g.scale, g.z + (b === 0 ? 0.04 : -0.05));
        dummy.rotation.set(b === 0 ? 0.14 : -0.16, g.rot + b * 1.1, b === 0 ? -0.15 : 0.14);
        dummy.scale.set(0.55 * g.scale, 0.34 * g.scale, 0.55 * g.scale);
        dummy.updateMatrix();
        tmpColor.setHex(g.tint < 0.5 ? 0x7fb354 : 0x95c768);
        addInstanceCoord(inst, idx, dummy.matrix, tmpColor);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  if (flowerEntries.length > 0) {
    const stemMat = getClayMat('flower_stem', 0x6ba147, { roughness: 0.8 });
    const petalMat = getClayMat('flower_petal', 0xffffff, { roughness: 0.55 });
    const stemInst = new THREE.InstancedMesh(smoothCylGeo, stemMat, flowerEntries.length);
    const petalInst = new THREE.InstancedMesh(smoothSphereGeo, petalMat, flowerEntries.length);
    for (let i = 0; i < flowerEntries.length; i++) {
      const fl = flowerEntries[i];
      dummy.position.set(fl.x, fl.y + 0.12, fl.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.05, 0.24, 0.05);
      dummy.updateMatrix();
      stemInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(fl.x, fl.y + 0.25, fl.z);
      dummy.scale.set(0.18, 0.11, 0.18);
      dummy.updateMatrix();
      tmpColor.setHex(fl.petalColor);
      addInstanceCoord(petalInst, i, dummy.matrix, tmpColor);
    }
    stemInst.instanceMatrix.needsUpdate = true;
    petalInst.instanceMatrix.needsUpdate = true;
    if (petalInst.instanceColor) petalInst.instanceColor.needsUpdate = true;
    group.add(stemInst, petalInst);
  }

  if (pebbleEntries.length > 0) {
    const pebMat = getClayMat('moss_pebble', 0xffffff, { roughness: 0.72 });
    const inst = new THREE.InstancedMesh(smoothSphereGeo, pebMat, pebbleEntries.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    for (let i = 0; i < pebbleEntries.length; i++) {
      const p = pebbleEntries[i];
      dummy.position.set(p.x, p.y + 0.06, p.z);
      dummy.rotation.set(0, p.x * 0.7, 0);
      dummy.scale.set(p.scale * 1.2, p.scale * 0.65, p.scale);
      dummy.updateMatrix();
      tmpColor.setHex(i % 2 === 0 ? 0x9aa4ac : 0x869a7f);
      addInstanceCoord(inst, i, dummy.matrix, tmpColor);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  // 6. Sculpted Organic Trees (Oak, Birch, Pine, Sakura Blossom, & Autumn Amber Canopies!)
  const barkMat = getClayMat('tree_bark', 0x6d4a37, { roughness: 0.86 });
  const birchBarkMat = getClayMat('birch_bark', 0xdcd5c5, { roughness: 0.8 });
  const pineBarkMat = getClayMat('pine_bark', 0x5c3e2c, { roughness: 0.9 });
  const canopyPalettes: Record<string, THREE.MeshStandardMaterial[]> = {
    oak_foliage: [
      getClayMat('canopy_g1', 0x76aa64, { roughness: 0.74 }),
      getClayMat('canopy_g2', 0x8bc072, { roughness: 0.72 }),
      getClayMat('canopy_g3', 0x629653, { roughness: 0.76 }),
    ],
    birch_foliage: [
      getClayMat('canopy_b1', 0x99ba63, { roughness: 0.72 }),
      getClayMat('canopy_b2', 0xaec974, { roughness: 0.7 }),
      getClayMat('canopy_b3', 0x87a955, { roughness: 0.74 }),
    ],
    pine_foliage: [
      getClayMat('canopy_p1', 0x456f54, { roughness: 0.78 }),
      getClayMat('canopy_p2', 0x528061, { roughness: 0.76 }),
      getClayMat('canopy_p3', 0x385e47, { roughness: 0.8 }),
    ],
    sakura_foliage: [
      getClayMat('canopy_s1', 0xf3a8bc, { roughness: 0.68 }),
      getClayMat('canopy_s2', 0xf8c3d1, { roughness: 0.66 }),
      getClayMat('canopy_s3', 0xe58fa7, { roughness: 0.7 }),
    ],
    autumn_foliage: [
      getClayMat('canopy_a1', 0xdf894c, { roughness: 0.72 }),
      getClayMat('canopy_a2', 0xe8a556, { roughness: 0.7 }),
      getClayMat('canopy_a3', 0xc96c3e, { roughness: 0.74 }),
    ],
  };
  const canopyPaletteGreen = canopyPalettes.oak_foliage;

  for (const tree of treeDefs) {
    const coord = { x: tree.baseX, y: tree.baseY, z: tree.baseZ };
    const treeBarkMat =
      tree.barkMatId === 'birch_bark'
        ? birchBarkMat
        : tree.barkMatId === 'pine_bark'
          ? pineBarkMat
          : barkMat;
    const treeGrp = new THREE.Group();
    treeGrp.position.set(tree.baseX + 0.5, tree.baseY, tree.baseZ + 0.5);

    const h = Math.max(2.6, tree.height + 0.35);
    const leanX = (coordHash(tree.baseX, 1, tree.baseZ) - 0.5) * 0.22;
    const leanZ = (coordHash(tree.baseZ, 2, tree.baseX) - 0.5) * 0.22;

    // Flared base root collar + lower trunk + upper crooked trunk + branches
    addPart(treeGrp, taperedCylGeo, treeBarkMat, 0, 0.3, 0, 0.76, 0.6, 0.76, coord);
    const lowTrunk = addPart(treeGrp, taperedCylGeo, treeBarkMat, leanX * 0.3, h * 0.32, leanZ * 0.3, 0.48, h * 0.65, 0.48, coord);
    lowTrunk.rotation.set(leanZ * 0.4, 0, -leanX * 0.4);

    const topTrunk = addPart(
      treeGrp,
      taperedCylGeo,
      treeBarkMat,
      leanX * 0.8,
      h * 0.75,
      leanZ * 0.8,
      0.34,
      h * 0.55,
      0.34,
      coord,
    );
    topTrunk.rotation.set(-leanZ * 0.5, 0, leanX * 0.5);

    // Side branches
    const branchAngles = [0.6, 2.5, 4.4];
    for (let bi = 0; bi < branchAngles.length; bi++) {
      const ang = branchAngles[bi] + coordHash(tree.baseX, bi, tree.baseZ);
      const bLen = 1.15;
      const br = addPart(
        treeGrp,
        taperedCylGeo,
        treeBarkMat,
        leanX + Math.cos(ang) * 0.48,
        h * 0.78 + bi * 0.14,
        leanZ + Math.sin(ang) * 0.48,
        0.2,
        bLen,
        0.2,
        coord,
      );
      br.rotation.z = -Math.cos(ang) * 0.82;
      br.rotation.x = Math.sin(ang) * 0.82;
    }

    // Fluffy billowing canopy spheres
    const canopyGrp = new THREE.Group();
    canopyGrp.position.set(leanX, h + 0.1, leanZ);
    const mats = canopyPalettes[tree.leafMatId] ?? canopyPaletteGreen;
    const puffs: Array<[number, number, number, number]> = [
      [0, 0.65, 0, 1.95],
      [-0.95, 0.2, 0.35, 1.45],
      [0.95, 0.25, -0.3, 1.5],
      [0.25, 0.15, 0.95, 1.4],
      [-0.3, 0.2, -0.95, 1.38],
      [-0.55, 0.85, -0.45, 1.25],
      [0.55, 0.88, 0.45, 1.28],
      [0, 1.25, 0, 1.32],
      [0.85, 0.65, 0.65, 1.05],
      [-0.85, 0.6, -0.6, 1.05],
    ];
    for (let pi = 0; pi < puffs.length; pi++) {
      const [px, py, pz, r] = puffs[pi];
      const puff = addPart(canopyGrp, smoothSphereGeo, mats[pi % mats.length], px, py, pz, r, r * 0.88, r, coord);
      puff.rotation.y = pi * 0.7;
    }

    treeGrp.add(canopyGrp);
    treeCanopies.push(canopyGrp);
    group.add(treeGrp);
    foliagePositions.push({ x: tree.baseX + 0.5, y: tree.baseY + h, z: tree.baseZ + 0.5 });
  }

  // 7. Glossy Pond Water Surface, Lily Pads, Stones & Animated Koi Fish
  let waterMesh: THREE.Mesh | null = null;
  if (waterCells.length > 0) {
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x5cc4d8,
      normalMap: waterNormalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      transparent: true,
      opacity: 0.78,
      roughness: 0.08,
      metalness: 0.04,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
      ior: 1.33,
    });
    const waterInst = new THREE.InstancedMesh(waterBoxGeo, waterMat, waterCells.length);
    waterInst.receiveShadow = true;

    let sumX = 0;
    let sumZ = 0;
    let pondY = waterCells[0].y;
    for (let i = 0; i < waterCells.length; i++) {
      const wc = waterCells[i];
      sumX += wc.x + 0.5;
      sumZ += wc.z + 0.5;
      pondY = Math.max(pondY, wc.y);
      dummy.position.set(wc.x + 0.5, wc.y + 0.43, wc.z + 0.5);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      waterInst.setMatrixAt(i, dummy.matrix);

      // Lily pad & lotus on a few pond cells
      const r = coordHash(wc.x, wc.y, wc.z);
      if (r < 0.24 && getB(wc.x, wc.y + 1, wc.z) === BlockId.AIR) {
        const padMat = getClayMat('lily_pad', 0x6ca95b, { roughness: 0.65 });
        const pad = addPart(
          group,
          lilyDiscGeo,
          padMat,
          wc.x + 0.4 + r,
          wc.y + 0.88,
          wc.z + 0.4 + r * 0.5,
          0.95,
          1,
          0.95,
          { x: wc.x, y: wc.y, z: wc.z },
          false,
        );
        pad.rotation.y = r * 12;
        if (r < 0.1) {
          addPart(
            group,
            smoothSphereGeo,
            getClayMat('lotus', 0xfbcfe8, { roughness: 0.45 }),
            pad.position.x,
            wc.y + 0.94,
            pad.position.z,
            0.22,
            0.14,
            0.22,
            { x: wc.x, y: wc.y, z: wc.z },
            false,
          );
        }
      }
    }
    waterInst.instanceMatrix.needsUpdate = true;
    group.add(waterInst);
    waterMesh = waterInst;

    // Animated Koi Fish swimming inside pond center
    const cx = sumX / waterCells.length;
    const cz = sumZ / waterCells.length;
    const koiColors = [0xf97316, 0xf8fafc, 0xef4444];
    for (let fi = 0; fi < Math.min(3, Math.max(1, Math.floor(waterCells.length / 4))); fi++) {
      const koi = new THREE.Group();
      const bodyMat = getClayMat(`koi_${fi}`, koiColors[fi % koiColors.length], { roughness: 0.4 });
      const body = new THREE.Mesh(koiBodyGeo, bodyMat);
      body.rotation.x = Math.PI * 0.5;
      const tail = new THREE.Mesh(smoothConeGeo, bodyMat);
      tail.scale.set(0.11, 0.14, 0.05);
      tail.rotation.x = -Math.PI * 0.5;
      tail.position.z = -0.17;
      koi.add(body, tail);
      group.add(koi);
      pondFish.push({
        mesh: koi,
        centerX: cx,
        centerZ: cz,
        y: pondY + 0.62 + fi * 0.04,
        radius: 0.65 + fi * 0.32,
        speed: 0.7 + fi * 0.22,
        phase: fi * 2.1,
      });
    }
  }

  // 8. Remaining Special Blocks & Architectural Diorama Models
  const roofBaseMat = getClayMat('roof_slate', 0x4b6a75, { roughness: 0.68 });
  const roofRibMat = getClayMat('roof_rib', 0x3b5660, { roughness: 0.62 });
  const roofTrimMat = getClayMat('roof_trim', 0xd8bd8a, { roughness: 0.58 });
  const glassPaneMat = new THREE.MeshPhysicalMaterial({
    color: 0xd4f1f9,
    transparent: true,
    opacity: 0.52,
    roughness: 0.08,
    clearcoat: 1.0,
  });

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < WORLD_DEPTH; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const idx = blockIndex(x, y, z);
        const b = blocks[idx];
        if (b === BlockId.AIR || b === BlockId.WATER || b === BlockId.GRASS || b === BlockId.DIRT || b === BlockId.STONE || b === BlockId.COBBLESTONE || b === BlockId.WOOD_PLANK) {
          continue;
        }
        if (claimedLogIndices.has(idx) || claimedLeafIndices.has(idx)) {
          continue;
        }

        const meta = blockMeta[idx];
        const coord = { x, y, z };
        const blockMatDef = getWorldMaterial(blockMaterials?.[idx]);

        // Sculpted Island Underside spires for floating rim
        if (b === BlockId.ROOF_SHINGLE) {
          // Ribbed tiled roof with ridge caps along top edges (supports terracotta, cedar, slate)
          const rBase = blockMatDef
            ? getClayMat(`roof_${blockMatDef.id}`, blockMatDef.hex, { roughness: blockMatDef.roughness })
            : roofBaseMat;
          const rRib = blockMatDef
            ? getClayMat(`roof_rib_${blockMatDef.id}`, blockMatDef.hex, { roughness: Math.max(0.4, blockMatDef.roughness - 0.08) })
            : roofRibMat;
          const roofGrp = new THREE.Group();
          roofGrp.position.set(x + 0.5, y, z + 0.5);
          addPart(roofGrp, roundedPlankGeo, rBase, 0, 0.36, 0, 1.04, 0.56, 1.04, coord);
          for (let r = -1; r <= 1; r++) {
            const rib = addPart(roofGrp, smoothCylGeo, rRib, r * 0.32, 0.64, 0, 0.16, 1.04, 0.16, coord);
            rib.rotation.x = Math.PI * 0.5;
          }
          if (getB(x, y + 1, z) !== BlockId.ROOF_SHINGLE) {
            const topNeighbors =
              (getB(x + 1, y, z) === BlockId.ROOF_SHINGLE ? 1 : 0) +
              (getB(x - 1, y, z) === BlockId.ROOF_SHINGLE ? 1 : 0) +
              (getB(x, y, z + 1) === BlockId.ROOF_SHINGLE ? 1 : 0) +
              (getB(x, y, z - 1) === BlockId.ROOF_SHINGLE ? 1 : 0);
            if (topNeighbors <= 2) {
              addPart(roofGrp, roundedPlankGeo, roofTrimMat, 0, 0.72, 0, 0.24, 0.14, 1.05, coord);
            }
          }
          group.add(roofGrp);
          continue;
        }

        if (b === BlockId.GLASS) {
          const wGrp = new THREE.Group();
          wGrp.position.set(x + 0.5, y + 0.5, z + 0.5);
          const frame = getClayMat('win_frame', 0x8b6240, { roughness: 0.72 });
          const paneMat =
            blockMatDef && blockMatDef.id === 'stained_glass'
              ? getClayMat('glass_azure', blockMatDef.hex, {
                  transparent: true,
                  opacity: blockMatDef.opacity ?? 0.64,
                  roughness: 0.1,
                })
              : glassPaneMat;
          addPart(wGrp, roundedPlankGeo, frame, 0, -0.45, 0, 1.04, 0.1, 1.04, coord);
          addPart(wGrp, roundedPlankGeo, frame, 0, 0.45, 0, 1.04, 0.1, 1.04, coord);
          addPart(wGrp, roundedPlankGeo, frame, -0.45, 0, 0, 0.1, 0.9, 1.02, coord);
          addPart(wGrp, roundedPlankGeo, frame, 0.45, 0, 0, 0.1, 0.9, 1.02, coord);
          addPart(wGrp, roundedPlankGeo, frame, 0, 0, 0, 0.06, 0.84, 0.9, coord);
          addPart(wGrp, roundedPlankGeo, paneMat, 0, 0, 0, 0.88, 0.84, 0.88, coord, false);
          group.add(wGrp);
          continue;
        }

        if (b === BlockId.WOOD_LOG) {
          // Standalone placed timber log
          const logMat = blockMatDef
            ? getClayMat(`log_${blockMatDef.id}`, blockMatDef.hex, { roughness: blockMatDef.roughness })
            : barkMat;
          addPart(group, smoothCylGeo, logMat, x + 0.5, y + 0.5, z + 0.5, 0.78, 1.0, 0.78, coord);
          continue;
        }

        if (b === BlockId.LEAVES) {
          const leafMat = blockMatDef
            ? getClayMat(`leaf_${blockMatDef.id}`, blockMatDef.hex, { roughness: blockMatDef.roughness })
            : canopyPaletteGreen[0];
          addPart(group, smoothSphereGeo, leafMat, x + 0.5, y + 0.5, z + 0.5, 1.15, 1.05, 1.15, coord);
          continue;
        }

        if (b === BlockId.TORCH) {
          // Warm cozy paper-lantern post!
          const lGrp = new THREE.Group();
          lGrp.position.set(x + 0.5, y, z + 0.5);
          const postMat = getClayMat('lantern_post', 0x6b4730, { roughness: 0.78 });
          const capMat = getClayMat('lantern_cap', 0x334155, { roughness: 0.55 });
          const paperMat = getClayMat('lantern_paper', 0xffdf9a, {
            emissive: new THREE.Color(0xff9f38),
            emissiveIntensity: 2.2,
            roughness: 0.45,
          });
          addPart(lGrp, smoothCylGeo, postMat, -0.18, 0.48, 0, 0.12, 0.96, 0.12, coord);
          addPart(lGrp, roundedPlankGeo, postMat, 0, 0.94, 0, 0.46, 0.08, 0.1, coord);
          addPart(lGrp, smoothSphereGeo, paperMat, 0.16, 0.72, 0, 0.28, 0.34, 0.28, coord, false);
          addPart(lGrp, smoothCylGeo, capMat, 0.16, 0.9, 0, 0.22, 0.05, 0.22, coord);
          addPart(lGrp, smoothCylGeo, capMat, 0.16, 0.54, 0, 0.18, 0.04, 0.18, coord);
          group.add(lGrp);
          torchPositions.push({ x: x + 0.66, y: y + 0.75, z: z + 0.5 });
          continue;
        }

        if (b === BlockId.FENCE) {
          const fGrp = new THREE.Group();
          fGrp.position.set(x + 0.5, y, z + 0.5);
          const fMat = getClayMat('bamboo_fence', 0xc89d6c, { roughness: 0.74 });
          addPart(fGrp, smoothCylGeo, fMat, 0, 0.46, 0, 0.16, 0.92, 0.16, coord);
          addPart(fGrp, smoothSphereGeo, fMat, 0, 0.94, 0, 0.2, 0.12, 0.2, coord);
          const connDirs: Array<[number, number, number, number]> = [
            [1, 0, 0.32, 0],
            [-1, 0, -0.32, 0],
            [0, 1, 0, 0.32],
            [0, -1, 0, -0.32],
          ];
          for (const [dx, dz, ox, oz] of connDirs) {
            const nb = getB(x + dx, y, z + dz);
            if (nb === BlockId.FENCE || isSolidTerrainOrBuild(nb)) {
              for (const ry of [0.34, 0.68]) {
                const rail = addPart(fGrp, smoothCylGeo, fMat, ox, ry, oz, 0.08, 0.45, 0.08, coord);
                if (dx !== 0) rail.rotation.z = Math.PI * 0.5;
                if (dz !== 0) rail.rotation.x = Math.PI * 0.5;
              }
            }
          }
          group.add(fGrp);
          continue;
        }

        if (b === BlockId.FARMLAND) {
          const wet = meta > 0;
          const soilMat = getClayMat(wet ? 'd_farm_wet' : 'd_farm_dry', wet ? 0x482f1b : 0x9b724f, {
            roughness: wet ? 0.36 : 0.9,
          });
          addPart(group, roundedDirtBaseGeo, soilMat, x + 0.5, y + 0.44, z + 0.5, 0.98, 0.88, 0.98, coord);
          for (let r = -1; r <= 1; r++) {
            addPart(group, smoothCylGeo, soilMat, x + 0.5, y + 0.89, z + 0.5 + r * 0.27, 0.18, 0.86, 0.18, coord).rotation.z =
              Math.PI * 0.5;
          }
          continue;
        }

        if (b === BlockId.CROP_WHEAT) {
          const stage = Math.max(0, Math.min(3, meta));
          const cropGrp = new THREE.Group();
          cropGrp.position.set(x + 0.5, y, z + 0.5);
          cropGrp.userData = { blockCoord: coord, baseY: y };
          const h = 0.22 + stage * 0.2;
          const color =
            stage === 0 ? 0x7ac75e : stage === 1 ? 0x95cb52 : stage === 2 ? 0xd2c44d : 0xf2c249;
          const stalkMat = getClayMat(`d_wheat_${stage}`, color, { roughness: 0.72 });
          const earMat = getClayMat('d_wheat_ear', 0xf6d56f, { roughness: 0.62 });
          const pts = [
            [-0.26, -0.24, 0.07],
            [0.24, -0.22, -0.06],
            [-0.22, 0.24, -0.05],
            [0.26, 0.22, 0.06],
            [0, 0, 0.02],
          ];
          for (const [ox, oz, lean] of pts) {
            const st = addPart(cropGrp, smoothCylGeo, stalkMat, ox, h * 0.5, oz, 0.06, h, 0.06, coord);
            st.rotation.z = lean;
            if (stage >= 2) {
              const ear = addPart(cropGrp, smoothSphereGeo, stage >= 3 ? earMat : stalkMat, ox - lean * 0.3, h + 0.07, oz, 0.12, 0.22, 0.12, coord);
              ear.rotation.z = lean * 2;
            }
          }
          group.add(cropGrp);
          cropMeshes.push(cropGrp);
          foliagePositions.push({ x: x + 0.5, y: y + 0.6, z: z + 0.5 });
          continue;
        }

        if (b === BlockId.WILD_BERRY) {
          const bGrp = new THREE.Group();
          bGrp.position.set(x + 0.5, y, z + 0.5);
          const l1 = getClayMat('d_bush_1', 0x6ba25b, { roughness: 0.76 });
          const l2 = getClayMat('d_bush_2', 0x81b86d, { roughness: 0.74 });
          const berry = getClayMat('d_berry', 0xe11d48, { roughness: 0.28 });
          addPart(bGrp, smoothSphereGeo, l1, 0, 0.3, 0, 0.88, 0.68, 0.88, coord);
          addPart(bGrp, smoothSphereGeo, l2, 0.2, 0.38, -0.14, 0.58, 0.48, 0.58, coord);
          addPart(bGrp, smoothSphereGeo, l2, -0.22, 0.34, 0.18, 0.54, 0.44, 0.54, coord);
          for (const [bx, by, bz] of [
            [-0.24, 0.46, 0.33],
            [0.24, 0.34, 0.34],
            [0.34, 0.46, -0.14],
            [-0.32, 0.35, -0.2],
            [0.1, 0.6, 0.14],
          ]) {
            addPart(bGrp, smoothSphereGeo, berry, bx, by, bz, 0.12, 0.12, 0.12, coord, false);
          }
          group.add(bGrp);
          continue;
        }

        if (b === BlockId.SAPLING) {
          const sGrp = new THREE.Group();
          sGrp.position.set(x + 0.5, y, z + 0.5);
          addPart(sGrp, taperedCylGeo, barkMat, 0, 0.24, 0, 0.12, 0.48, 0.12, coord);
          addPart(sGrp, smoothSphereGeo, canopyPaletteGreen[1], 0, 0.56, 0, 0.52, 0.46, 0.52, coord);
          addPart(sGrp, smoothSphereGeo, canopyPaletteGreen[0], 0.14, 0.66, -0.08, 0.36, 0.32, 0.36, coord);
          group.add(sGrp);
          continue;
        }

        if (b === BlockId.DOOR_CLOSED || b === BlockId.DOOR_OPEN) {
          const isOpen = b === BlockId.DOOR_OPEN;
          const dGrp = new THREE.Group();
          dGrp.position.set(x + 0.5, y, z + 0.5);
          const fMat = getClayMat('d_door_f', 0x7c5335, { roughness: 0.74 });
          const pMat = getClayMat('d_door_p', 0xb68150, { roughness: 0.66 });
          const brass = getClayMat('d_brass', 0xfbbf24, { metalness: 0.75, roughness: 0.25 });

          addPart(dGrp, roundedPlankGeo, fMat, -0.45, 0.92, 0, 0.1, 1.84, 0.2, coord);
          addPart(dGrp, roundedPlankGeo, fMat, 0.45, 0.92, 0, 0.1, 1.84, 0.2, coord);
          addPart(dGrp, roundedPlankGeo, fMat, 0, 1.84, 0, 1.0, 0.12, 0.2, coord);

          const pivot = new THREE.Group();
          pivot.position.set(-0.4, 0, 0);
          pivot.rotation.y = isOpen ? Math.PI * 0.46 : 0;
          addPart(pivot, roundedPlankGeo, pMat, 0.4, 0.9, 0, 0.8, 1.76, 0.1, coord);
          addPart(pivot, smoothSphereGeo, brass, 0.7, 0.88, 0.08, 0.1, 0.1, 0.08, coord);
          dGrp.add(pivot);
          group.add(dGrp);
          continue;
        }

        if (b === BlockId.BED) {
          const bGrp = new THREE.Group();
          bGrp.position.set(x + 0.5, y, z + 0.5);
          const oak = getClayMat('d_bed_wood', 0x7c5335, { roughness: 0.74 });
          const sheet = getClayMat('d_bed_sheet', 0xf8f4ec, { roughness: 0.85 });
          const quilt = getClayMat('d_bed_quilt', 0xd65b59, { roughness: 0.85 });
          addPart(bGrp, roundedPlankGeo, oak, 0, 0.2, 0, 0.94, 0.18, 0.96, coord);
          addPart(bGrp, roundedPlankGeo, oak, 0, 0.46, -0.43, 0.94, 0.46, 0.1, coord);
          addPart(bGrp, roundedPlankGeo, sheet, 0, 0.34, -0.14, 0.86, 0.18, 0.56, coord);
          addPart(bGrp, roundedPlankGeo, quilt, 0, 0.37, 0.16, 0.88, 0.22, 0.62, coord);
          addPart(bGrp, roundedPlankGeo, sheet, 0, 0.46, -0.28, 0.64, 0.16, 0.26, coord);
          group.add(bGrp);
          continue;
        }

        if (b === BlockId.CHEST) {
          const cGrp = new THREE.Group();
          cGrp.position.set(x + 0.5, y, z + 0.5);
          const oak = getClayMat('d_chest', 0xb37b48, { roughness: 0.66 });
          const iron = getClayMat('d_chest_i', 0x475569, { metalness: 0.6, roughness: 0.38 });
          const gold = getClayMat('d_chest_g', 0xfbbf24, { metalness: 0.8, roughness: 0.22 });
          addPart(cGrp, roundedPlankGeo, oak, 0, 0.38, 0, 0.84, 0.68, 0.74, coord);
          addPart(cGrp, smoothCylGeo, oak, 0, 0.68, 0, 0.74, 0.84, 0.74, coord).rotation.z = Math.PI * 0.5;
          addPart(cGrp, roundedPlankGeo, iron, -0.32, 0.45, 0, 0.08, 0.72, 0.78, coord);
          addPart(cGrp, roundedPlankGeo, iron, 0.32, 0.45, 0, 0.08, 0.72, 0.78, coord);
          addPart(cGrp, smoothSphereGeo, gold, 0, 0.6, 0.39, 0.15, 0.16, 0.1, coord, false);
          group.add(cGrp);
          continue;
        }

        if (b === BlockId.CRAFTING_BENCH) {
          const cbGrp = new THREE.Group();
          cbGrp.position.set(x + 0.5, y, z + 0.5);
          const leg = getClayMat('d_cb_leg', 0x744d31, { roughness: 0.78 });
          const top = getClayMat('d_cb_top', 0xcf9b63, { roughness: 0.64 });
          const steel = getClayMat('d_cb_st', 0x94a3b8, { metalness: 0.7, roughness: 0.3 });
          for (const [lx, lz] of [
            [-0.36, -0.36],
            [0.36, -0.36],
            [-0.36, 0.36],
            [0.36, 0.36],
          ]) {
            addPart(cbGrp, smoothCylGeo, leg, lx, 0.4, lz, 0.16, 0.8, 0.16, coord);
          }
          addPart(cbGrp, roundedPlankGeo, top, 0, 0.88, 0, 0.98, 0.18, 0.98, coord);
          addPart(cbGrp, roundedPlankGeo, steel, -0.18, 1.03, -0.14, 0.24, 0.12, 0.16, coord);
          group.add(cbGrp);
        }
      }
    }
  }

  // Soft sculpted stone stalactites & hanging mist origins beneath floating island
  for (let z = 0; z < WORLD_DEPTH; z++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      for (let y = 1; y <= 9; y++) {
        const b = getB(x, y, z);
        if ((b === BlockId.STONE || b === BlockId.DIRT) && getB(x, y - 1, z) === BlockId.AIR) {
          const r = coordHash(x, y, z);
          if (r < 0.18) {
            const spireH = 0.75 + r * 5.2;
            const spire = addPart(
              group,
              smoothConeGeo,
              getClayMat('diorama_under', 0x879098, { roughness: 0.86 }),
              x + 0.5,
              y - spireH * 0.45,
              z + 0.5,
              0.92,
              spireH,
              0.92,
              { x, y, z },
              false,
            );
            spire.rotation.x = Math.PI;
            if (r < 0.06) {
              mistOrigins.push({ x: x + 0.5, y: y - spireH, z: z + 0.5 });
            }
          }
          break;
        }
      }
    }
  }

  return {
    group,
    torchPositions,
    cropMeshes,
    treeCanopies,
    pondFish,
    foliagePositions,
    mistOrigins,
    waterMesh,
  };
}
