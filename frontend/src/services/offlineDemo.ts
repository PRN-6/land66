import { getWorldMaterial } from '../engine/materialCatalog';
import {
  BlockId,
  WORLD_DEPTH,
  WORLD_HEIGHT,
  WORLD_VOLUME,
  WORLD_WIDTH,
  blockIndex,
  type AgentRole,
  type BlockUpdate,
  type DayPhase,
  type EntityKind,
  type LlmConfig,
  type LlmTrace,
  type NpcState,
  type SaveSlotSummary,
  type SimSpeed,
  type WeatherType,
  type WorldEntity,
  type WorldInitMessage,
  type WorldSavePayload,
  type WorldStateSnapshot,
} from '../types/world';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2D(x: number, z: number, seed: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise2D(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);

  const n00 = hash2D(xi, zi, seed);
  const n10 = hash2D(xi + 1, zi, seed);
  const n01 = hash2D(xi, zi + 1, seed);
  const n11 = hash2D(xi + 1, zi + 1, seed);

  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return nx0 + v * (nx1 - nx0);
}

function phaseFromTime(t: number): DayPhase {
  if (t < 0.22) return 'night';
  if (t < 0.3) return 'dawn';
  if (t < 0.52) return 'morning';
  if (t < 0.72) return 'afternoon';
  if (t < 0.84) return 'evening';
  return 'night';
}

