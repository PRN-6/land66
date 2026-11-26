import * as THREE from 'three';
import type { WorldEntity } from '../types/world';

function lerpAngle(current: number, target: number, alpha: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * alpha;
}

interface EntityInstance {
  data: WorldEntity;
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  tail?: THREE.Object3D;
  legs: THREE.Object3D[];
  targetPos: THREE.Vector3;
  targetYaw: number;
  phase: number;
}

const COMP_TUNIC_COLORS = [0x6b7280, 0x8b6b57, 0x4f6d7a, 0x7c7a5f];
const CAT_COLORS = [0xe3964f, 0xf3f4f6, 0x3f3f46, 0xd98a5f];

function createAnimalOrCharacterMesh(ent: WorldEntity): Omit<EntityInstance, 'data' | 'targetPos' | 'targetYaw' | 'phase'> {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const head = new THREE.Group();
  const legs: THREE.Object3D[] = [];
  let tail: THREE.Object3D | undefined;

  root.add(body);

  // Ground shadow disc
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(ent.kind === 'companion' || ent.kind === 'villager' ? 0.38 : 0.28, 12),
    new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI * 0.5;
  shadow.position.y = 0.02;
  root.add(shadow);

  const v = ent.variant ?? 0;
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.2 });

  if (ent.kind === 'cat') {
    const coat = new THREE.MeshStandardMaterial({ color: CAT_COLORS[v % CAT_COLORS.length], roughness: 0.78 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.8 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.5 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.24, 6, 10), coat);
    torso.rotation.x = Math.PI * 0.5;
    torso.position.set(0, 0.24, 0);
    torso.castShadow = true;

    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), cream);
    chest.position.set(0, 0.22, 0.14);

    head.position.set(0, 0.36, 0.2);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), coat);
    skull.scale.set(1.08, 0.96, 1.0);
    const earGeo = new THREE.ConeGeometry(0.05, 0.1, 4);
    const earL = new THREE.Mesh(earGeo, coat);
    earL.position.set(-0.08, 0.13, 0);
    earL.rotation.z = 0.2;
    const earR = new THREE.Mesh(earGeo, coat);
    earR.position.set(0.08, 0.13, 0);
    earR.rotation.z = -0.2;
    const eL = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), eyeMat);
    eL.position.set(-0.05, 0.02, 0.13);
    const eR = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), eyeMat);
    eR.position.set(0.05, 0.02, 0.13);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), noseMat);
    nose.position.set(0, -0.02, 0.14);
    head.add(skull, earL, earR, eL, eR, nose);

    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.28, -0.18);
    const tailMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.22, 4, 8), coat);
    tailMesh.position.set(0, 0.11, -0.04);
    tailMesh.rotation.x = -0.45;
    tailPivot.add(tailMesh);
    tail = tailPivot;

    const legGeo = new THREE.CapsuleGeometry(0.036, 0.1, 4, 6);
    for (const [lx, lz] of [
      [-0.07, 0.12],
      [0.07, 0.12],
      [-0.07, -0.12],
      [0.07, -0.12],
    ]) {
      const leg = new THREE.Mesh(legGeo, cream);
      leg.position.set(lx, 0.1, lz);
      leg.castShadow = true;
      body.add(leg);
      legs.push(leg);
    }

    body.add(torso, chest, head, tailPivot);
  } else if (ent.kind === 'fox') {
    const russet = new THREE.MeshStandardMaterial({ color: 0xd96b27, roughness: 0.78 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.82 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.8 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.32, 6, 10), russet);
    torso.rotation.x = Math.PI * 0.5;
    torso.position.set(0, 0.28, 0);
    torso.castShadow = true;

    head.position.set(0, 0.38, 0.24);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), russet);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.16, 8), white);
    snout.rotation.x = Math.PI * 0.5;
    snout.position.set(0, -0.02, 0.16);
    const earGeo = new THREE.ConeGeometry(0.055, 0.13, 4);
    const earL = new THREE.Mesh(earGeo, dark);
    earL.position.set(-0.08, 0.14, 0);
    const earR = new THREE.Mesh(earGeo, dark);
    earR.position.set(0.08, 0.14, 0);
    const eL = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), eyeMat);
    eL.position.set(-0.055, 0.02, 0.12);
    const eR = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), eyeMat);
    eR.position.set(0.055, 0.02, 0.12);
    head.add(skull, snout, earL, earR, eL, eR);

    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.29, -0.22);
    const tailBase = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 6, 8), russet);
    tailBase.rotation.x = Math.PI * 0.38;
    tailBase.position.set(0, 0.06, -0.14);
    const tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), white);
    tailTip.position.set(0, 0.12, -0.26);
    tailPivot.add(tailBase, tailTip);
    tail = tailPivot;

    const legGeo = new THREE.CapsuleGeometry(0.036, 0.14, 4, 6);
    for (const [lx, lz] of [
      [-0.08, 0.15],
      [0.08, 0.15],
      [-0.08, -0.15],
      [0.08, -0.15],
    ]) {
      const leg = new THREE.Mesh(legGeo, dark);
      leg.position.set(lx, 0.12, lz);
      leg.castShadow = true;
      body.add(leg);
      legs.push(leg);
    }

    body.add(torso, head, tailPivot);
  } else if (ent.kind === 'sheep') {
    const wool = new THREE.MeshStandardMaterial({ color: 0xf5f5f4, roughness: 0.92 });
    const face = new THREE.MeshStandardMaterial({ color: 0x3f3f46, roughness: 0.8 });

    for (const [fx, fy, fz, r] of [
      [0, 0.38, 0, 0.25],
      [0, 0.4, 0.12, 0.2],
      [0, 0.37, -0.14, 0.21],
      [-0.1, 0.42, 0, 0.18],
      [0.1, 0.42, 0, 0.18],
    ]) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), wool);
      puff.position.set(fx, fy, fz);
      puff.castShadow = true;
      body.add(puff);
    }

    head.position.set(0, 0.44, 0.28);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), face);
    const woolTop = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), wool);
    woolTop.position.set(0, 0.1, -0.02);
    const eL = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), eyeMat);
    eL.position.set(-0.055, 0.02, 0.12);
    const eR = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), eyeMat);
    eR.position.set(0.055, 0.02, 0.12);
    head.add(skull, woolTop, eL, eR);

    const legGeo = new THREE.CapsuleGeometry(0.04, 0.14, 4, 6);
    for (const [lx, lz] of [
      [-0.1, 0.14],
      [0.1, 0.14],
      [-0.1, -0.14],
      [0.1, -0.14],
    ]) {
      const leg = new THREE.Mesh(legGeo, face);
      leg.position.set(lx, 0.12, lz);
      leg.castShadow = true;
      body.add(leg);
      legs.push(leg);
    }
    body.add(head);
  } else if (ent.kind === 'deer') {
    const fawn = new THREE.MeshStandardMaterial({ color: 0xb88456, roughness: 0.8 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.84 });
    const antlerMat = new THREE.MeshStandardMaterial({ color: 0x78553a, roughness: 0.85 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.38, 6, 10), fawn);
    torso.rotation.x = Math.PI * 0.5;
    torso.position.set(0, 0.52, 0);
    torso.castShadow = true;

    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.24, 6, 8), fawn);
    neck.position.set(0, 0.72, 0.22);
    neck.rotation.x = 0.28;

    head.position.set(0, 0.88, 0.3);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), fawn);
    const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.1, 4, 8), cream);
    snout.rotation.x = Math.PI * 0.5;
    snout.position.set(0, -0.02, 0.12);
    const eL = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), eyeMat);
    eL.position.set(-0.06, 0.03, 0.1);
    const eR = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), eyeMat);
    eR.position.set(0.06, 0.03, 0.1);
    head.add(skull, snout, eL, eR);

    if (v % 2 === 0) {
      const antL = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.18, 4, 6), antlerMat);
      antL.position.set(-0.07, 0.18, -0.02);
      antL.rotation.z = 0.25;
      const antR = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.18, 4, 6), antlerMat);
      antR.position.set(0.07, 0.18, -0.02);
      antR.rotation.z = -0.25;
      head.add(antL, antR);
    }

    const legGeo = new THREE.CapsuleGeometry(0.036, 0.3, 4, 6);
    for (const [lx, lz] of [
      [-0.09, 0.18],
      [0.09, 0.18],
      [-0.09, -0.18],
      [0.09, -0.18],
    ]) {
      const leg = new THREE.Mesh(legGeo, fawn);
      leg.position.set(lx, 0.24, lz);
      leg.castShadow = true;
      body.add(leg);
      legs.push(leg);
    }
    body.add(torso, neck, head);
  } else if (ent.kind === 'duck') {
    const feather = new THREE.MeshStandardMaterial({ color: v % 2 === 0 ? 0xfafaf9 : 0xe7e5e4, roughness: 0.72 });
    const drakeHead = new THREE.MeshStandardMaterial({ color: v % 2 === 0 ? 0x2f6b4f : 0xfafaf9, roughness: 0.7 });
    const billMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.5 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.16, 6, 10), feather);
    torso.rotation.x = Math.PI * 0.5;
    torso.position.set(0, 0.18, 0);
    torso.castShadow = true;

    head.position.set(0, 0.32, 0.13);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), drakeHead);
    const bill = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.09), billMat);
    bill.position.set(0, -0.02, 0.1);
    const eL = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), eyeMat);
    eL.position.set(-0.045, 0.02, 0.075);
    const eR = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), eyeMat);
    eR.position.set(0.045, 0.02, 0.075);
    head.add(skull, bill, eL, eR);

    for (const lx of [-0.06, 0.06]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.09), billMat);
      foot.position.set(lx, 0.04, 0.02);
      body.add(foot);
      legs.push(foot);
    }
    body.add(torso, head);
  } else {
    // Stylized Extra Character (companion / villager)
    const tunic = new THREE.MeshStandardMaterial({
      color: COMP_TUNIC_COLORS[v % COMP_TUNIC_COLORS.length],
      roughness: 0.76,
    });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf3c8ad, roughness: 0.68 });
    const hair = new THREE.MeshStandardMaterial({ color: v % 2 === 0 ? 0x27272a : 0x6b4423, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x3f3f46, roughness: 0.84 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.26, 8, 12), tunic);
    torso.scale.set(1.02, 1, 0.78);
    torso.position.set(0, 0.84, 0);
    torso.castShadow = true;

    head.position.set(0, 1.18, 0);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 12), skin);
    skull.position.y = 0.19;
    skull.castShadow = true;
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.245, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
    hairCap.position.set(0, 0.21, -0.02);
    hairCap.rotation.x = -0.25;
    const eL = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeMat);
    eL.position.set(-0.075, 0.2, 0.21);
    const eR = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeMat);
    eR.position.set(0.075, 0.2, 0.21);
    head.add(skull, hairCap, eL, eR);

    const armGeo = new THREE.CapsuleGeometry(0.062, 0.24, 6, 8);
    const lArm = new THREE.Mesh(armGeo, tunic);
    lArm.position.set(-0.26, 0.84, 0);
    const rArm = new THREE.Mesh(armGeo, tunic);
    rArm.position.set(0.26, 0.84, 0);

    const legGeo = new THREE.CapsuleGeometry(0.078, 0.24, 6, 8);
    const lLeg = new THREE.Mesh(legGeo, pants);
    lLeg.position.set(-0.1, 0.34, 0);
    const rLeg = new THREE.Mesh(legGeo, pants);
    rLeg.position.set(0.1, 0.34, 0);
    legs.push(lLeg, rLeg, lArm, rArm);

    body.add(torso, head, lArm, rArm, lLeg, rLeg);
  }

  root.traverse((obj) => {
    obj.userData.entityId = ent.id;
  });

  return { root, body, head, tail, legs };
}

