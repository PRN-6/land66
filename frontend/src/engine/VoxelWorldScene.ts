import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  BlockId,
  WORLD_DEPTH,
  WORLD_HEIGHT,
  WORLD_VOLUME,
  WORLD_WIDTH,
  blockIndex,
  type BlockUpdate,
  type CameraMode,
  type GodTool,
  type InspectTarget,
  type NpcState,
  type WorldInitMessage,
  type WorldStateSnapshot,
} from '../types/world';
import { createStylizedMaterials, type StylizedMaterials } from './voxelTextures';
import {
  buildWorldMeshes,
  getBlockParticleColor,
  type AnimatedPondFish,
} from './voxelMesher';
import { NpcModel } from './npcModel';
import { EntityManager } from './entityModels';
import { DroppedItemManager } from './droppedItemModels';
import { AtmosphereSystem } from './atmosphere';
import { WorldEffects } from './particles';

export interface SceneCallbacks {
  onSelectTarget: (target: InspectTarget | null) => void;
  onPlaceAt?: (placeCoord: { x: number; y: number; z: number }, hitCoord: { x: number; y: number; z: number }) => void;
  onNpcScreenPos?: (pos: { x: number; y: number; visible: boolean }) => void;
}

export class VoxelWorldScene {
  private container: HTMLElement;
  private callbacks: SceneCallbacks;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  private blocks = new Uint8Array(WORLD_VOLUME);
  private blockMeta = new Uint8Array(WORLD_VOLUME);
  private blockMaterials: string[] = new Array(WORLD_VOLUME).fill('');

  private mats: StylizedMaterials;
  private worldGroup = new THREE.Group();
  private dioramaRoot: THREE.Group | null = null;
  private cropMeshes: THREE.Object3D[] = [];
  private treeCanopies: THREE.Object3D[] = [];
  private pondFish: AnimatedPondFish[] = [];
  private portalMeshes: THREE.Object3D[] = [];

  private agentsGroup = new THREE.Group();
  private agentModels = new Map<string, NpcModel>();
  private selectedAgentId = 'aiden';
  private lastSnapshot: WorldStateSnapshot | null = null;

  private entityManager: EntityManager;
  private droppedItemManager: DroppedItemManager;
  private atmosphere: AtmosphereSystem;
  private effects: WorldEffects;

  private hoverCursor: THREE.LineSegments;
  private activeTool: GodTool = { mode: 'inspect' };

  private cameraMode: CameraMode = 'orbit';
  private showPath = false;
  private timeOfDay = 0.35;
  private weather = 'clear';
  private needsRebuild = false;
  private rafId = 0;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private waterEmitAccum = 0;