function formatClock(t: number): string {
  const totalMinutes = Math.floor((((t % 1) + 1) % 1) * 24 * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const OBJECT_NAME_MAP: Record<string, number> = {
  grass: BlockId.GRASS,
  dirt: BlockId.DIRT,
  stone: BlockId.STONE,
  water: BlockId.WATER,
  wood_log: BlockId.WOOD_LOG,
  leaves: BlockId.LEAVES,
  wood_plank: BlockId.WOOD_PLANK,
  cobblestone: BlockId.COBBLESTONE,
  glass: BlockId.GLASS,
  door_closed: BlockId.DOOR_CLOSED,
  door: BlockId.DOOR_CLOSED,
  bed: BlockId.BED,
  chest: BlockId.CHEST,
  crafting_bench: BlockId.CRAFTING_BENCH,
  torch: BlockId.TORCH,
  lantern: BlockId.TORCH,
  farmland: BlockId.FARMLAND,
  crop_wheat: BlockId.CROP_WHEAT,
  wheat: BlockId.CROP_WHEAT,
  wild_berry: BlockId.WILD_BERRY,
  berry: BlockId.WILD_BERRY,
  sapling: BlockId.SAPLING,
  roof_shingle: BlockId.ROOF_SHINGLE,
  roof: BlockId.ROOF_SHINGLE,
  fence: BlockId.FENCE,
};

const DEFAULT_NAMES: Record<string, string[]> = {
  companion: ['Elena', 'Rowan', 'Maya', 'Soren'],
  villager: ['Clara', 'Leo', 'Nora', 'Finn'],
  cat: ['Mochi', 'Yuzu', 'Biscuit', 'Luna'],
  fox: ['Rusty', 'Maple', 'Ember', 'Pip'],
  sheep: ['Cloud', 'Bramble', 'Puff', 'Cotton'],
  deer: ['Willow', 'Fern', 'Bambi', 'Aspen'],
  duck: ['Puddle', 'Quack', 'Sunny', 'Pippin'],
};

interface DemoEntity extends WorldEntity {
  target: [number, number, number] | null;
  wait: number;
}

interface DemoAgent extends NpcState {
  id: string;
  role: string;
  variant: number;
  target: [number, number, number] | null;
  wait: number;
  llmConfig: LlmConfig;
}

const AGENT_NAMES = ['Elena', 'Rowan', 'Maya', 'Soren', 'Clara', 'Leo', 'Nora'];

export class OfflineDemoSimulator {
  private blocks = new Uint8Array(WORLD_VOLUME);
  private blockMeta = new Uint8Array(WORLD_VOLUME);
  private blockMaterials: string[] = new Array(WORLD_VOLUME).fill('');
  private rng = mulberry32(6601);
  private state: WorldStateSnapshot;
  private surfaceY = new Int8Array(WORLD_WIDTH * WORLD_DEPTH);
  private waypoints: Array<{ x: number; z: number; action: string; goal: string; thought: string }> = [];
  private waypointIdx = 0;
  private actionTimer = 0;
  private buildQueue: Array<{ x: number; y: number; z: number; block: number; meta?: number }> = [];
  private farmQueue: Array<{ x: number; y: number; z: number }> = [];
  private demoEntities: DemoEntity[] = [];
  private extraAgents: DemoAgent[] = [];
  private entityCounter = 0;
  private agentCounter = 1;
  private traceCounter = 0;

  constructor(seed = 6601) {
    this.state = this.createInitialState(seed);
    this.generateIsland(seed);
  }

  private createInitialState(seed: number): WorldStateSnapshot {
    return {
      tick: 0,
      day: 1,
      time_of_day: 0.27,
      clock_str: formatClock(0.27),
      phase: phaseFromTime(0.27),
      weather: 'clear',
      paused: false,
      speed: 1,
      seed,
      npc: {
        id: 'aiden',
        name: 'Aiden',
        role: 'pioneer',
        variant: 0,
        position: { x: 15.5, y: 12, z: 15.5 },
        grid_pos: { x: 15, y: 12, z: 15 },
        yaw: 0.4,
        animation: 'thinking',
        action_progress: 0,
        current_action: 'inspect_surroundings',
        current_goal: 'Survey the forested floating island and find fresh water',
        thought: 'I just woke up on a floating island covered in trees. No shelter yet—I should explore first.',
        needs: {
          hunger: 88,
          energy: 92,
          thirst: 85,
          health: 100,
          mood: 78,
        },
        inventory: {
          wood_log: 0,
          wood_plank: 0,
          stone: 0,
          seeds: 2,
          wheat: 0,
          berries: 1,
          sapling: 1,
          bread: 0,
        },
        target_block: null,
        path: [],
        perception: {
          location_label: 'Dense Forest Clearing',
          sheltered: false,
          visible_summary:
            'Tall trees surround me. A freshwater pond glimmers nearby and wild berries grow along the clearing.',
          nearby_entities: [],
        },
        memories: [
          { day: 1, clock: '06:28', text: 'Awakened on a floating woodland island surrounded by clouds.' },
        ],
        journal: [
          { day: 1, clock: '06:30', text: 'Day 1: Everything is untamed forest. First priority is water, wood, and a home.' },
        ],
      },
      stats: {
        trees_count: 0,
        house_progress: 0,
        house_stage: 'not_started',
        house_bounds: null,
        farm_plots: 0,
        crops_growing: 0,
        crops_ripe: 0,
        blocks_placed: 0,
        blocks_broken: 0,
        entities_count: 0,
      },
      entities: [],
      llm_status: {
        provider: 'fallback',
        model: 'offline-demo-sim',
        thinking: false,
        last_latency_ms: 12,
        calls_count: 1,
        fallback_active: true,
        last_error: 'Running local Offline Preview (start backend at :8000 for live AI brain)',
      },
    };
  }

  public getInitMessage(): WorldInitMessage {
    return {
      type: 'world_init',
      dimensions: { width: WORLD_WIDTH, height: WORLD_HEIGHT, depth: WORLD_DEPTH },
      index_formula: 'y * width * depth + z * width + x',
      blocks: Array.from(this.blocks),
      block_meta: Array.from(this.blockMeta),
      block_materials: Array.from(this.blockMaterials),
      state: this.getState(),
    };
  }

  public getState(): WorldStateSnapshot {
    this.state.entities = this.demoEntities.map(({ target: _t, wait: _w, ...rest }) => rest);
    this.state.stats.entities_count = this.demoEntities.length;
    const primaryAgent: NpcState = {
      ...this.state.npc,
      id: 'aiden',
      role: 'pioneer',
      variant: 0,
      llm_status: this.state.llm_status,
    };
    const extras: NpcState[] = this.extraAgents.map(
      ({ target: _t, wait: _w, llmConfig: _cfg, ...rest }) => rest,
    );
    this.state.agents = [primaryAgent, ...extras];
    this.state.stats.agents_count = this.state.agents.length;
    return structuredClone(this.state);
  }

  public reset(seed = Math.floor(Math.random() * 9000) + 1000): WorldInitMessage {
    this.state = this.createInitialState(seed);
    this.demoEntities = [];
    this.extraAgents = [];
    this.entityCounter = 0;
    this.agentCounter = 1;
    this.generateIsland(seed);
    return this.getInitMessage();
  }

  public addAgent(opts: { name?: string; role?: AgentRole; x?: number; y?: number; z?: number }): NpcState {
    this.agentCounter += 1;
    const id = `npc-${this.agentCounter}`;
    const role = opts.role ?? 'pioneer';
    const name = (opts.name ?? '').trim() || AGENT_NAMES[(this.agentCounter - 2) % AGENT_NAMES.length];
    const ax = opts.x ?? Math.max(5, Math.min(26, this.state.npc.grid_pos.x + 2));
    const az = opts.z ?? Math.max(5, Math.min(26, this.state.npc.grid_pos.z + 1));
    const ay = opts.y ?? Math.max(10, this.surfaceTopAt(ax, az) + 1);
    const ag: DemoAgent = {
      id,
      name,
      role,
      variant: this.agentCounter - 1,
      position: { x: ax, y: ay, z: az },
      grid_pos: { x: ax, y: ay, z: az },
      yaw: this.rng() * Math.PI * 2,
      animation: 'idle',
      action_progress: 0,
      current_action: 'explore',
      current_goal: `Assist the island as ${role}`,
      thought: `Joined the island as ${name} (${role}). Ready to work alongside Aiden.`,
      needs: { hunger: 90, energy: 95, thirst: 90, health: 100, mood: 85 },
      inventory: { wood_log: 0, wood_plank: 0, stone: 0, seeds: 1, wheat: 0, berries: 1, sapling: 0, bread: 0 },
      target_block: null,
      path: [],
      perception: {
        location_label: 'Island Clearing',
        sheltered: false,
        visible_summary: 'Exploring the floating island.',
        nearby_entities: [],
      },
      memories: [{ day: this.state.day, clock: this.state.clock_str, text: `Arrived on the island as ${role}.` }],
      journal: [],
      llm_status: {
        provider: 'fallback',
        model: 'offline-demo-sim',
        thinking: false,
        last_latency_ms: 8,
        calls_count: 1,
        fallback_active: true,
        last_error: null,
      },
      target: null,
      wait: 0.8,
      llmConfig: {
        provider: 'fallback',
        model: 'offline-demo-sim',
        base_url: '',
        temperature: 0.7,
        decision_interval_ticks: 25,
        enabled: false,
      },
    };
    this.extraAgents.push(ag);
    return ag;
  }

  public removeAgent(agentId: string): void {
    this.extraAgents = this.extraAgents.filter((a) => a.id !== agentId);
  }

  private setBlock(x: number, y: number, z: number, block: number, meta = 0, material = ''): void {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH) return;
    const idx = blockIndex(x, y, z);
    this.blocks[idx] = block;
    this.blockMeta[idx] = meta;
    this.blockMaterials[idx] = block === BlockId.AIR ? '' : material;
  }

  private getBlock(x: number, y: number, z: number): number {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH) return 0;
    return this.blocks[blockIndex(x, y, z)];
  }

  private surfaceTopAt(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 2; y >= 1; y--) {
      const b = this.getBlock(x, y, z);
      if (b !== BlockId.AIR && b !== BlockId.LEAVES && b !== BlockId.WOOD_LOG) {
        return y;
      }
    }
    return this.surfaceY[z * WORLD_WIDTH + x];
  }

  private generateIsland(seed: number): void {
    this.blocks.fill(BlockId.AIR);
    this.blockMeta.fill(0);
    this.blockMaterials.fill('');
    this.surfaceY.fill(-1);
    this.rng = mulberry32(seed);
    this.actionTimer = 0;
    this.buildQueue = [];
    this.farmQueue = [];

    const cx = 15.5;
    const cz = 15.5;
    const pondCx = 20;
    const pondCz = 19;

    for (let z = 0; z < WORLD_DEPTH; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const dx = (x - cx) / 12.8;
        const dz = (z - cz) / 12.5;
        const nEdge = (valueNoise2D(x * 0.17, z * 0.17, seed) - 0.5) * 0.32;
        const dist = Math.sqrt(dx * dx + dz * dz) + nEdge;
        if (dist > 1.0) continue;

        const radialFactor = Math.max(0, 1 - dist * dist);
        const hNoise = valueNoise2D(x * 0.12 + 11, z * 0.12 + 23, seed);
        const topY = Math.round(10 + radialFactor * 1.4 + (hNoise - 0.5) * 1.8);
        const depth = Math.max(
          2,
          Math.round(2 + radialFactor * 6.5 + valueNoise2D(x * 0.25, z * 0.25, seed + 99) * 2.2),
        );
        const bottomY = Math.max(2, topY - depth);

        for (let y = bottomY; y <= topY; y++) {
          if (y === topY) {
            this.setBlock(x, y, z, BlockId.GRASS, 0, dist > 0.58 ? 'forest_grass' : 'meadow_grass');
          } else if (y >= topY - 2) {
            this.setBlock(x, y, z, BlockId.DIRT);
          } else {
            const deepMat = y <= 4 ? 'obsidian' : y === 5 && (x + z) % 7 === 0 ? 'sunstone' : y < 7 ? 'slate' : 'granite';
            this.setBlock(x, y, z, BlockId.STONE, 0, deepMat);
          }
        }
        this.surfaceY[z * WORLD_WIDTH + x] = topY;
      }
    }

    for (let z = pondCz - 2; z <= pondCz + 2; z++) {
      for (let x = pondCx - 2; x <= pondCx + 2; x++) {
        const pd = Math.hypot(x - pondCx, z - pondCz);
        const sy = this.surfaceY[z * WORLD_WIDTH + x];
        if (sy > 0 && pd <= 2.3) {
          const waterY = Math.min(sy, 10);
          for (let y = waterY + 1; y <= sy; y++) {
            this.setBlock(x, y, z, BlockId.AIR);
          }
          this.setBlock(x, waterY, z, BlockId.WATER);
          this.setBlock(x, waterY - 1, z, BlockId.DIRT, 0, x % 2 === 0 ? 'clay_bank' : 'sandy_bank');
          this.surfaceY[z * WORLD_WIDTH + x] = waterY;
        } else if (sy > 0 && pd <= 3.1 && this.getBlock(x, sy, z) === BlockId.GRASS) {
          this.setBlock(x, sy, z, BlockId.DIRT, 0, x > pondCx ? 'sandy_bank' : 'clay_bank');
        }
      }
    }

    let treeCount = 0;
    const boulderMats = ['granite', 'mossy_stone', 'iron_vein', 'coal_vein', 'gold_vein', 'crystal_vein', 'copper_vein', 'marble'];
    let boulderIdx = 0;
    const treePositions: Array<{ x: number; z: number }> = [];
    for (let z = 4; z < WORLD_DEPTH - 4; z++) {
      for (let x = 4; x < WORLD_WIDTH - 4; x++) {
        const sy = this.surfaceY[z * WORLD_WIDTH + x];
        if (sy <= 0) continue;
        if (this.getBlock(x, sy, z) !== BlockId.GRASS) continue;
        if (Math.hypot(x - 15.5, z - 15.5) < 2.2) continue;
        if (Math.hypot(x - pondCx, z - pondCz) < 3.4) continue;

        const tooClose = treePositions.some((tp) => Math.hypot(tp.x - x, tp.z - z) < 3.1);
        const r = this.rng();
        if (!tooClose && r < 0.18) {
          this.placeTree(x, sy + 1, z);
          treePositions.push({ x, z });
          treeCount++;
        } else if (r >= 0.18 && r < 0.215) {
          this.setBlock(x, sy + 1, z, BlockId.WILD_BERRY);
        } else if (r >= 0.215 && r < 0.242) {
          this.setBlock(x, sy + 1, z, BlockId.STONE, 0, boulderMats[boulderIdx % boulderMats.length]);
          boulderIdx += 1;
        }
      }
    }

    const spawnSy = Math.max(10, this.surfaceY[15 * WORLD_WIDTH + 15]);
    this.state.npc.position = { x: 15.5, y: spawnSy + 1, z: 15.5 };
    this.state.npc.grid_pos = { x: 15, y: spawnSy + 1, z: 15 };
    this.state.stats.trees_count = treeCount;

    const hx = 10;
    const hz = 11;
    const hy = Math.max(10, this.surfaceY[hz * WORLD_WIDTH + hx]) + 1;
    for (let x = hx; x <= hx + 4; x++) {
      for (let z = hz; z <= hz + 4; z++) {
        this.buildQueue.push({ x, y: hy - 1, z, block: BlockId.COBBLESTONE });
      }
    }
    for (let y = hy; y <= hy + 2; y++) {
      for (let x = hx; x <= hx + 4; x++) {
        for (let z = hz; z <= hz + 4; z++) {
          const isEdge = x === hx || x === hx + 4 || z === hz || z === hz + 4;
          if (!isEdge) continue;
          if (x === hx + 2 && z === hz + 4 && y <= hy + 1) {
            if (y === hy) this.buildQueue.push({ x, y, z, block: BlockId.DOOR_CLOSED });
            continue;
          }
          if (y === hy + 1 && ((x === hx && z === hz + 2) || (x === hx + 4 && z === hz + 2))) {
            this.buildQueue.push({ x, y, z, block: BlockId.GLASS });
          } else {
            this.buildQueue.push({ x, y, z, block: BlockId.WOOD_PLANK });
          }
        }
      }
    }
    for (let x = hx - 1; x <= hx + 5; x++) {
      for (let z = hz - 1; z <= hz + 5; z++) {
        const edge = x === hx - 1 || x === hx + 5 || z === hz - 1 || z === hz + 5;
        this.buildQueue.push({
          x,
          y: edge ? hy + 3 : hy + 4,
          z,
          block: BlockId.ROOF_SHINGLE,
        });
      }
    }
    this.buildQueue.push({ x: hx + 1, y: hy, z: hz + 1, block: BlockId.BED });
    this.buildQueue.push({ x: hx + 3, y: hy, z: hz + 1, block: BlockId.CHEST });
    this.buildQueue.push({ x: hx + 1, y: hy, z: hz + 3, block: BlockId.CRAFTING_BENCH });
    this.buildQueue.push({ x: hx + 3, y: hy + 1, z: hz + 3, block: BlockId.TORCH });

    for (let x = 16; x <= 18; x++) {
      for (let z = 18; z <= 20; z++) {
        const fsy = this.surfaceY[z * WORLD_WIDTH + x];
        if (fsy > 0 && this.getBlock(x, fsy, z) === BlockId.GRASS) {
          this.farmQueue.push({ x, y: fsy, z });
        }
      }
    }

    this.waypoints = [
      {
        x: 18.5,
        z: 17.5,
        action: 'drinking',
        goal: 'Scout the island water source',
        thought: 'Found clear water by the pond. Clean water is essential before I start building.',
      },
      {
        x: 12.5,
        z: 13.5,
        action: 'chopping',
        goal: 'Gather timber from the forest',
        thought: 'These trees will provide sturdy planks for a cabin roof and walls.',
      },
      {
        x: 12.2,
        z: 15.8,
        action: 'building',
        goal: 'Lay cabin foundation and frame walls',
        thought: 'Starting the cabin one block at a time—solid stone base first, then timber.',
      },
      {
        x: 17.0,
        z: 18.5,
        action: 'tilling',
        goal: 'Prepare a small farm plot beside the pond',
        thought: 'Soft soil next to the water is ideal for wheat crops.',
      },
      {
        x: 14.5,
        z: 14.5,
        action: 'thinking',
        goal: 'Reflect on island life and daily routine',
        thought: 'Watching the clouds drift beneath this floating home never gets old.',
      },
    ];
    this.waypointIdx = 0;
    this.updatePerception();
  }

  private placeTree(x: number, baseY: number, z: number, updates?: BlockUpdate[]): void {
    const species = ['oak', 'birch', 'pine', 'oak', 'sakura', 'autumn'][Math.abs(x * 7 + z * 11) % 6];
    const barkMat = species === 'birch' ? 'birch_bark' : species === 'pine' ? 'pine_bark' : 'oak_bark';
    const leafMat = `${species}_foliage`;
    const trunkH = 3 + Math.floor(this.rng() * 2);
    for (let dy = 0; dy < trunkH; dy++) {
      this.setBlock(x, baseY + dy, z, BlockId.WOOD_LOG, 0, barkMat);
      updates?.push({ x, y: baseY + dy, z, block: BlockId.WOOD_LOG, meta: 0, material: barkMat });
    }
    const top = baseY + trunkH;
    for (let dy = -1; dy <= 1; dy++) {
      const r = dy === 1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && dy === 0) continue;
          if (dx === 0 && dz === 0 && dy < 0) continue;
          const bx = x + dx;
          const by = top + dy;
          const bz = z + dz;
          if (this.getBlock(bx, by, bz) === BlockId.AIR) {
            this.setBlock(bx, by, bz, BlockId.LEAVES, 0, leafMat);
            updates?.push({ x: bx, y: by, z: bz, block: BlockId.LEAVES, meta: 0, material: leafMat });
          }
        }
      }
    }
  }

  public step(dtSeconds: number): { blockUpdates: BlockUpdate[]; state: WorldStateSnapshot; trace?: LlmTrace } {
    const blockUpdates: BlockUpdate[] = [];
    if (this.state.paused) {
      return { blockUpdates, state: this.getState() };
    }

    const mult = this.state.speed;
    const simDt = dtSeconds * mult;
    this.state.tick += 1;

    const prevT = this.state.time_of_day;
    let nextT = prevT + simDt / 150;
    if (nextT >= 1) {
      nextT -= 1;
      this.state.day += 1;
      this.state.npc.journal.unshift({
        day: this.state.day,
        clock: '00:00',
        text: `Day ${this.state.day}: Another peaceful sunrise approaches across the floating canopy.`,
      });
      this.state.npc.journal = this.state.npc.journal.slice(0, 12);
    }
    this.state.time_of_day = nextT;
    this.state.clock_str = formatClock(nextT);
    this.state.phase = phaseFromTime(nextT);

    const needs = this.state.npc.needs;
    needs.hunger = Math.max(15, Number((needs.hunger - simDt * 0.18).toFixed(1)));
    needs.thirst = Math.max(15, Number((needs.thirst - simDt * 0.24).toFixed(1)));
    needs.energy = Math.max(15, Number((needs.energy - simDt * 0.14).toFixed(1)));

    const wp = this.waypoints[this.waypointIdx % this.waypoints.length];
    const npc = this.state.npc;
    const dx = wp.x - npc.position.x;
    const dz = wp.z - npc.position.z;
    const dist = Math.hypot(dx, dz);

    let trace: LlmTrace | undefined;

    if (dist > 0.25) {
      const moveSpeed = 2.6 * simDt;
      const stepDist = Math.min(dist, moveSpeed);
      npc.position.x += (dx / dist) * stepDist;
      npc.position.z += (dz / dist) * stepDist;
      const gx = Math.max(0, Math.min(WORLD_WIDTH - 1, Math.round(npc.position.x)));
      const gz = Math.max(0, Math.min(WORLD_DEPTH - 1, Math.round(npc.position.z)));
      const sy = Math.max(9, this.surfaceY[gz * WORLD_WIDTH + gx]);
      npc.position.y = sy + 1;
      npc.grid_pos = { x: gx, y: sy + 1, z: gz };
      npc.yaw = Math.atan2(dx, dz);
      npc.animation = 'walking';
      npc.action_progress = 0;
      npc.path = [
        { x: Math.round((npc.position.x + wp.x) * 0.5), y: sy + 1, z: Math.round((npc.position.z + wp.z) * 0.5) },
        { x: Math.round(wp.x), y: sy + 1, z: Math.round(wp.z) },
      ];
    } else {
      npc.path = [];
      npc.animation = wp.action;
      npc.current_action = wp.action;
      npc.current_goal = wp.goal;
      npc.thought = wp.thought;
      this.actionTimer += simDt;
      npc.action_progress = Math.min(1, this.actionTimer / 3.2);

      if (this.actionTimer >= 3.2) {
        this.actionTimer = 0;
        this.completeDemoAction(wp.action, blockUpdates);
        this.waypointIdx = (this.waypointIdx + 1) % this.waypoints.length;
        trace = this.emitDemoTrace(wp.action, wp.goal, wp.thought);
      }
    }

    this.updateEntities(simDt);
    this.updateExtraAgents(simDt);

    if (this.state.tick % 20 === 0) {
      let ripe = 0;
      let growing = 0;
      let plots = 0;
      for (const f of this.farmQueue) {
        if (this.getBlock(f.x, f.y, f.z) === BlockId.FARMLAND) {
          plots++;
          const crop = this.getBlock(f.x, f.y + 1, f.z);
          if (crop === BlockId.CROP_WHEAT) {
            const idx = blockIndex(f.x, f.y + 1, f.z);
            if (this.blockMeta[idx] < 3 && this.rng() < 0.35) {
              this.blockMeta[idx] += 1;
              blockUpdates.push({
                x: f.x,
                y: f.y + 1,
                z: f.z,
                block: BlockId.CROP_WHEAT,
                meta: this.blockMeta[idx],
              });
            }
            if (this.blockMeta[idx] >= 3) ripe++;
            else growing++;
          }
        }
      }
      this.state.stats.farm_plots = plots;
      this.state.stats.crops_growing = growing;
      this.state.stats.crops_ripe = ripe;
    }

    this.updatePerception();
    return { blockUpdates, state: this.getState(), trace };
  }

  private updateEntities(dt: number): void {
    for (const ent of this.demoEntities) {
      if (!ent.target) {
        ent.wait = Math.max(0, ent.wait - dt);
        if (ent.wait <= 0) {
          const candidates: [number, number, number][] = [];
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [-1, 1],
            [1, -1],
            [-1, -1],
          ]) {
            const nx = ent.grid_pos.x + dx;
            const nz = ent.grid_pos.z + dz;
            if (nx < 3 || nx >= WORLD_WIDTH - 3 || nz < 3 || nz >= WORLD_DEPTH - 3) continue;
            const sy = this.surfaceY[nz * WORLD_WIDTH + nx];
            if (sy > 0 && Math.abs(sy + 1 - ent.grid_pos.y) <= 1) {
              candidates.push([nx, sy + 1, nz]);
            }
          }
          if (candidates.length > 0) {
            ent.target = candidates[Math.floor(this.rng() * candidates.length)];
            ent.animation = 'walking';
          } else {
            ent.wait = 1.2;
          }
        } else {
          ent.animation =
            ent.kind === 'cat' && ent.wait > 1.0
              ? 'sitting'
              : (ent.kind === 'sheep' || ent.kind === 'deer') && ent.wait > 0.8
                ? 'grazing'
                : 'idle';
        }
        continue;
      }

      const [tx, ty, tz] = ent.target;
      const dx = tx - ent.position.x;
      const dy = ty - ent.position.y;
      const dz = tz - ent.position.z;
      const dist = Math.hypot(dx, dy, dz);
      const spd = ent.kind === 'fox' || ent.kind === 'deer' ? 1.8 : 1.35;
      const step = spd * dt;
      if (dist > 0.01) ent.yaw = Math.atan2(dx, dz);
      if (dist <= step) {
        ent.position = { x: tx, y: ty, z: tz };
        ent.grid_pos = { x: tx, y: ty, z: tz };
        ent.target = null;
        ent.wait = 0.8 + this.rng() * 2.2;
        ent.animation = 'idle';
      } else {
        ent.position.x += (dx / dist) * step;
        ent.position.y += (dy / dist) * step;
        ent.position.z += (dz / dist) * step;
        ent.animation = 'walking';
      }
    }
  }

  private updateExtraAgents(dt: number): void {
    const roleActions: Record<string, { anim: string; act: string; thought: string }> = {
      builder: { anim: 'chopping', act: 'chop', thought: 'Gathering timber and stone for island structures.' },
      farmer: { anim: 'watering', act: 'water', thought: 'Tending crops beside the pond.' },
      forager: { anim: 'harvesting', act: 'forage', thought: 'Checking berry bushes and saplings.' },
      explorer: { anim: 'thinking', act: 'explore', thought: 'Observing the sky horizon and island edges.' },
      pioneer: { anim: 'idle', act: 'explore', thought: 'Helping settle the floating island.' },
    };

    for (const ag of this.extraAgents) {
      if (!ag.target) {
        ag.wait = Math.max(0, ag.wait - dt);
        if (ag.wait <= 0) {
          const candidates: [number, number, number][] = [];
          for (const [dx, dz] of [
            [2, 0],
            [-2, 0],
            [0, 2],
            [0, -2],
            [1, 2],
            [-1, -2],
          ]) {
            const nx = ag.grid_pos.x + dx;
            const nz = ag.grid_pos.z + dz;
            if (nx < 5 || nx >= WORLD_WIDTH - 5 || nz < 5 || nz >= WORLD_DEPTH - 5) continue;
            const sy = this.surfaceY[nz * WORLD_WIDTH + nx];
            if (sy > 0) candidates.push([nx, sy + 1, nz]);
          }
          if (candidates.length > 0) {
            ag.target = candidates[Math.floor(this.rng() * candidates.length)];
            ag.animation = 'walking';
            ag.current_action = 'walk';
          } else {
            ag.wait = 1.4;
          }
        } else {
          const rInfo = roleActions[ag.role] ?? roleActions.pioneer;
          ag.animation = rInfo.anim;
          ag.current_action = rInfo.act;
          ag.thought = rInfo.thought;
        }
        continue;
      }

      const [tx, ty, tz] = ag.target;
      const dx = tx - ag.position.x;
      const dy = ty - ag.position.y;
      const dz = tz - ag.position.z;
      const dist = Math.hypot(dx, dy, dz);
      const step = 2.0 * dt;
      if (dist > 0.01) ag.yaw = Math.atan2(dx, dz);
      if (dist <= step) {
        ag.position = { x: tx, y: ty, z: tz };
        ag.grid_pos = { x: tx, y: ty, z: tz };
        ag.target = null;
        ag.wait = 1.4 + this.rng() * 2.2;
      } else {
        ag.position.x += (dx / dist) * step;
        ag.position.y += (dy / dist) * step;
        ag.position.z += (dz / dist) * step;
        ag.animation = 'walking';
      }
    }
  }

  private completeDemoAction(action: string, updates: BlockUpdate[]): void {
    const npc = this.state.npc;
    if (action === 'drinking') {
      npc.needs.thirst = Math.min(100, npc.needs.thirst + 25);
    } else if (action === 'chopping') {
      npc.inventory.wood_log = (npc.inventory.wood_log ?? 0) + 2;
      npc.inventory.wood_plank = (npc.inventory.wood_plank ?? 0) + 4;
      npc.inventory.seeds = (npc.inventory.seeds ?? 0) + 1;
    } else if (action === 'building') {
      const placed = Math.min(3, this.buildQueue.length);
      for (let i = 0; i < placed; i++) {
        const b = this.buildQueue.shift();
        if (!b) break;
        this.setBlock(b.x, b.y, b.z, b.block, b.meta ?? 0);
        updates.push({ x: b.x, y: b.y, z: b.z, block: b.block, meta: b.meta ?? 0 });
        this.state.stats.blocks_placed += 1;
      }
      const totalApprox = 84;
      const done = Math.min(100, Math.round((this.state.stats.blocks_placed / totalApprox) * 100));
      this.state.stats.house_progress = done;
      this.state.stats.house_stage =
        done === 0 ? 'not_started' : done < 30 ? 'foundation' : done < 70 ? 'framing_walls' : done < 100 ? 'roof_and_interior' : 'complete';
      this.state.stats.house_bounds = { min_x: 10, max_x: 14, min_z: 11, max_z: 15 };
    } else if (action === 'tilling') {
      for (const f of this.farmQueue) {
        if (this.getBlock(f.x, f.y, f.z) !== BlockId.FARMLAND) {
          this.setBlock(f.x, f.y, f.z, BlockId.FARMLAND, 1);
          this.setBlock(f.x, f.y + 1, f.z, BlockId.CROP_WHEAT, 0);
          updates.push({ x: f.x, y: f.y, z: f.z, block: BlockId.FARMLAND, meta: 1 });
          updates.push({ x: f.x, y: f.y + 1, z: f.z, block: BlockId.CROP_WHEAT, meta: 0 });
          this.state.stats.farm_plots += 1;
          this.state.stats.crops_growing += 1;
          break;
        }
      }
    } else if (action === 'thinking') {
      npc.needs.mood = Math.min(100, npc.needs.mood + 6);
      npc.needs.energy = Math.min(100, npc.needs.energy + 8);
    }
  }

  private emitDemoTrace(action: string, goal: string, thought: string): LlmTrace {
    this.traceCounter += 1;
    this.state.llm_status.calls_count = this.traceCounter;
    return {
      id: `demo-trace-${this.traceCounter}`,
      timestamp: new Date().toISOString(),
      provider: 'fallback',
      model: 'offline-demo-sim',
      latency_ms: 9,
      prompt_summary: `Pos (${this.state.npc.grid_pos.x},${this.state.npc.grid_pos.y},${this.state.npc.grid_pos.z}) | ${this.state.clock_str}`,
      raw_prompt: `[OFFLINE DEMO CONTEXT] Day ${this.state.day} ${this.state.clock_str}, Needs: H=${Math.round(this.state.npc.needs.hunger)} E=${Math.round(this.state.npc.needs.energy)}`,
      raw_response: JSON.stringify({ thought, goal, action }, null, 2),
      parsed_decision: { thought, goal, action },
      used_fallback: true,
      error: null,
    };
  }

  private updatePerception(): void {
    const gx = this.state.npc.grid_pos.x;
    const gz = this.state.npc.grid_pos.z;
    const entities: WorldStateSnapshot['npc']['perception']['nearby_entities'] = [];

    for (let z = Math.max(0, gz - 7); z <= Math.min(WORLD_DEPTH - 1, gz + 7); z++) {
      for (let x = Math.max(0, gx - 7); x <= Math.min(WORLD_WIDTH - 1, gx + 7); x++) {
        for (let y = 8; y <= 16; y++) {
          const b = this.getBlock(x, y, z);
          if (b === BlockId.WOOD_LOG || b === BlockId.WATER || b === BlockId.WILD_BERRY || b === BlockId.BED) {
            const d = Number(Math.hypot(x - gx, z - gz).toFixed(1));
            const kind =
              b === BlockId.WOOD_LOG
                ? 'tree'
                : b === BlockId.WATER
                  ? 'water'
                  : b === BlockId.WILD_BERRY
                    ? 'berries'
                    : 'bed';
            if (!entities.some((e) => e.kind === kind && Math.abs(e.x - x) < 2 && Math.abs(e.z - z) < 2)) {
              entities.push({ kind, distance: d, x, y, z });
            }
          }
        }
      }
    }
    for (const ent of this.demoEntities) {
      entities.push({
        kind: ent.kind,
        label: `${ent.name} (${ent.kind})`,
        distance: Number(Math.hypot(ent.position.x - gx, ent.position.z - gz).toFixed(1)),
        x: ent.grid_pos.x,
        y: ent.grid_pos.y,
        z: ent.grid_pos.z,
      });
    }
    entities.sort((a, b) => a.distance - b.distance);
    this.state.npc.perception.nearby_entities = entities.slice(0, 6);
  }

  public handleControl(action: string, speed?: SimSpeed, seed?: number): WorldInitMessage | null {
    if (action === 'pause') this.state.paused = true;
    if (action === 'resume') this.state.paused = false;
    if (action === 'set_speed' && speed) this.state.speed = speed;
    if (action === 'step') {
      const wasPaused = this.state.paused;
      this.state.paused = false;
      this.step(0.5);
      this.state.paused = wasPaused;
    }
    if (action === 'reset') {
      return this.reset(seed ?? Math.floor(Math.random() * 9000) + 1000);
    }
    return null;
  }

  public handleGodIntervene(action: string, value?: unknown, agentId?: string): BlockUpdate[] {
    const updates: BlockUpdate[] = [];
    const targetAgent =
      agentId && agentId !== 'aiden' && agentId !== 'all'
        ? this.extraAgents.find((a) => a.id === agentId)
        : null;
    if (action === 'set_time') {
      const map: Record<string, number> = { dawn: 0.25, noon: 0.5, dusk: 0.76, night: 0.92 };
      const t = typeof value === 'number' ? value : (map[String(value)] ?? 0.5);
      this.state.time_of_day = ((t % 1) + 1) % 1;
      this.state.clock_str = formatClock(this.state.time_of_day);
      this.state.phase = phaseFromTime(this.state.time_of_day);
    } else if (action === 'set_weather' && typeof value === 'string') {
      this.state.weather = value as WeatherType;
    } else if (action === 'whisper' && typeof value === 'string' && value.trim()) {
      const msg = value.trim();
      if (agentId === 'all') {
        this.state.npc.thought = `I heard a whisper: "${msg}"`;
        for (const ag of this.extraAgents) ag.thought = `I heard a whisper: "${msg}"`;
      } else if (targetAgent) {
        targetAgent.thought = `I heard a whisper: "${msg}"`;
        targetAgent.memories.unshift({ day: this.state.day, clock: this.state.clock_str, text: `Whisper: "${msg}"` });
      } else {
        this.state.npc.thought = `I heard a whisper: "${msg}"`;
        this.state.npc.memories.unshift({
          day: this.state.day,
          clock: this.state.clock_str,
          text: `Felt an inspiration: "${msg}"`,
        });
        this.state.npc.memories = this.state.npc.memories.slice(0, 15);
      }
    } else if (action === 'heal_npc') {
      if (agentId === 'all') {
        this.state.npc.needs = { hunger: 100, energy: 100, thirst: 100, health: 100, mood: 100 };
        for (const ag of this.extraAgents) ag.needs = { hunger: 100, energy: 100, thirst: 100, health: 100, mood: 100 };
      } else if (targetAgent) {
        targetAgent.needs = { hunger: 100, energy: 100, thirst: 100, health: 100, mood: 100 };
      } else {
        this.state.npc.needs = { hunger: 100, energy: 100, thirst: 100, health: 100, mood: 100 };
      }
    } else if (action === 'drop_gift' && typeof value === 'object' && value !== null) {
      const inv = targetAgent ? targetAgent.inventory : this.state.npc.inventory;
      const gift = value as Record<string, unknown>;
      if (typeof gift.item === 'string') {
        const amt = Number(gift.amount ?? 1);
        inv[gift.item] = (inv[gift.item] ?? 0) + amt;
      } else {
        for (const [k, v] of Object.entries(gift)) {
          if (typeof v === 'number') {
            inv[k] = (inv[k] ?? 0) + v;
          }
        }
      }
    } else if (action === 'spawn_tree') {
      const v = (value ?? {}) as { x?: number; y?: number; z?: number };
      const tx = typeof v.x === 'number' ? v.x : 6 + Math.floor(this.rng() * 20);
      const tz = typeof v.z === 'number' ? v.z : 6 + Math.floor(this.rng() * 20);
      const sy = typeof v.y === 'number' ? v.y - 1 : this.surfaceTopAt(tx, tz);
      if (sy > 0 && this.getBlock(tx, sy + 1, tz) === BlockId.AIR) {
        this.placeTree(tx, sy + 1, tz, updates);
        this.state.stats.trees_count += 1;
      }
    } else if (action === 'spawn_object' && typeof value === 'object' && value !== null) {
      const v = value as { object?: string | number; material?: string; x?: number; y?: number; z?: number; meta?: number };
      const tx = typeof v.x === 'number' ? v.x : Math.max(4, Math.min(27, this.state.npc.grid_pos.x + 2));
      const tz = typeof v.z === 'number' ? v.z : Math.max(4, Math.min(27, this.state.npc.grid_pos.z));
      const ty = typeof v.y === 'number' ? v.y : Math.max(1, this.surfaceTopAt(tx, tz) + 1);
      if (v.object === 'tree') {
        this.placeTree(tx, ty, tz, updates);
        this.state.stats.trees_count += 1;
      } else {
        const directMat = typeof v.object === 'string' ? getWorldMaterial(v.object) : undefined;
        const explicitMat = typeof v.material === 'string' ? getWorldMaterial(v.material) : undefined;
        const matId = explicitMat?.id ?? directMat?.id ?? '';
        const bid =
          typeof v.object === 'number'
            ? v.object
            : OBJECT_NAME_MAP[String(v.object ?? '')] ?? directMat?.block;
        if (bid !== undefined) {
          if (bid === BlockId.CROP_WHEAT) {
            this.setBlock(tx, ty - 1, tz, BlockId.FARMLAND, 1);
            this.setBlock(tx, ty, tz, BlockId.CROP_WHEAT, 3);
            updates.push({ x: tx, y: ty - 1, z: tz, block: BlockId.FARMLAND, meta: 1 });
            updates.push({ x: tx, y: ty, z: tz, block: BlockId.CROP_WHEAT, meta: 3 });
          } else {
            const meta = v.meta ?? (bid === BlockId.FARMLAND ? 1 : 0);
            this.setBlock(tx, ty, tz, bid, meta, matId);
            updates.push({ x: tx, y: ty, z: tz, block: bid, meta, ...(matId ? { material: matId } : {}) });
            if (bid === BlockId.DOOR_CLOSED && ty + 1 < WORLD_HEIGHT) {
              this.setBlock(tx, ty + 1, tz, bid, 0);
              updates.push({ x: tx, y: ty + 1, z: tz, block: bid, meta: 0 });
            }
          }
          this.state.stats.blocks_placed += 1;
        }
      }
    } else if (action === 'remove_block' && typeof value === 'object' && value !== null) {
      const v = value as { x: number; y: number; z: number };
      if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number') {
        this.setBlock(v.x, v.y, v.z, BlockId.AIR, 0);
        updates.push({ x: v.x, y: v.y, z: v.z, block: BlockId.AIR, meta: 0 });
        this.state.stats.blocks_broken += 1;
      }
    } else if (action === 'spawn_entity' && typeof value === 'object' && value !== null) {
      const v = value as { kind?: EntityKind; name?: string; x?: number; y?: number; z?: number };
      const kind = (v.kind ?? 'cat') as EntityKind;
      const sx = typeof v.x === 'number' ? v.x : Math.max(5, Math.min(26, this.state.npc.grid_pos.x + (this.rng() > 0.5 ? 2 : -2)));
      const sz = typeof v.z === 'number' ? v.z : Math.max(5, Math.min(26, this.state.npc.grid_pos.z + (this.rng() > 0.5 ? 2 : -2)));
      const sy = typeof v.y === 'number' ? v.y : Math.max(10, this.surfaceTopAt(sx, sz) + 1);
      this.entityCounter += 1;
      const names = DEFAULT_NAMES[kind] ?? ['Friend'];
      const name = (v.name ?? '').trim() || names[(this.entityCounter - 1) % names.length];
      this.demoEntities.push({
        id: `ent-${this.entityCounter}`,
        kind,
        name,
        variant: this.entityCounter % 4,
        position: { x: sx, y: sy, z: sz },
        grid_pos: { x: sx, y: sy, z: sz },
        yaw: this.rng() * Math.PI * 2,
        animation: 'idle',
        target: null,
        wait: 1.0,
      });
      this.state.npc.memories.unshift({
        day: this.state.day,
        clock: this.state.clock_str,
        text: `A ${kind} named ${name} joined the island.`,
      });
    } else if (action === 'clear_entities') {
      this.demoEntities = [];
    }
    return updates;
  }

  public exportSave(name?: string): WorldSavePayload {
    const state = this.getState();
    const DAY_SECONDS = 360.0;
    const elapsed = ((state.day - 1) + state.time_of_day) * DAY_SECONDS;
    const toVecArray = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];

    const serializeAgent = (a: NpcState, idx: number) => ({
      id: a.id ?? (idx === 0 ? 'aiden' : `npc-${idx + 1}`),
      name: a.name,
      role: a.role ?? 'pioneer',
      variant: a.variant ?? idx,
      position: toVecArray(a.position),
      grid_pos: toVecArray(a.grid_pos),
      yaw: a.yaw,
      needs: { ...a.needs },
      inventory: { ...a.inventory },
      tools: { axe: 0, pickaxe: 0, hammer: 0 },
      current_goal: a.current_goal,
      thought: a.thought,
      memories: [...a.memories],
      journal: [...a.journal],
      explored: true,
      last_journal_day: state.day,
      last_plant_time: -999,
    });

    return {
      format: 'land66-save-v1',
      save_version: 1,
      name: (name ?? `Day ${state.day} (${state.clock_str})`).trim().slice(0, 64),
      saved_at: new Date().toISOString(),
      seed: state.seed,
      tick: state.tick,
      elapsed: Number(elapsed.toFixed(4)),
      paused: state.paused,
      speed: state.speed,
      weather: state.weather,
      weather_override: false,
      blocks_placed: state.stats.blocks_placed,
      blocks_broken: state.stats.blocks_broken,
      entity_counter: this.entityCounter,
      agent_counter: this.agentCounter,
      world: {
        seed: state.seed,
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        depth: WORLD_DEPTH,
        blocks: Array.from(this.blocks),
        meta: Array.from(this.blockMeta),
        materials: Object.fromEntries(
          this.blockMaterials
            .map((mat, idx) => (mat ? [String(idx), mat] : null))
            .filter((entry): entry is [string, string] => entry !== null),
        ),
      },
      entities: this.demoEntities.map((e) => ({ ...e })),
      agents: state.agents?.map((a, idx) => serializeAgent(a, idx)) ?? [serializeAgent(state.npc, 0)],
      brains: {},
    };
  }

  public loadSave(payload: WorldSavePayload): WorldInitMessage {
    const blocks = payload?.world?.blocks;
    if (!Array.isArray(blocks) || blocks.length !== WORLD_VOLUME) {
      throw new Error(`Invalid save file: expected ${WORLD_VOLUME} world blocks.`);
    }
    const meta = payload.world.meta;
    if (Array.isArray(meta) && meta.length !== WORLD_VOLUME) {
      throw new Error(`Invalid save file: expected ${WORLD_VOLUME} block_meta entries.`);
    }

    this.blockMaterials.fill('');
    const rawMats = payload.world.materials;
    if (Array.isArray(rawMats)) {
      for (let i = 0; i < Math.min(WORLD_VOLUME, rawMats.length); i++) {
        this.blockMaterials[i] = typeof rawMats[i] === 'string' ? rawMats[i] : '';
      }
    } else if (rawMats && typeof rawMats === 'object') {
      for (const [k, val] of Object.entries(rawMats)) {
        const idx = Number(k);
        if (Number.isInteger(idx) && idx >= 0 && idx < WORLD_VOLUME && typeof val === 'string') {
          this.blockMaterials[idx] = val;
        }
      }
    }
    for (let i = 0; i < WORLD_VOLUME; i++) {
      this.blocks[i] = Number(blocks[i]) & 0xff;
      this.blockMeta[i] = Array.isArray(meta) ? Number(meta[i]) & 0xff : 0;
    }

    // Recompute surface heights and crop/tree stats from restored voxels
    let treesCount = 0;
    let farmPlots = 0;
    let cropsGrowing = 0;
    let cropsRipe = 0;
    this.surfaceY.fill(-1);
    for (let z = 0; z < WORLD_DEPTH; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          const b = this.getBlock(x, y, z);
          if (b === BlockId.WOOD_LOG && y > 0 && this.getBlock(x, y - 1, z) !== BlockId.WOOD_LOG) {
            treesCount += 1;
          } else if (b === BlockId.FARMLAND) {
            farmPlots += 1;
          } else if (b === BlockId.CROP_WHEAT) {
            if (this.blockMeta[blockIndex(x, y, z)] >= 3) cropsRipe += 1;
            else cropsGrowing += 1;
          }
          if (
            this.surfaceY[z * WORLD_WIDTH + x] < 0 &&
            b !== BlockId.AIR &&
            b !== BlockId.LEAVES &&
            b !== BlockId.WOOD_LOG
          ) {
            this.surfaceY[z * WORLD_WIDTH + x] = y;
          }
        }
      }
    }

    const seed = Number(payload.seed ?? payload.world.seed ?? 6601);
    const DAY_SECONDS = 360.0;
    const elapsed = Math.max(0, Number(payload.elapsed ?? DAY_SECONDS * 0.27));
    const day = Math.floor(elapsed / DAY_SECONDS) + 1;
    const timeOfDay = (elapsed % DAY_SECONDS) / DAY_SECONDS;
    const weather =
      payload.weather === 'rain' || payload.weather === 'storm' ? payload.weather : 'clear';
    const rawSpeed = Number(payload.speed ?? 1);
    const speed: SimSpeed = rawSpeed === 2 || rawSpeed === 5 ? rawSpeed : 1;

    this.state = this.createInitialState(seed);
    this.state.tick = Math.max(0, Number(payload.tick ?? 0));
    this.state.day = day;
    this.state.time_of_day = timeOfDay;
    this.state.clock_str = formatClock(timeOfDay);
    this.state.phase = phaseFromTime(timeOfDay);
    this.state.weather = weather;
    this.state.paused = Boolean(payload.paused ?? false);
    this.state.speed = speed;
    this.state.stats.trees_count = treesCount;
    this.state.stats.farm_plots = farmPlots;
    this.state.stats.crops_growing = cropsGrowing;
    this.state.stats.crops_ripe = cropsRipe;
    this.state.stats.blocks_placed = Math.max(0, Number(payload.blocks_placed ?? 0));
    this.state.stats.blocks_broken = Math.max(0, Number(payload.blocks_broken ?? 0));

    const parseVec = (raw: unknown, fallback: { x: number; y: number; z: number }) => {
      if (Array.isArray(raw) && raw.length >= 3) {
        return { x: Number(raw[0]), y: Number(raw[1]), z: Number(raw[2]) };
      }
      if (raw && typeof raw === 'object' && 'x' in raw && 'y' in raw && 'z' in raw) {
        const obj = raw as { x: unknown; y: unknown; z: unknown };
        return { x: Number(obj.x), y: Number(obj.y), z: Number(obj.z) };
      }
      return fallback;
    };

    const rawAgents = Array.isArray(payload.agents) ? (payload.agents as Array<Record<string, unknown>>) : [];
    const restoreNpc = (src: Record<string, unknown>, base: NpcState): NpcState => {
      const pos = parseVec(src.position, base.position);
      const grid = parseVec(src.grid_pos, { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) });
      return {
        ...base,
        id: String(src.id ?? base.id ?? 'aiden'),
        name: String(src.name ?? base.name),
        role: String(src.role ?? base.role ?? 'pioneer'),
        variant: Number(src.variant ?? base.variant ?? 0),
        position: pos,
        grid_pos: grid,
        yaw: Number(src.yaw ?? base.yaw),
        current_goal: String(src.current_goal ?? base.current_goal),
        thought: String(src.thought ?? base.thought),
        needs: { ...base.needs, ...((src.needs as Record<string, number>) ?? {}) },
        inventory: { ...base.inventory, ...((src.inventory as Record<string, number>) ?? {}) },
        memories: Array.isArray(src.memories) ? (src.memories as NpcState['memories']) : base.memories,
        journal: Array.isArray(src.journal) ? (src.journal as NpcState['journal']) : base.journal,
      };
    };

    const primaryData = rawAgents.find((a) => a.id === 'aiden') ?? rawAgents[0];
    if (primaryData) {
      this.state.npc = restoreNpc(primaryData, this.state.npc);
    }

    this.extraAgents = [];
    for (const a of rawAgents) {
      const aid = String(a.id ?? '');
      if (!aid || aid === 'aiden') continue;
      const base = this.addAgent({ name: String(a.name ?? aid), role: (a.role as AgentRole) ?? 'pioneer' });
      const idx = this.extraAgents.length - 1;
      const restored = restoreNpc(a, base);
      this.extraAgents[idx] = { ...this.extraAgents[idx], ...restored, id: aid };
    }

    this.agentCounter = Math.max(1 + this.extraAgents.length, Number(payload.agent_counter ?? 1));
    this.demoEntities = [];
    const rawEntities = Array.isArray(payload.entities) ? (payload.entities as Array<Record<string, unknown>>) : [];
    for (const e of rawEntities) {
      const pos = parseVec(e.position, { x: 15, y: 11, z: 15 });
      const grid = parseVec(e.grid_pos, { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) });
      this.demoEntities.push({
        id: String(e.id ?? `ent-${this.demoEntities.length + 1}`),
        kind: String(e.kind ?? 'cat') as EntityKind,
        name: String(e.name ?? 'Friend'),
        variant: Number(e.variant ?? 0),
        position: pos,
        grid_pos: grid,
        yaw: Number(e.yaw ?? 0),
        animation: 'idle',
        target: null,
        wait: 1.0,
      });
    }
    this.entityCounter = Math.max(this.demoEntities.length, Number(payload.entity_counter ?? this.demoEntities.length));

    return this.getInitMessage();
  }
}

