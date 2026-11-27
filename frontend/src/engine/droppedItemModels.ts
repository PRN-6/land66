import * as THREE from 'three';
import type { DroppedItem } from '../types/world';

interface DroppedItemInstance {
  data: DroppedItem;
  root: THREE.Group;
  body: THREE.Group;
  parachute: THREE.Group;
  shadowDisc: THREE.Mesh;
  groundRing: THREE.Mesh;
  visualY: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  groundY: number;
  phase: number;
  parachuteFade: number;
  colorHex: number;
  impactFired: boolean;
}

const ITEM_COLORS: Record<string, number> = {
  berries: 0xe11d48,
  bread: 0xeab308,
  cooked_meat: 0xb45309,
  raw_meat: 0xd97757,
  wheat: 0xfacc15,
  seeds: 0x84cc16,
  wood_log: 0x78513a,
  wood_plank: 0xc89b66,
  stone: 0x94a3b8,
  iron_ore: 0xb08968,
  gold_ore: 0xfbbf24,
  copper_ore: 0xd97745,
  coal: 0x334155,
  crystal: 0x38bdf8,
  marble: 0xf1efe8,
  obsidian: 0x312e4a,
  sunstone: 0xf59e0b,
  sandstone: 0xe2c78c,
  wooden_spear: 0xa16207,
  hunting_bow: 0x92400e,
  iron_sword: 0xd1d5db,
  axe: 0x9ca3af,
  pickaxe: 0x9ca3af,
  hammer: 0x78716c,
  sapling: 0x4ade80,
};

function getItemColorHex(item: string): number {
  return ITEM_COLORS[item] ?? 0xe4e4e7;
}

function buildItemVisual(item: string, colorHex: number): THREE.Group {
  const g = new THREE.Group();
  const mainMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: item === 'crystal' || item === 'sunstone' ? 0.2 : 0.65,
    metalness: item.includes('ore') || item.includes('sword') || item === 'axe' || item === 'pickaxe' ? 0.55 : 0.1,
    emissive: item === 'crystal' || item === 'sunstone' ? new THREE.Color(colorHex) : new THREE.Color(0x000000),
    emissiveIntensity: item === 'crystal' || item === 'sunstone' ? 0.35 : 0,
  });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x9c7248, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f4, roughness: 0.55 });

  if (item === 'crystal' || item === 'sunstone' || item === 'gold_ore') {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), mainMat);
    gem.position.y = 0.28;
    gem.castShadow = true;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.36), crateMat);
    base.position.y = 0.06;
    base.castShadow = true;
    g.add(base, gem);
  } else if (item === 'iron_sword' || item === 'wooden_spear' || item === 'hunting_bow' || item === 'axe' || item === 'pickaxe') {
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.48, 0.08), crateMat);
    shaft.position.y = 0.26;
    shaft.rotation.z = -0.32;
    shaft.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.08), mainMat);
    head.position.set(0.08, 0.42, 0);
    head.rotation.z = -0.32;
    head.castShadow = true;
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.32), crateMat);
    stand.position.y = 0.05;
    g.add(stand, shaft, head);
  } else {
    // Stylized supply crate with top item display & ribbon band
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.38), crateMat);
    box.position.y = 0.17;
    box.castShadow = true;

    const band1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.34, 0.07), trimMat);
    band1.position.y = 0.17;
    const band2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.4), trimMat);
    band2.position.y = 0.17;

    const topper = new THREE.Mesh(
      item === 'berries' || item === 'bread' || item === 'seeds'
        ? new THREE.DodecahedronGeometry(0.14, 0)
        : new THREE.BoxGeometry(0.24, 0.14, 0.24),
      mainMat,
    );
    topper.position.y = 0.39;
    topper.castShadow = true;
    g.add(box, band1, band2, topper);
  }
  return g;
}

function buildParachute(): THREE.Group {
  const pGroup = new THREE.Group();
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.75,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
  });
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.54, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
    canopyMat,
  );
  canopy.position.y = 0.92;
  canopy.castShadow = true;
  pGroup.add(canopy);

  const cordMat = new THREE.LineBasicMaterial({ color: 0xe4e4e7, transparent: true, opacity: 0.7 });
  for (const [cx, cz] of [
    [-0.36, -0.36],
    [0.36, -0.36],
    [-0.36, 0.36],
    [0.36, 0.36],
  ]) {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.34, 0),
      new THREE.Vector3(cx, 0.95, cz),
    ]);
    pGroup.add(new THREE.Line(geom, cordMat));
  }
  return pGroup;
}