export class EntityManager {
  public readonly group = new THREE.Group();
  private instances = new Map<string, EntityInstance>();
  private elapsed = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = 'world_entities';
    scene.add(this.group);
  }

  public sync(entities: WorldEntity[]): void {
    const activeIds = new Set(entities.map((e) => e.id));

    // Remove deleted entities
    for (const [id, inst] of this.instances) {
      if (!activeIds.has(id)) {
        this.group.remove(inst.root);
        this.instances.delete(id);
      }
    }

    // Add or update entities
    for (const ent of entities) {
      let inst = this.instances.get(ent.id);
      if (!inst) {
        const built = createAnimalOrCharacterMesh(ent);
        built.root.position.set(ent.position.x + 0.5, ent.position.y, ent.position.z + 0.5);
        built.root.rotation.y = ent.yaw;
        this.group.add(built.root);
        inst = {
          ...built,
          data: ent,
          targetPos: new THREE.Vector3(ent.position.x + 0.5, ent.position.y, ent.position.z + 0.5),
          targetYaw: ent.yaw,
          phase: Math.random() * 10,
        };
        this.instances.set(ent.id, inst);
      } else {
        inst.data = ent;
        inst.targetPos.set(ent.position.x + 0.5, ent.position.y, ent.position.z + 0.5);
        inst.targetYaw = ent.yaw;
      }
    }
  }

  public getEntityById(id: string): WorldEntity | null {
    return this.instances.get(id)?.data ?? null;
  }

  public update(dt: number): void {
    this.elapsed += dt;
    const smooth = Math.min(1, dt * 10);

    for (const inst of this.instances.values()) {
      inst.root.position.lerp(inst.targetPos, smooth);
      inst.root.rotation.y = lerpAngle(inst.root.rotation.y, inst.targetYaw, smooth);

      const t = this.elapsed + inst.phase;
      const anim = inst.data.animation;

      inst.body.position.y = 0;
      inst.head.rotation.x = 0;

      if (anim === 'walking') {
        const swing = Math.sin(t * 10) * 0.45;
        inst.body.position.y = Math.abs(Math.cos(t * 10)) * 0.04;
        inst.legs.forEach((leg, idx) => {
          leg.rotation.x = idx % 2 === 0 ? swing : -swing;
        });
      } else {
        inst.legs.forEach((leg) => {
          leg.rotation.x = 0;
        });
        if (anim === 'sitting') {
          inst.body.position.y = -0.07;
        } else if (anim === 'grazing') {
          inst.head.rotation.x = 0.52 + Math.sin(t * 4) * 0.1;
        }
      }

      if (inst.tail) {
        inst.tail.rotation.y = Math.sin(t * 4.5) * 0.25;
      }
    }
  }
}