  private raycaster = new THREE.Raycaster();
  private pointerDownPos = { x: 0, y: 0 };
  private projVec = new THREE.Vector3();
  private headVec = new THREE.Vector3();
  private lookVec = new THREE.Vector3();
  private spoutVec = new THREE.Vector3();
  private followOffset = new THREE.Vector3(8.5, 6.5, 8.5);
  private prevNpcPos = new THREE.Vector3(15.5, 11, 15.5);

  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, callbacks: SceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(44, w / h, 0.15, 360);
    this.camera.position.set(39, 27, 40);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const dpr = Math.min(window.devicePixelRatio, 1.75);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.45, 0.92);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(16, 11, 16);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 88;
    this.controls.maxPolarAngle = Math.PI * 0.92;
    this.controls.update();

    this.mats = createStylizedMaterials();

    this.scene.add(this.worldGroup);
    this.agentsGroup.name = 'ai_agents';
    this.scene.add(this.agentsGroup);
    this.entityManager = new EntityManager(this.scene);
    this.droppedItemManager = new DroppedItemManager(this.scene);

    this.atmosphere = new AtmosphereSystem(this.scene);
    this.atmosphere.setWaterNormalMap(this.mats.waterNormalMap);
    this.effects = new WorldEffects(this.scene);

    this.hoverCursor = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }),
    );
    this.hoverCursor.visible = false;
    this.scene.add(this.hoverCursor);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.animate();
  }

  private getSelectedModel(): NpcModel | null {
    return (
      this.agentModels.get(this.selectedAgentId) ??
      this.agentModels.get('aiden') ??
      this.agentModels.values().next().value ??
      null
    );
  }

  private handleResize = (): void => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  };

  private raycastBlockHit(
    clientX: number,
    clientY: number,
  ): {
    hitKind: 'npc' | 'entity' | 'dropped_item' | 'block';
    agentId?: string;
    entityId?: string;
    droppedItemId?: string;
    hitCoord?: { x: number; y: number; z: number };
    placeCoord?: { x: number; y: number; z: number };
  } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    const targets: THREE.Object3D[] = [this.agentsGroup, this.entityManager.group, this.droppedItemManager.group];
    if (this.dioramaRoot) targets.push(this.dioramaRoot);

    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return null;

    const hit = hits[0];
    if (hit.object.userData.isNpc) {
      return {
        hitKind: 'npc',
        agentId: String(hit.object.userData.npcAgentId ?? 'aiden'),
      };
    }
    if (hit.object.userData.entityId) {
      return { hitKind: 'entity', entityId: String(hit.object.userData.entityId) };
    }
    if (hit.object.userData.droppedItemId) {
      return { hitKind: 'dropped_item', droppedItemId: String(hit.object.userData.droppedItemId) };
    }
    if (hit.object.userData.blockCoord) {
      const coord = hit.object.userData.blockCoord as { x: number; y: number; z: number };
      const placeCoord = { x: coord.x, y: Math.min(WORLD_HEIGHT - 1, coord.y + 1), z: coord.z };
      return { hitKind: 'block', hitCoord: coord, placeCoord };
    }

    const normal = hit.face?.normal ?? new THREE.Vector3(0, 1, 0);
    const pIn = hit.point.clone().addScaledVector(normal, -0.08);
    const bx = Math.floor(pIn.x);
    const by = Math.floor(pIn.y);
    const bz = Math.floor(pIn.z);
    if (bx >= 0 && bx < WORLD_WIDTH && by >= 0 && by < WORLD_HEIGHT && bz >= 0 && bz < WORLD_DEPTH) {
      const b = this.blocks[blockIndex(bx, by, bz)];
      if (b !== BlockId.AIR) {
        const pOut = hit.point.clone().addScaledVector(normal, 0.18);
        const px = Math.max(0, Math.min(WORLD_WIDTH - 1, Math.floor(pOut.x)));
        const py = Math.max(0, Math.min(WORLD_HEIGHT - 1, Math.floor(pOut.y)));
        const pz = Math.max(0, Math.min(WORLD_DEPTH - 1, Math.floor(pOut.z)));
        return {
          hitKind: 'block',
          hitCoord: { x: bx, y: by, z: bz },
          placeCoord: { x: px, y: py, z: pz },
        };
      }
    }
    return null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.activeTool.mode === 'inspect' || this.cameraMode === 'pov') {
      this.hoverCursor.visible = false;
      return;
    }
    const res = this.raycastBlockHit(e.clientX, e.clientY);
    if (!res || res.hitKind !== 'block') {
      this.hoverCursor.visible = false;
      return;
    }
    const target = this.activeTool.mode === 'erase' ? res.hitCoord : res.placeCoord;
    if (!target) {
      this.hoverCursor.visible = false;
      return;
    }
    this.hoverCursor.visible = true;
    this.hoverCursor.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.cameraMode === 'pov') return;
    const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
    if (dist > 5) return;

    const res = this.raycastBlockHit(e.clientX, e.clientY);

    if (this.activeTool.mode !== 'inspect') {
      if (res && res.hitKind === 'block' && res.hitCoord && res.placeCoord) {
        this.callbacks.onPlaceAt?.(res.placeCoord, res.hitCoord);
      }
      return;
    }

    if (!res) {
      this.callbacks.onSelectTarget(null);
      return;
    }
    if (res.hitKind === 'npc') {
      this.callbacks.onSelectTarget({ kind: 'npc', agentId: res.agentId ?? 'aiden' });
      return;
    }
    if (res.hitKind === 'entity' && res.entityId) {
      const ent = this.entityManager.getEntityById(res.entityId);
      this.callbacks.onSelectTarget(ent ? { kind: 'entity', entity: ent } : null);
      return;
    }
    if (res.hitKind === 'dropped_item' && res.droppedItemId) {
      const droppedItem = this.droppedItemManager.getItemById(res.droppedItemId);
      this.callbacks.onSelectTarget(droppedItem ? { kind: 'dropped_item', droppedItem } : null);
      return;
    }
    if (res.hitCoord) {
      const idx = blockIndex(res.hitCoord.x, res.hitCoord.y, res.hitCoord.z);
      this.callbacks.onSelectTarget({
        kind: 'block',
        x: res.hitCoord.x,
        y: res.hitCoord.y,
        z: res.hitCoord.z,
        block: this.blocks[idx],
        meta: this.blockMeta[idx],
        material: this.blockMaterials[idx] || undefined,
      });
    }
  };

  public setGodTool(tool: GodTool): void {
    this.activeTool = tool;
    if (tool.mode === 'inspect') {
      this.hoverCursor.visible = false;
      this.renderer.domElement.style.cursor = 'grab';
    } else {
      this.renderer.domElement.style.cursor = 'crosshair';
      (this.hoverCursor.material as THREE.LineBasicMaterial).color.setHex(
        tool.mode === 'erase' ? 0xf87171 : 0xffffff,
      );
    }
  }

  public setSelectedAgent(agentId: string): void {
    this.selectedAgentId = agentId;
    for (const [id, m] of this.agentModels) {
      m.root.visible = !(this.cameraMode === 'pov' && id === this.selectedAgentId);
    }
    const sel = this.getSelectedModel();
    if (sel) {
      this.prevNpcPos.copy(sel.root.position);
      if (this.cameraMode === 'follow') {
        this.controls.target.set(sel.root.position.x, sel.root.position.y + 1.1, sel.root.position.z);
        this.camera.position.copy(this.controls.target).add(this.followOffset);
      }
    }
    if (this.lastSnapshot) {
      this.refreshSelectionEffects(this.lastSnapshot);
    }
  }

  public applyWorldInit(msg: WorldInitMessage): void {
    this.blocks.fill(0);
    this.blockMeta.fill(0);
    this.blockMaterials.fill('');
    const len = Math.min(WORLD_VOLUME, msg.blocks.length);
    for (let i = 0; i < len; i++) {
      this.blocks[i] = msg.blocks[i] ?? 0;
      this.blockMeta[i] = msg.block_meta?.[i] ?? 0;
      this.blockMaterials[i] = msg.block_materials?.[i] ?? '';
    }
    this.needsRebuild = true;
    const validIds = new Set(
      (msg.state.agents && msg.state.agents.length > 0 ? msg.state.agents : [msg.state.npc]).map(
        (a, i) => a.id ?? (i === 0 ? 'aiden' : `npc-${i + 1}`),
      ),
    );
    if (!validIds.has(this.selectedAgentId)) {
      this.selectedAgentId = msg.state.npc?.id ?? msg.state.agents?.[0]?.id ?? 'aiden';
    }
    this.applyState(msg.state, true);
  }

  public applyTickUpdate(blockUpdates: BlockUpdate[], state: WorldStateSnapshot): void {
    let changed = false;
    for (const u of blockUpdates) {
      if (u.x < 0 || u.x >= WORLD_WIDTH || u.y < 0 || u.y >= WORLD_HEIGHT || u.z < 0 || u.z >= WORLD_DEPTH) {
        continue;
      }
      const idx = blockIndex(u.x, u.y, u.z);
      const oldBlock = this.blocks[idx];
      const newBlock = u.block;
      const newMeta = u.meta ?? 0;
      const hasMat = Object.prototype.hasOwnProperty.call(u, 'material');
      const nextMat = hasMat ? (u.material ?? '') : oldBlock !== newBlock ? '' : this.blockMaterials[idx];
      if (oldBlock !== newBlock || this.blockMeta[idx] !== newMeta || this.blockMaterials[idx] !== nextMat) {
        this.blocks[idx] = newBlock;
        this.blockMeta[idx] = newMeta;
        this.blockMaterials[idx] = nextMat;
        changed = true;

        const burstBlock = newBlock === BlockId.AIR ? oldBlock : newBlock;
        const burstMat = newBlock === BlockId.AIR ? '' : nextMat;
        if (burstBlock !== BlockId.AIR) {
          this.effects.spawnBlockBurst(u.x, u.y, u.z, getBlockParticleColor(burstBlock, burstMat), 6);
        }
      }
    }
    if (changed) {
      this.needsRebuild = true;
    }
    this.applyState(state, false);
  }

  private refreshSelectionEffects(state: WorldStateSnapshot): void {
    const list: NpcState[] = state.agents && state.agents.length > 0 ? state.agents : [state.npc];
    const selected =
      list.find((a) => (a.id ?? 'aiden') === this.selectedAgentId) ?? list[0];
    if (selected) {
      this.effects.setTargetBlock(selected.target_block ?? null);
      this.effects.setPath(selected.path ?? [], this.showPath);
    }
  }

  private applyState(state: WorldStateSnapshot, snapNpc: boolean): void {
    this.lastSnapshot = state;
    this.timeOfDay = state.time_of_day;
    this.weather = state.weather;

    const list: NpcState[] = state.agents && state.agents.length > 0 ? state.agents : [state.npc];
    const activeIds = new Set<string>();

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const aid = a.id ?? (i === 0 ? 'aiden' : `npc-${i + 1}`);
      activeIds.add(aid);
      let model = this.agentModels.get(aid);
      if (!model) {
        model = new NpcModel(a.variant ?? i, aid);
        this.agentsGroup.add(model.root);
        this.agentModels.set(aid, model);
        model.setTargetState(a.position, a.yaw, a.animation, a.target_block ?? null);
        model.snapToTarget();
      } else {
        model.setTargetState(a.position, a.yaw, a.animation, a.target_block ?? null);
        if (snapNpc) {
          model.snapToTarget();
        }
      }
      model.root.visible = !(this.cameraMode === 'pov' && aid === this.selectedAgentId);
    }

    for (const [id, model] of this.agentModels) {
      if (!activeIds.has(id)) {
        this.agentsGroup.remove(model.root);
        this.agentModels.delete(id);
      }
    }

    if (snapNpc) {
      const sel = this.getSelectedModel();
      if (sel) this.prevNpcPos.copy(sel.root.position);
    }

    this.entityManager.sync(state.entities ?? []);
    this.droppedItemManager.sync(state.dropped_items ?? []);
    this.refreshSelectionEffects(state);
  }

  private rebuildMeshes(): void {
    if (this.dioramaRoot) {
      this.dioramaRoot.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh) {
          obj.dispose();
        }
      });
      this.worldGroup.remove(this.dioramaRoot);
    }

    const built = buildWorldMeshes(this.blocks, this.blockMeta, this.mats.waterNormalMap, this.blockMaterials);
    this.dioramaRoot = built.group;
    this.cropMeshes = built.cropMeshes;
    this.treeCanopies = built.treeCanopies;
    this.pondFish = built.pondFish;
    this.portalMeshes = built.portalMeshes;

    this.worldGroup.add(this.dioramaRoot);
    this.atmosphere.setWorldAnchors(built.torchPositions, built.foliagePositions, built.mistOrigins);
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    for (const [id, model] of this.agentModels) {
      model.root.visible = !(mode === 'pov' && id === this.selectedAgentId);
    }
    if (mode === 'pov') {
      this.controls.enabled = false;
      this.hoverCursor.visible = false;
    } else {
      this.controls.enabled = true;
      if (mode === 'follow') {
        const sel = this.getSelectedModel();
        if (sel) {
          const pos = sel.root.position;
          this.controls.target.set(pos.x, pos.y + 1.1, pos.z);
          this.camera.position.copy(this.controls.target).add(this.followOffset);
        }
      }
    }
  }

  public focusPreset(preset: 'overview' | 'npc'): void {
    if (preset === 'overview') {
      this.setCameraMode('orbit');
      this.controls.target.set(16, 10.5, 16);
      this.camera.position.set(39, 27, 40);
      this.controls.update();
    } else {
      this.setCameraMode('follow');
      const sel = this.getSelectedModel();
      if (sel) {
        const pos = sel.root.position;
        this.controls.target.set(pos.x, pos.y + 1.1, pos.z);
        this.camera.position.set(pos.x + 6.5, pos.y + 5.2, pos.z + 6.5);
        this.controls.update();
      }
    }
  }

  public setShowPath(show: boolean): void {
    this.showPath = show;
    if (this.lastSnapshot) {
      this.refreshSelectionEffects(this.lastSnapshot);
    }
  }

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.elapsed += dt;

    if (this.needsRebuild) {
      this.rebuildMeshes();
      this.needsRebuild = false;
    }

    for (const model of this.agentModels.values()) {
      model.update(dt);
      if (model.isWatering()) {
        this.waterEmitAccum += dt;
        if (this.waterEmitAccum >= 0.14) {
          this.waterEmitAccum = 0;
          model.getWaterSpoutWorldPos(this.spoutVec);
          this.effects.spawnWaterDroplets(this.spoutVec, 2);
        }
      }
    }
    this.entityManager.update(dt);
    this.droppedItemManager.update(dt, (bx, by, bz, colorHex) => {
      this.effects.spawnBlockBurst(bx, by, bz, colorHex, 8);
    });

    this.atmosphere.update(dt, this.elapsed, this.timeOfDay, this.weather, this.scene);
    this.effects.update(dt, this.elapsed);

    for (let i = 0; i < this.cropMeshes.length; i++) {
      this.cropMeshes[i].rotation.z = Math.sin(this.elapsed * 2.2 + i * 0.7) * 0.05;
    }
    for (let i = 0; i < this.treeCanopies.length; i++) {
      this.treeCanopies[i].rotation.z = Math.sin(this.elapsed * 1.1 + i * 1.3) * 0.02;
      this.treeCanopies[i].rotation.x = Math.cos(this.elapsed * 0.9 + i * 0.9) * 0.015;
    }
    for (let i = 0; i < this.portalMeshes.length; i++) {
      const pm = this.portalMeshes[i];
      pm.rotation.x = this.elapsed * 1.6;
      const pulse = 0.85 + Math.sin(this.elapsed * 3.2) * 0.14;
      pm.scale.set(0.24, 0.52 * pulse, 0.52 * pulse);
    }

    for (const f of this.pondFish) {
      const ang = this.elapsed * f.speed + f.phase;
      const nx = f.centerX + Math.cos(ang) * f.radius;
      const nz = f.centerZ + Math.sin(ang) * f.radius;
      f.mesh.position.set(nx, f.y + Math.sin(this.elapsed * 3 + f.phase) * 0.02, nz);
      f.mesh.rotation.y = -ang;
    }

    const sel = this.getSelectedModel();
    if (sel) {
      const npcPos = sel.root.position;
      if (this.cameraMode === 'pov') {
        sel.getHeadWorldPosition(this.headVec);
        sel.getForwardLookTarget(10, this.lookVec);
        this.camera.position.copy(this.headVec);
        this.camera.lookAt(this.lookVec);
      } else {
        if (this.cameraMode === 'follow') {
          const deltaX = npcPos.x - this.prevNpcPos.x;
          const deltaY = npcPos.y - this.prevNpcPos.y;
          const deltaZ = npcPos.z - this.prevNpcPos.z;
          this.controls.target.set(npcPos.x, npcPos.y + 1.1, npcPos.z);
          this.camera.position.x += deltaX;
          this.camera.position.y += deltaY;
          this.camera.position.z += deltaZ;
        }
        this.controls.update();
      }
      this.prevNpcPos.copy(npcPos);

      if (this.callbacks.onNpcScreenPos) {
        if (this.cameraMode === 'pov') {
          this.callbacks.onNpcScreenPos({ x: 0, y: 0, visible: false });
        } else {
          this.projVec.set(npcPos.x, npcPos.y + 2.2, npcPos.z);
          this.projVec.project(this.camera);
          const visible = this.projVec.z >= -1 && this.projVec.z <= 1;
          const x = (this.projVec.x * 0.5 + 0.5) * this.container.clientWidth;
          const y = (-this.projVec.y * 0.5 + 0.5) * this.container.clientHeight;
          this.callbacks.onNpcScreenPos({ x, y, visible });
        }
      }
    } else {
      this.controls.update();
    }

    this.composer.render();
  };

  public dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.mats.waterNormalMap.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