export class DroppedItemManager {
  public readonly group = new THREE.Group();
  private instances = new Map<string, DroppedItemInstance>();
  private elapsed = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = 'world_dropped_items';
    scene.add(this.group);
  }

  public sync(items: DroppedItem[]): void {
    const activeIds = new Set(items.map((d) => d.id));

    for (const [id, inst] of this.instances) {
      if (!activeIds.has(id)) {
        this.group.remove(inst.root);
        this.instances.delete(id);
      }
    }

    for (const item of items) {
      const targetX = item.position.x + 0.5;
      const targetY = item.position.y;
      const targetZ = item.position.z + 0.5;
      const groundY = item.grid_pos.y;
      let inst = this.instances.get(item.id);

      if (!inst) {
        const root = new THREE.Group();
        const colorHex = getItemColorHex(item.item);
        const body = buildItemVisual(item.item, colorHex);
        const parachute = buildParachute();
        parachute.visible = !item.landed;

        const shadowDisc = new THREE.Mesh(
          new THREE.CircleGeometry(0.28, 14),
          new THREE.MeshBasicMaterial({ color: 0x09090b, transparent: true, opacity: 0.28, depthWrite: false }),
        );
        shadowDisc.rotation.x = -Math.PI * 0.5;

        const groundRing = new THREE.Mesh(
          new THREE.RingGeometry(0.24, 0.33, 20),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
        );
        groundRing.rotation.x = -Math.PI * 0.5;

        body.add(parachute);
        root.add(body, shadowDisc, groundRing);
        root.position.set(targetX, 0, targetZ);

        root.traverse((obj) => {
          obj.userData.droppedItemId = item.id;
        });

        this.group.add(root);
        inst = {
          data: item,
          root,
          body,
          parachute,
          shadowDisc,
          groundRing,
          visualY: targetY,
          targetX,
          targetY,
          targetZ,
          groundY,
          phase: Math.random() * 6.28,
          parachuteFade: item.landed ? 0 : 1,
          colorHex,
          impactFired: item.landed,
        };
        this.instances.set(item.id, inst);
      } else {
        inst.data = item;
        inst.targetX = targetX;
        inst.targetY = targetY;
        inst.targetZ = targetZ;
        inst.groundY = groundY;
      }
    }
  }

  public getItemById(id: string): DroppedItem | null {
    return this.instances.get(id)?.data ?? null;
  }

  public update(
    dt: number,
    onLandedBurst?: (x: number, y: number, z: number, colorHex: number) => void,
  ): void {
    this.elapsed += dt;

    for (const inst of this.instances.values()) {
      const { data, root, body, parachute, shadowDisc, groundRing } = inst;

      // Interpolate smoothly between 10Hz backend updates; accelerate if still mid-air
      if (!data.landed) {
        const dy = inst.targetY - inst.visualY;
        if (Math.abs(dy) > 2.5) {
          inst.visualY = inst.targetY;
        } else {
          inst.visualY += dy * Math.min(1, dt * 16);
        }
        inst.parachuteFade = 1;
      } else {
        inst.visualY += (inst.targetY - inst.visualY) * Math.min(1, dt * 18);
        inst.parachuteFade = Math.max(0, inst.parachuteFade - dt * 4.5);
      }

      if (!inst.impactFired && data.landed && Math.abs(inst.visualY - inst.groundY) < 0.25) {
        inst.impactFired = true;
        onLandedBurst?.(inst.data.grid_pos.x, inst.data.grid_pos.y, inst.data.grid_pos.z, inst.colorHex);
      }

      const bob = data.landed ? Math.sin(this.elapsed * 2.8 + inst.phase) * 0.055 + 0.04 : 0;
      const sway = data.landed ? 0 : Math.sin(this.elapsed * 3.4 + inst.phase) * 0.1;

      root.position.set(inst.targetX, 0, inst.targetZ);
      body.position.set(0, Math.max(inst.groundY, inst.visualY) + bob, 0);
      body.rotation.y = data.landed ? data.yaw + this.elapsed * 0.8 : data.yaw + this.elapsed * 0.4;
      body.rotation.z = sway;

      if (inst.parachuteFade > 0.01) {
        parachute.visible = true;
        parachute.scale.setScalar(0.3 + inst.parachuteFade * 0.7);
      } else {
        parachute.visible = false;
      }

      const heightAboveGround = Math.max(0, inst.visualY - inst.groundY);
      const prox = Math.max(0.25, 1 - heightAboveGround / 12);
      shadowDisc.position.set(0, inst.groundY + 0.025, 0);
      shadowDisc.scale.setScalar(0.65 + prox * 0.45);
      (shadowDisc.material as THREE.MeshBasicMaterial).opacity = 0.14 + prox * 0.22;

      groundRing.position.set(0, inst.groundY + 0.03, 0);
      if (!data.landed) {
        const pulse = 0.9 + Math.sin(this.elapsed * 7) * 0.16;
        groundRing.scale.setScalar(pulse * 1.15);
        (groundRing.material as THREE.MeshBasicMaterial).opacity = 0.55;
      } else {
        const idlePulse = 0.92 + Math.sin(this.elapsed * 2.4 + inst.phase) * 0.08;
        groundRing.scale.setScalar(idlePulse);
        (groundRing.material as THREE.MeshBasicMaterial).opacity = 0.28;
      }
    }
  }
}
