import {
  BlockId,
  WORLD_DEPTH,
  WORLD_HEIGHT,
  WORLD_VOLUME,
  WORLD_WIDTH,
  blockIndex,
  type BlockUpdate,
  type DayPhase,
  type LlmTrace,
  type SimSpeed,
  type WeatherType,
  type WorldInitMessage,
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
  const totalMinutes = Math.floor(((t % 1) + 1) % 1 * 24 * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export class OfflineDemoSimulator {
  private blocks = new Uint8Array(WORLD_VOLUME);
  private blockMeta = new Uint8Array(WORLD_VOLUME);
  private rng = mulberry32(6601);
  private state: WorldStateSnapshot;
  private surfaceY = new Int8Array(WORLD_WIDTH * WORLD_DEPTH);
  private waypoints: Array<{ x: number; z: number; action: string; goal: string; thought: string }> = [];
  private waypointIdx = 0;
  private actionTimer = 0;
  private phaseStage: 'explore' | 'gather' | 'clear' | 'build' | 'farm' = 'explore';
  private buildQueue: Array<{ x: number; y: number; z: number; block: number; meta?: number }> = [];
  private farmQueue: Array<{ x: number; y: number; z: number }> = [];
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
        name: 'Aiden',
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
            'Tall oaks surround me. A small freshwater pond glimmers to the south-east and wild berries grow nearby.',
          nearby_entities: [],
        },
        memories: [
          { day: 1, clock: '06:28', text: 'Awakened on a floating woodland island surrounded by endless clouds.' },
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
      },
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
      state: structuredClone(this.state),
    };
  }

  public getState(): WorldStateSnapshot {
    return structuredClone(this.state);
  }

  public reset(seed = Math.floor(Math.random() * 9000) + 1000): WorldInitMessage {
    this.state = this.createInitialState(seed);
    this.generateIsland(seed);
    return this.getInitMessage();
  }

  private setBlock(x: number, y: number, z: number, block: number, meta = 0): void {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH) return;
    const idx = blockIndex(x, y, z);
    this.blocks[idx] = block;
    this.blockMeta[idx] = meta;
  }

  private getBlock(x: number, y: number, z: number): number {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_DEPTH) return 0;
    return this.blocks[blockIndex(x, y, z)];
  }

  private generateIsland(seed: number): void {
    this.blocks.fill(BlockId.AIR);
    this.blockMeta.fill(0);
    this.surfaceY.fill(-1);
    this.rng = mulberry32(seed);
    this.phaseStage = 'explore';
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
            this.setBlock(x, y, z, BlockId.GRASS);
          } else if (y >= topY - 2) {
            this.setBlock(x, y, z, BlockId.DIRT);
          } else {
            this.setBlock(x, y, z, BlockId.STONE);
          }
        }
        this.surfaceY[z * WORLD_WIDTH + x] = topY;
      }
    }

    // Carve natural freshwater pond
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
          this.setBlock(x, waterY - 1, z, BlockId.DIRT);
          this.surfaceY[z * WORLD_WIDTH + x] = waterY;
        }
      }
    }

    // Place natural forest (trees, boulders, wild berry bushes) - NO house or farm!
    let treeCount = 0;
    const treePositions: Array<{ x: number; z: number }> = [];
    for (let z = 4; z < WORLD_DEPTH - 4; z++) {
      for (let x = 4; x < WORLD_WIDTH - 4; x++) {
        const sy = this.surfaceY[z * WORLD_WIDTH + x];
        if (sy <= 0) continue;
        if (this.getBlock(x, sy, z) !== BlockId.GRASS) continue;
        if (Math.hypot(x - 15.5, z - 15.5) < 2.2) continue; // breathing room at spawn
        if (Math.hypot(x - pondCx, z - pondCz) < 3.4) continue;

        const tooClose = treePositions.some((tp) => Math.hypot(tp.x - x, tp.z - z) < 3.1);
        const r = this.rng();
        if (!tooClose && r < 0.18) {
          this.placeTree(x, sy + 1, z);
          treePositions.push({ x, z });
          treeCount++;
        } else if (r >= 0.18 && r < 0.215) {
          this.setBlock(x, sy + 1, z, BlockId.WILD_BERRY);
        } else if (r >= 0.215 && r < 0.238) {
          this.setBlock(x, sy + 1, z, BlockId.STONE);
        }
      }
    }

    const spawnSy = Math.max(10, this.surfaceY[15 * WORLD_WIDTH + 15]);
    this.state.npc.position = { x: 15.5, y: spawnSy + 1, z: 15.5 };
    this.state.npc.grid_pos = { x: 15, y: spawnSy + 1, z: 15 };
    this.state.stats.trees_count = treeCount;

    // Prepare cozy cabin build plan (built progressively later by Aiden)
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
        thought: 'These oaks will provide sturdy planks for a cabin roof and walls.',
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

  private placeTree(x: number, baseY: number, z: number): void {
    const trunkH = 3 + Math.floor(this.rng() * 2);
    for (let dy = 0; dy < trunkH; dy++) {
      this.setBlock(x, baseY + dy, z, BlockId.WOOD_LOG);
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
            this.setBlock(bx, by, bz, BlockId.LEAVES);
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

    // Advance day cycle (~150 seconds per day at 1x)
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

    // Needs decay gently
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

    // Grow planted crops occasionally
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
    this.phaseStage = this.state.stats.house_progress > 0 ? 'build' : 'gather';
    void this.phaseStage;
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

  public handleGodIntervene(action: string, value?: unknown): BlockUpdate[] {
    const updates: BlockUpdate[] = [];
    if (action === 'set_time') {
      const map: Record<string, number> = { dawn: 0.26, noon: 0.5, dusk: 0.77, night: 0.94 };
      const t = typeof value === 'number' ? value : (map[String(value)] ?? 0.5);
      this.state.time_of_day = ((t % 1) + 1) % 1;
      this.state.clock_str = formatClock(this.state.time_of_day);
      this.state.phase = phaseFromTime(this.state.time_of_day);
    } else if (action === 'set_weather' && typeof value === 'string') {
      this.state.weather = value as WeatherType;
    } else if (action === 'whisper' && typeof value === 'string' && value.trim()) {
      this.state.npc.thought = `I heard a whisper on the wind: "${value.trim()}"`;
      this.state.npc.memories.unshift({
        day: this.state.day,
        clock: this.state.clock_str,
        text: `Felt a mysterious inspiration: "${value.trim()}"`,
      });
      this.state.npc.memories = this.state.npc.memories.slice(0, 15);
    } else if (action === 'heal_npc') {
      this.state.npc.needs = { hunger: 100, energy: 100, thirst: 100, health: 100, mood: 100 };
    } else if (action === 'drop_gift' && typeof value === 'object' && value !== null) {
      const gift = value as { item?: string; amount?: number };
      const item = gift.item ?? 'berries';
      const amt = gift.amount ?? 3;
      this.state.npc.inventory[item] = (this.state.npc.inventory[item] ?? 0) + amt;
      this.state.npc.memories.unshift({
        day: this.state.day,
        clock: this.state.clock_str,
        text: `Received ${amt} ${item} seemingly from the sky.`,
      });
    } else if (action === 'spawn_tree') {
      for (let tries = 0; tries < 40; tries++) {
        const x = 6 + Math.floor(this.rng() * 20);
        const z = 6 + Math.floor(this.rng() * 20);
        const sy = this.surfaceY[z * WORLD_WIDTH + x];
        if (sy > 0 && this.getBlock(x, sy, z) === BlockId.GRASS && this.getBlock(x, sy + 1, z) === BlockId.AIR) {
          this.placeTree(x, sy + 1, z);
          this.state.stats.trees_count += 1;
          for (let dy = 1; dy <= 6; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              for (let dz = -2; dz <= 2; dz++) {
                const b = this.getBlock(x + dx, sy + dy, z + dz);
                if (b !== BlockId.AIR) {
                  updates.push({ x: x + dx, y: sy + dy, z: z + dz, block: b, meta: 0 });
                }
              }
            }
          }
          break;
        }
      }
    }
    return updates;
  }
}