const OFFLINE_SAVES_KEY = 'land66_offline_saves_v1';

interface StoredOfflineSave {
  summary: SaveSlotSummary;
  payload: WorldSavePayload;
}

function readOfflineStore(): Record<string, StoredOfflineSave> {
  try {
    const raw = window.localStorage.getItem(OFFLINE_SAVES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoredOfflineSave>) : {};
  } catch {
    return {};
  }
}

function writeOfflineStore(store: Record<string, StoredOfflineSave>): void {
  window.localStorage.setItem(OFFLINE_SAVES_KEY, JSON.stringify(store));
}

export const offlineSaveStore = {
  list(): SaveSlotSummary[] {
    return Object.values(readOfflineStore())
      .map((entry) => entry.summary)
      .sort((a, b) => (b.saved_at || '').localeCompare(a.saved_at || ''));
  },
  save(name: string, payload: WorldSavePayload): SaveSlotSummary {
    const slot = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    if (!slot) throw new Error('Save name must contain letters or numbers.');
    const serialized = JSON.stringify(payload);
    const summary: SaveSlotSummary = {
      slot,
      name: name.trim().slice(0, 64),
      saved_at: new Date().toISOString(),
      day: Math.floor(payload.elapsed / 360) + 1,
      clock_str: formatClock((payload.elapsed % 360) / 360),
      tick: payload.tick,
      weather: payload.weather,
      agents_count: payload.agents.length,
      entities_count: payload.entities?.length ?? 0,
      seed: payload.seed,
      size_bytes: serialized.length,
    };
    const store = readOfflineStore();
    store[slot] = { summary, payload };
    writeOfflineStore(store);
    return summary;
  },
  load(slot: string): WorldSavePayload {
    const store = readOfflineStore();
    const item = store[slot];
    if (!item) throw new Error(`Save slot "${slot}" not found.`);
    return item.payload;
  },
  remove(slot: string): void {
    const store = readOfflineStore();
    delete store[slot];
    writeOfflineStore(store);
  },
};
