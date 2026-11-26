import * as THREE from 'three';
import type { Vec3 } from '../types/world';

function lerpAngle(current: number, target: number, alpha: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * alpha;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const NPC_VARIANTS = [
  { tunic: 0x3b8c82, scarf: 0xd96b52, hair: 0x4c3226, hat: 0xd9b37c, hatBand: 0xc2594b },
  { tunic: 0x8f5b4a, scarf: 0xe3b261, hair: 0x27272a, hat: 0x8f6f4e, hatBand: 0x3b6e6c },
  { tunic: 0x4b5c78, scarf: 0xd4a373, hair: 0x6d452a, hat: 0x4a5568, hatBand: 0xc87d55 },
  { tunic: 0x687b59, scarf: 0xc97b63, hair: 0x3b261d, hat: 0xc7a778, hatBand: 0x526b4e },
];

export class NpcModel {
  public readonly agentId: string;
  public readonly root = new THREE.Group();
  public readonly bodyPivot = new THREE.Group();
  public readonly headGroup = new THREE.Group();
  public readonly torsoGroup = new THREE.Group();

  public readonly leftShoulderPivot = new THREE.Group();
  public readonly leftElbowPivot = new THREE.Group();
  public readonly rightShoulderPivot = new THREE.Group();
  public readonly rightElbowPivot = new THREE.Group();

  public readonly leftHipPivot = new THREE.Group();
  public readonly leftKneePivot = new THREE.Group();
  public readonly rightHipPivot = new THREE.Group();
  public readonly rightKneePivot = new THREE.Group();

  public readonly heldToolGroup = new THREE.Group();
  private leftEyelid!: THREE.Mesh;
  private rightEyelid!: THREE.Mesh;
  private canSpoutNode = new THREE.Object3D();

  private targetPos = new THREE.Vector3(15.5, 11, 15.5);
  private targetYaw = 0;
  private targetBlock: Vec3 | null = null;
  private animation = 'idle';
  private animClock = 0;
  private blinkClock = 0;
  private currentToolKind = 'none';
  private toolMeshes: Record<string, THREE.Object3D> = {};

  constructor(variant = 0, agentId = 'aiden') {
    this.agentId = agentId;
    const palette = NPC_VARIANTS[Math.abs(variant) % NPC_VARIANTS.length];
    this.root.name = `npc_${agentId}`;
    this.root.add(this.bodyPivot);

    // Soft matte-satin stylized clay materials
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf7cbb0, roughness: 0.68 });
    const blushMat = new THREE.MeshStandardMaterial({ color: 0xf4978e, roughness: 0.72 });
    const hairMat = new THREE.MeshStandardMaterial({ color: palette.hair, roughness: 0.78 });
    const hatMat = new THREE.MeshStandardMaterial({ color: palette.hat, roughness: 0.8 });
    const hatBandMat = new THREE.MeshStandardMaterial({ color: palette.hatBand, roughness: 0.75 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.18 });
    const eyeShineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const tunicMat = new THREE.MeshStandardMaterial({ color: palette.tunic, roughness: 0.74 });
    const scarfMat = new THREE.MeshStandardMaterial({ color: palette.scarf, roughness: 0.78 });
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x6f472c, roughness: 0.8 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xf6c957, metalness: 0.7, roughness: 0.25 });
    const packMat = new THREE.MeshStandardMaterial({ color: 0x8f623e, roughness: 0.82 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.82 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.82 });

    // Soft ground contact shadow disc beneath Aiden
    const shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 16),
      new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.24, depthWrite: false }),
    );
    shadowDisc.rotation.x = -Math.PI * 0.5;
    shadowDisc.position.y = 0.02;
    this.root.add(shadowDisc);

    // Smooth Capsule Legs + Rounded Boots
    const buildLeg = (hipPivot: THREE.Group, kneePivot: THREE.Group, xOffset: number) => {
      hipPivot.position.set(xOffset, 0.62, 0);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.16, 6, 10), pantsMat);
      thigh.position.y = -0.13;
      thigh.castShadow = true;

      kneePivot.position.set(0, -0.27, 0);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.14, 6, 10), pantsMat);
      shin.position.y = -0.11;
      shin.castShadow = true;

      const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.1, 6, 10), bootMat);
      boot.rotation.x = Math.PI * 0.5;
      boot.position.set(0, -0.28, 0.04);
      boot.castShadow = true;

      kneePivot.add(shin, boot);
      hipPivot.add(thigh, kneePivot);
    };
    buildLeg(this.leftHipPivot, this.leftKneePivot, -0.11);
    buildLeg(this.rightHipPivot, this.rightKneePivot, 0.11);

    // Smooth Rounded Torso + Cozy Scarf + Belt + Rounded Backpack
    this.torsoGroup.position.set(0, 0.9, 0);
    const bodyCore = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.28, 8, 14), tunicMat);
    bodyCore.scale.set(1.04, 1, 0.78);
    bodyCore.castShadow = true;

    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.055, 8, 16), scarfMat);
    scarf.rotation.x = Math.PI * 0.5;
    scarf.position.set(0, 0.26, 0);
    scarf.castShadow = true;

    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.22, 0.075, 14), leatherMat);
    belt.scale.set(1.06, 1, 0.8);
    belt.position.y = -0.16;

    const buckle = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), brassMat);
    buckle.position.set(0, -0.16, 0.18);

    const pack = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.16, 6, 10), packMat);
    pack.scale.set(1.15, 1, 0.72);
    pack.position.set(0, 0.03, -0.2);
    pack.castShadow = true;

    const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.34, 10), scarfMat);
    bedroll.rotation.z = Math.PI * 0.5;
    bedroll.position.set(0, 0.22, -0.2);

    this.torsoGroup.add(bodyCore, scarf, belt, buckle, pack, bedroll);

    // Smooth Capsule Arms + Spherical Hands
    const buildArm = (shoulderPivot: THREE.Group, elbowPivot: THREE.Group, xOffset: number, withTool: boolean) => {
      shoulderPivot.position.set(xOffset, 1.13, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.15, 6, 10), tunicMat);
      upper.position.y = -0.12;
      upper.castShadow = true;

      elbowPivot.position.set(0, -0.23, 0);
      const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.12, 6, 10), skinMat);
      forearm.position.y = -0.1;
      forearm.castShadow = true;

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), skinMat);
      hand.position.y = -0.22;

      elbowPivot.add(forearm, hand);
      if (withTool) {
        this.heldToolGroup.position.set(0, -0.22, 0.12);
        elbowPivot.add(this.heldToolGroup);
      }
      shoulderPivot.add(upper, elbowPivot);
    };
    buildArm(this.leftShoulderPivot, this.leftElbowPivot, -0.29, false);
    buildArm(this.rightShoulderPivot, this.rightElbowPivot, 0.29, true);

    // Expressive Rounded Chibi-Proportioned Head + Hat + Rosy Cheeks + Glossy Eyes
    this.headGroup.position.set(0, 1.24, 0);
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 16), skinMat);
    headMesh.scale.set(1.04, 0.98, 1.0);
    headMesh.position.y = 0.22;
    headMesh.castShadow = true;

    // Soft hair swoops & back cap
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat);
    hairBack.position.set(0, 0.24, -0.02);
    hairBack.rotation.x = -0.28;

    const bangL = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), hairMat);
    bangL.scale.set(1.2, 0.7, 0.8);
    bangL.position.set(-0.1, 0.36, 0.19);
    const bangR = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), hairMat);
    bangR.scale.set(1.1, 0.65, 0.8);
    bangR.position.set(0.11, 0.36, 0.18);

    // Cozy Woven Explorer Sunhat
    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.04, 18), hatMat);
    hatBrim.position.set(0, 0.41, -0.02);
    hatBrim.rotation.x = -0.12;
    hatBrim.castShadow = true;
    const hatCrown = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hatMat);
    hatCrown.position.set(0, 0.41, -0.02);
    hatCrown.rotation.x = -0.12;
    const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.238, 0.245, 0.05, 16), hatBandMat);
    hatBand.position.set(0, 0.43, -0.02);
    hatBand.rotation.x = -0.12;

    // Ears, Rosy Cheeks, Glossy Eyes with white highlights
    const earL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), skinMat);
    earL.position.set(-0.26, 0.2, 0);
    const earR = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), skinMat);
    earR.position.set(0.26, 0.2, 0);

    const cheekL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), blushMat);
    cheekL.scale.set(1.2, 0.7, 0.4);
    cheekL.position.set(-0.14, 0.16, 0.22);
    const cheekR = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), blushMat);
    cheekR.scale.set(1.2, 0.7, 0.4);
    cheekR.position.set(0.14, 0.16, 0.22);

    const eyeGeo = new THREE.SphereGeometry(0.042, 10, 10);
    const lEye = new THREE.Mesh(eyeGeo, eyeMat);
    lEye.scale.set(0.9, 1.15, 0.55);
    lEye.position.set(-0.09, 0.23, 0.235);
    const lShine = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), eyeShineMat);
    lShine.position.set(-0.078, 0.25, 0.256);

    const rEye = new THREE.Mesh(eyeGeo, eyeMat);
    rEye.scale.set(0.9, 1.15, 0.55);
    rEye.position.set(0.09, 0.23, 0.235);
    const rShine = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), eyeShineMat);
    rShine.position.set(0.102, 0.25, 0.256);

    this.leftEyelid = new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 8), skinMat);
    this.leftEyelid.scale.set(1.0, 1.1, 0.6);
    this.leftEyelid.position.set(-0.09, 0.23, 0.238);
    this.leftEyelid.visible = false;

    this.rightEyelid = new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 8), skinMat);
    this.rightEyelid.scale.set(1.0, 1.1, 0.6);
    this.rightEyelid.position.set(0.09, 0.23, 0.238);
    this.rightEyelid.visible = false;

    this.headGroup.add(
      headMesh,
      hairBack,
      bangL,
      bangR,
      hatBrim,
      hatCrown,
      hatBand,
      earL,
      earR,
      cheekL,
      cheekR,
      lEye,
      lShine,
      rEye,
      rShine,
      this.leftEyelid,
      this.rightEyelid,
    );

    this.bodyPivot.add(
      this.leftHipPivot,
      this.rightHipPivot,
      this.torsoGroup,
      this.leftShoulderPivot,
      this.rightShoulderPivot,
      this.headGroup,
    );

    this.root.traverse((obj) => {
      obj.userData.isNpc = true;
      obj.userData.npcAgentId = this.agentId;
    });

    this.initTools();
    this.root.position.copy(this.targetPos);
  }

  private initTools(): void {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x7c532e, roughness: 0.78 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.72, roughness: 0.26 });
    const blueCanMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.2, roughness: 0.32 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.78, roughness: 0.25 });
    const plankMat = new THREE.MeshStandardMaterial({ color: 0xd6a674, roughness: 0.72 });
    const breadMat = new THREE.MeshStandardMaterial({ color: 0xe3a857, roughness: 0.78 });

    const axe = new THREE.Group();
    const aHandle = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.52, 4, 8), woodMat);
    aHandle.rotation.x = Math.PI * 0.42;
    aHandle.position.set(0, 0.08, 0.16);
    const aHead = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.06, 8), steelMat);
    aHead.rotation.z = Math.PI * 0.5;
    aHead.position.set(0, 0.26, 0.36);
    axe.add(aHandle, aHead);

    const pick = new THREE.Group();
    const pHandle = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.52, 4, 8), woodMat);
    pHandle.rotation.x = Math.PI * 0.42;
    pHandle.position.set(0, 0.08, 0.16);
    const pArc = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 6, 12, Math.PI * 0.7), steelMat);
    pArc.rotation.z = Math.PI * 0.15;
    pArc.rotation.x = Math.PI * 0.4;
    pArc.position.set(0, 0.25, 0.34);
    pick.add(pHandle, pArc);

    const hoe = new THREE.Group();
    const hHandle = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.56, 4, 8), woodMat);
    hHandle.rotation.x = Math.PI * 0.42;
    hHandle.position.set(0, 0.08, 0.17);
    const hHead = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.06), steelMat);
    hHead.position.set(0, 0.22, 0.4);
    hoe.add(hHandle, hHead);

    const can = new THREE.Group();
    const cBody = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.22, 12), blueCanMat);
    const cRim = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 12), brassMat);
    cRim.rotation.x = Math.PI * 0.5;
    cRim.position.y = 0.11;
    const cSpout = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.04, 0.24, 8), blueCanMat);
    cSpout.position.set(0, 0.05, 0.2);
    cSpout.rotation.x = Math.PI * 0.32;
    const cRose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), brassMat);
    cRose.position.set(0, 0.12, 0.3);
    this.canSpoutNode.position.set(0, 0.13, 0.33);
    can.add(cBody, cRim, cSpout, cRose, this.canSpoutNode);

    const block = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), plankMat);
    const food = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.12, 6, 8), breadMat);
    food.rotation.z = Math.PI * 0.5;

    const spear = new THREE.Group();
    const sShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.85, 8), woodMat);
    sShaft.rotation.x = Math.PI * 0.45;
    sShaft.position.set(0, 0.08, 0.24);
    const sTip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.18, 6), steelMat);
    sTip.rotation.x = Math.PI * 0.45;
    sTip.position.set(0, 0.15, 0.66);
    spear.add(sShaft, sTip);

    this.toolMeshes = { axe, pick, hoe, can, block, food, spear };
    for (const mesh of Object.values(this.toolMeshes)) {
      mesh.visible = false;
      mesh.traverse((o) => {
        o.userData.isNpc = true;
        o.userData.npcAgentId = this.agentId;
      });
      this.heldToolGroup.add(mesh);
    }
  }

  public setTargetState(
    pos: { x: number; y: number; z: number },
    yaw: number,
    animation: string,
    targetBlock?: Vec3 | null,
  ): void {
    this.targetPos.set(pos.x, pos.y, pos.z);
    this.targetYaw = yaw;
    this.targetBlock = targetBlock ?? null;
    this.animation = animation || 'idle';

    const toolForAnim: Record<string, string> = {
      chopping: 'axe',
      mining: 'pick',
      tilling: 'hoe',
      harvesting: 'hoe',
      watering: 'can',
      building: 'block',
      eating: 'food',
      drinking: 'can',
      hunting: 'spear',
    };
    const desired = toolForAnim[this.animation] ?? 'none';
    if (desired !== this.currentToolKind) {
      for (const [k, m] of Object.entries(this.toolMeshes)) {
        m.visible = k === desired;
      }
      this.currentToolKind = desired;
    }
  }

  public snapToTarget(): void {
    this.root.position.copy(this.targetPos);
    this.root.rotation.y = this.targetYaw;
  }

  public isWatering(): boolean {
    return this.animation === 'watering';
  }

  public getWaterSpoutWorldPos(out = new THREE.Vector3()): THREE.Vector3 {
    return this.canSpoutNode.getWorldPosition(out);
  }

  public update(dt: number): void {
    this.animClock += dt;
    this.blinkClock += dt;
    const smooth = Math.min(1, dt * 11);

    this.root.position.lerp(this.targetPos, smooth);
    this.root.rotation.y = lerpAngle(this.root.rotation.y, this.targetYaw, smooth);

    const blinkCycle = this.blinkClock % 3.6;
    const isBlinking = this.animation === 'sleeping' || blinkCycle > 3.46;
    this.leftEyelid.visible = isBlinking;
    this.rightEyelid.visible = isBlinking;

    this.bodyPivot.position.set(0, 0, 0);
    this.bodyPivot.rotation.set(0, 0, 0);
    this.torsoGroup.rotation.set(0, 0, 0);
    this.torsoGroup.scale.set(1, 1, 1);
    this.headGroup.rotation.set(0, 0, 0);

    this.leftShoulderPivot.rotation.set(0, 0, 0);
    this.leftElbowPivot.rotation.set(0, 0, 0);
    this.rightShoulderPivot.rotation.set(0, 0, 0);
    this.rightElbowPivot.rotation.set(0, 0, 0);

    this.leftHipPivot.rotation.set(0, 0, 0);
    this.leftKneePivot.rotation.set(0, 0, 0);
    this.rightHipPivot.rotation.set(0, 0, 0);
    this.rightKneePivot.rotation.set(0, 0, 0);

    const t = this.animClock;
    const a = this.animation;

    if (a === 'walking') {
      const cycle = t * 9.5;
      const swing = Math.sin(cycle) * 0.68;
      this.leftHipPivot.rotation.x = swing;
      this.rightHipPivot.rotation.x = -swing;
      this.leftKneePivot.rotation.x = Math.max(0, -Math.cos(cycle)) * 0.65;
      this.rightKneePivot.rotation.x = Math.max(0, Math.cos(cycle)) * 0.65;

      this.leftShoulderPivot.rotation.x = -swing * 0.78;
      this.leftElbowPivot.rotation.x = -0.35 - Math.max(0, swing) * 0.3;
      this.rightShoulderPivot.rotation.x = swing * 0.78;
      this.rightElbowPivot.rotation.x = -0.35 - Math.max(0, -swing) * 0.3;

      this.bodyPivot.position.y = Math.abs(Math.cos(cycle)) * 0.06;
      this.torsoGroup.rotation.y = Math.sin(cycle) * 0.08;
      this.headGroup.rotation.x = 0.04;
    } else if (a === 'chopping' || a === 'mining' || a === 'tilling' || a === 'harvesting') {
      const phase = (t * 1.85) % 1;
      let swing: number;
      if (phase < 0.45) {
        const p = phase / 0.45;
        swing = -0.25 - p * p * 1.45;
      } else if (phase < 0.65) {
        const p = (phase - 0.45) / 0.2;
        swing = -1.7 + p * 2.15;
      } else {
        const p = (phase - 0.65) / 0.35;
        swing = 0.45 - p * 0.7;
      }
      this.rightShoulderPivot.rotation.x = swing;
      this.rightShoulderPivot.rotation.z = -0.18;
      this.rightElbowPivot.rotation.x = -0.38;
      this.leftShoulderPivot.rotation.x = swing * 0.45 - 0.3;
      this.leftElbowPivot.rotation.x = -0.5;
      this.bodyPivot.rotation.x = 0.14 + Math.max(0, swing) * 0.18;
      this.torsoGroup.rotation.y = -0.15 + Math.max(0, swing) * 0.25;
      this.headGroup.rotation.x = 0.22;
    } else if (a === 'hunting') {
      const thrust = Math.sin(t * 7.2);
      this.bodyPivot.rotation.x = 0.16;
      this.rightShoulderPivot.rotation.x = -1.25 + thrust * 0.55;
      this.rightElbowPivot.rotation.x = -0.3 + thrust * 0.25;
      this.leftShoulderPivot.rotation.x = -0.5;
      this.leftElbowPivot.rotation.x = -0.65;
      this.leftHipPivot.rotation.x = -0.18;
      this.rightHipPivot.rotation.x = 0.18;
      this.headGroup.rotation.x = 0.08;
    } else if (a === 'building') {
      const place = Math.sin(t * 7.5);
      this.rightShoulderPivot.rotation.x = -0.85 + place * 0.42;
      this.rightElbowPivot.rotation.x = -0.45;
      this.leftShoulderPivot.rotation.x = -0.55 - place * 0.2;
      this.leftElbowPivot.rotation.x = -0.55;
      this.bodyPivot.rotation.x = 0.12;
      this.headGroup.rotation.x = 0.16;
    } else if (a === 'watering' || a === 'planting') {
      this.bodyPivot.rotation.x = 0.28;
      this.leftHipPivot.rotation.x = -0.22;
      this.leftKneePivot.rotation.x = 0.3;
      this.rightShoulderPivot.rotation.x = -0.78 + Math.sin(t * 4.5) * 0.18;
      this.rightElbowPivot.rotation.x = -0.45;
      this.leftShoulderPivot.rotation.x = -0.4;
      this.leftElbowPivot.rotation.x = -0.4;
      this.headGroup.rotation.x = 0.32;
    } else if (a === 'eating' || a === 'drinking') {
      this.rightShoulderPivot.rotation.x = -1.1 + Math.sin(t * 8.5) * 0.16;
      this.rightShoulderPivot.rotation.z = 0.25;
      this.rightElbowPivot.rotation.x = -0.95;
      this.headGroup.rotation.x = 0.1 + Math.sin(t * 8.5) * 0.08;
    } else if (a === 'sleeping') {
      this.bodyPivot.position.set(0, 0.56, -0.35);
      this.bodyPivot.rotation.x = -Math.PI * 0.5;
      const breathe = Math.sin(t * 1.5) * 0.025;
      this.torsoGroup.scale.set(1, 1, 1 + breathe);
      this.headGroup.rotation.z = 0.08;
    } else if (a === 'thinking') {
      this.rightShoulderPivot.rotation.x = -0.85;
      this.rightShoulderPivot.rotation.z = 0.22;
      this.rightElbowPivot.rotation.x = -1.25;
      this.leftShoulderPivot.rotation.z = 0.08;
      this.headGroup.rotation.y = Math.sin(t * 1.5) * 0.25;
      this.headGroup.rotation.x = -0.06;
    } else {
      const breath = Math.sin(t * 2.1) * 0.03;
      this.leftShoulderPivot.rotation.z = 0.08 + breath;
      this.rightShoulderPivot.rotation.z = -0.08 - breath;
      this.leftElbowPivot.rotation.x = -0.14;
      this.rightElbowPivot.rotation.x = -0.14;
      this.bodyPivot.position.y = Math.sin(t * 2.1) * 0.015;
      this.headGroup.rotation.y = Math.sin(t * 0.8) * 0.14;
    }

    if (this.targetBlock && a !== 'sleeping') {
      const dx = this.targetBlock.x + 0.5 - this.root.position.x;
      const dy = this.targetBlock.y + 0.5 - (this.root.position.y + 1.45);
      const dz = this.targetBlock.z + 0.5 - this.root.position.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz > 0.3 && horiz < 12) {
        const worldYawToTarget = Math.atan2(dx, dz);
        let relYaw = ((worldYawToTarget - this.root.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (relYaw < -Math.PI) relYaw += Math.PI * 2;
        this.headGroup.rotation.y = clamp(relYaw * 0.55, -0.55, 0.55);
        this.headGroup.rotation.x = clamp(-Math.atan2(dy, horiz) * 0.55, -0.45, 0.45);
      }
    }
  }

  public getHeadWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    out.set(this.root.position.x, this.root.position.y + 1.5, this.root.position.z);
    return out;
  }

  public getForwardLookTarget(distance = 8, out = new THREE.Vector3()): THREE.Vector3 {
    const yaw = this.root.rotation.y;
    out.set(
      this.root.position.x + Math.sin(yaw) * distance,
      this.root.position.y + 1.42,
      this.root.position.z + Math.cos(yaw) * distance,
    );
    return out;
  }
}
