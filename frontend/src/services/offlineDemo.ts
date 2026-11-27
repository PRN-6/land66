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
  type FloatingWorldId,
  type LlmConfig,
  type LlmTrace,
  type MarketCatalogPayload,
  type NpcState,
  type SaveSlotSummary,
  type ShopItemDef,
  type SimSpeed,
  type TeleportGateState,
  type WeatherType,
  type WorldEntity,
  type WorldInitMessage,
  type WorldPresetId,
  type WorldSavePayload,
  type WorldStateSnapshot,
  type WorldSummary,
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

const DEMO_SHOP_ITEMS: ShopItemDef[] = [
  { id: 'marble', name: 'White Marble', category: 'Materials', price: 18, grant_item: 'marble', grant_qty: 4, description: 'Polished ivory architectural stone (x4).' },
  { id: 'obsidian', name: 'Obsidian', category: 'Materials', price: 24, grant_item: 'obsidian', grant_qty: 4, description: 'Dark volcanic glass stone (x4).' },
  { id: 'sandstone', name: 'Sandstone', category: 'Materials', price: 12, grant_item: 'sandstone', grant_qty: 4, description: 'Warm desert building stone (x4).' },
  { id: 'brick', name: 'Clay Brick', category: 'Materials', price: 14, grant_item: 'brick', grant_qty: 4, description: 'Kiln-fired red masonry brick (x4).' },
  { id: 'crystal', name: 'Crystal Cluster', category: 'Materials', price: 32, grant_item: 'crystal', grant_qty: 2, description: 'Luminous aquamarine cavern crystal (x2).' },
  { id: 'sunstone', name: 'Sunstone', category: 'Materials', price: 45, grant_item: 'sunstone', grant_qty: 1, description: 'Warm radiant crystal light stone.' },
  { id: 'gold_ingot', name: 'Gold Ingot', category: 'Materials', price: 38, grant_item: 'gold_ingot', grant_qty: 2, description: 'Refined gilded bar (x2).' },
  { id: 'copper_ingot', name: 'Copper Ingot', category: 'Materials', price: 22, grant_item: 'copper_ingot', grant_qty: 3, description: 'Warm architectural copper bar (x3).' },
  { id: 'axe', name: 'Artisan Axe', category: 'Tools & Home', price: 35, grant_item: 'axe', grant_qty: 1, description: 'Sturdy woodcutting axe.' },
  { id: 'pickaxe', name: 'Miner Pickaxe', category: 'Tools & Home', price: 38, grant_item: 'pickaxe', grant_qty: 1, description: 'Steel-tipped ore pickaxe.' },
  { id: 'hammer', name: 'Builder Hammer', category: 'Tools & Home', price: 30, grant_item: 'hammer', grant_qty: 1, description: 'Precision carpentry hammer.' },
  { id: 'wooden_spear', name: 'Hunting Spear', category: 'Tools & Home', price: 22, grant_item: 'wooden_spear', grant_qty: 1, description: 'Sharpened timber spear for hunting.' },
  { id: 'hunting_bow', name: 'Hunting Bow', category: 'Tools & Home', price: 36, grant_item: 'hunting_bow', grant_qty: 1, description: 'Long-reach bow for forest wildlife.' },
  { id: 'iron_sword', name: 'Iron Sword', category: 'Tools & Home', price: 52, grant_item: 'iron_sword', grant_qty: 1, description: 'Masterwork blade for bonus meat yield.' },
  { id: 'cooked_meat', name: 'Roasted Meat', category: 'Food & Farm', price: 16, grant_item: 'cooked_meat', grant_qty: 2, description: 'Warm roasted meat (x2).' },
  { id: 'bread', name: 'Warm Bakery Loaf', category: 'Food & Farm', price: 12, grant_item: 'bread', grant_qty: 2, description: 'Fresh market loaves (x2).' },
  { id: 'berries', name: 'Wild Berry Basket', category: 'Food & Farm', price: 10, grant_item: 'berries', grant_qty: 4, description: 'Sweet island berries (x4).' },
  { id: 'seeds', name: 'Wheat Seeds', category: 'Food & Farm', price: 8, grant_item: 'seeds', grant_qty: 6, description: 'Heirloom wheat seeds (x6).' },
  { id: 'sapling', name: 'Tree Sapling', category: 'Food & Farm', price: 10, grant_item: 'sapling', grant_qty: 2, description: 'Young saplings to grow trees (x2).' },
  { id: 'pet_cat', name: 'Market Cat', category: 'Companions', price: 60, spawn_entity: 'cat', description: 'Adopts a playful cat onto your island.' },
  { id: 'pet_fox', name: 'Red Fox', category: 'Companions', price: 70, spawn_entity: 'fox', description: 'Adopts a curious fox onto your island.' },
  { id: 'pet_duck', name: 'Pond Duck', category: 'Companions', price: 50, spawn_entity: 'duck', description: 'Adopts a friendly duck near water.' },
  { id: 'pet_sheep', name: 'Wool Sheep', category: 'Companions', price: 65, spawn_entity: 'sheep', description: 'Adopts a fluffy sheep onto your island.' },
  { id: 'pet_deer', name: 'Forest Deer', category: 'Companions', price: 85, spawn_entity: 'deer', description: 'Adopts a gentle deer onto your island.' },
];

const DEMO_SELL_PRICES: Record<string, number> = {
  berries: 2,
  wheat: 3,
  bread: 7,
  wood_log: 4,
  wood_plank: 2,
  stone: 3,
  iron_ore: 7,
  coal: 5,
  gold_ore: 16,
  crystal: 20,
  marble: 6,
  obsidian: 8,
  sandstone: 4,
  sunstone: 30,
  raw_meat: 5,
  cooked_meat: 12,
  hide: 14,
  feather: 6,
};

interface CachedDemoWorld {
  blocks: Uint8Array;
  blockMeta: Uint8Array;
  blockMaterials: string[];
  surfaceY: Int8Array;
  state: WorldStateSnapshot;
  entities: DemoEntity[];
  extraAgents: DemoAgent[];
  waypoints: Array<{ x: number; z: number; action: string; goal: string; thought: string }>;
  entityCounter: number;
  agentCounter: number;
  preset: WorldPresetId | string;
  name: string;
}

const DEMO_PRESET_LABELS: Record<string, string> = {
  homestead: 'Lush Island',
  alpine_peaks: 'Alpine Peaks',
  sakura_grove: 'Sakura Sanctuary',
  crystal_canyon: 'Crystal Canyon',
  obsidian_caldera: 'Volcanic Caldera',
  flat_sandbox: 'Blank Canvas',
  market: 'Sky Market Bazaar',
};

const DEMO_GATE_ARCH: Array<{ x: number; y: number; z: number; item: string; surface: string }> = [
  { x: 10, y: 11, z: 14, item: 'obsidian', surface: 'obsidian' },
  { x: 10, y: 11, z: 16, item: 'obsidian', surface: 'obsidian' },
  { x: 10, y: 12, z: 14, item: 'marble', surface: 'marble' },
  { x: 10, y: 12, z: 16, item: 'marble', surface: 'marble' },
  { x: 10, y: 13, z: 14, item: 'crystal', surface: 'crystal_vein' },
  { x: 10, y: 13, z: 16, item: 'crystal', surface: 'crystal_vein' },
  { x: 10, y: 13, z: 15, item: 'sunstone', surface: 'sunstone' },
];

export class OfflineDemoSimulator {
  private blocks = new Uint8Array(WORLD_VOLUME);
  private blockMeta = new Uint8Array(WORLD_VOLUME);
  private blockMaterials: string[] = new Array(WORLD_VOLUME).fill('');
  private activeWorldId: FloatingWorldId = 'homestead';
  private activeWorldName = 'Homestead';
  private activePreset: WorldPresetId | string = 'homestead';
  private worldRegistry: Array<{ id: string; name: string; preset: string; seed: number; builtin: boolean }> = [];
  private gateClues: { anchor: boolean; conduit: boolean; core: boolean } = {
    anchor: false,
    conduit: false,
    core: false,
  };
  private cachedWorlds: Record<string, CachedDemoWorld> = {};
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

  constructor(seed = 6601, restoreAutosave = true) {
    this.activeWorldId = 'homestead';
    this.activeWorldName = 'Homestead';
    this.activePreset = 'homestead';
    this.worldRegistry = [
      { id: 'homestead', name: 'Homestead', preset: 'homestead', seed, builtin: true },
      { id: 'market', name: 'Market', preset: 'market', seed: seed + 100, builtin: true },
    ];
    this.state = this.createInitialState(seed, 'homestead', 250, 'Homestead', 'homestead');
    this.generateIsland(seed);
    if (restoreAutosave) {
      this.restoreAutosave();
    }
  }

  private createInitialState(
    seed: number,
    worldId: FloatingWorldId = 'homestead',
    coins = 250,
    worldName = 'Homestead',
    worldPreset: string = worldId,
  ): WorldStateSnapshot {
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
      world_id: worldId,
      world_name: worldName,
      world_preset: worldPreset,
      coins,
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
    this.state.gate = this.getGateState();
    this.state.world_id = this.activeWorldId;
    this.state.world_name = this.activeWorldName;
    this.state.world_preset = this.activePreset;
    this.state.worlds = this.worldsSummary();
    return structuredClone(this.state);
  }

  public worldsSummary(): WorldSummary[] {
    return this.worldRegistry.map((w) => ({
      id: w.id,
      name: w.name,
      preset: w.preset,
      preset_label: DEMO_PRESET_LABELS[w.preset] ?? w.preset,
      seed: w.seed,
      builtin: w.builtin,
      locked: false,
    }));
  }

  public getGateState(): TeleportGateState {
    if (this.activeWorldId !== 'homestead') {
      return {
        discovered: true,
        unlocked: true,
        progress: 100,
        clues: { anchor: true, conduit: true, core: true },
        built_count: 7,
        total_count: 7,
        missing_items: {},
        next_material: null,
        next_surface: null,
        position: { x: 10, y: 11, z: 15 },
      };
    }
    const missing: Record<string, number> = {};
    let built = 0;
    let nextMat: string | null = null;
    let nextSurf: string | null = null;
    for (const part of DEMO_GATE_ARCH) {
      const idx = blockIndex(part.x, part.y, part.z);
      const ok = this.blocks[idx] === BlockId.STONE && this.blockMaterials[idx] === part.surface;
      if (ok) {
        built += 1;
      } else {
        missing[part.item] = (missing[part.item] ?? 0) + 1;
        if (!nextMat) {
          nextMat = part.item;
          nextSurf = part.surface;
        }
      }
    }
    const discovered = this.gateClues.anchor && this.gateClues.conduit && this.gateClues.core;
    const unlocked = built === DEMO_GATE_ARCH.length;
    return {
      discovered,
      unlocked,
      progress: Number(((100 * built) / DEMO_GATE_ARCH.length).toFixed(1)),
      clues: { ...this.gateClues },
      built_count: built,
      total_count: DEMO_GATE_ARCH.length,
      missing_items: missing,
      next_material: nextMat,
      next_surface: nextSurf,
      position: { x: 10, y: 11, z: 15 },
    };
  }

  public decipherGateRune(rune: 'anchor' | 'conduit' | 'core', answer: string): { correct: boolean; feedback: string } {
    const answers: Record<'anchor' | 'conduit' | 'core', [string, string, string]> = {
      anchor: ['obsidian', 'Anchored! Obsidian anchors the portal frame.', 'Hint: Dark volcanic rock from deep island stone.'],
      conduit: ['crystal', 'Unlocked! White Marble columns topped with glowing Crystal channel sky energy.', 'Hint: Sea-blue glowing crystal gem.'],
      core: ['sunstone', 'Deciphered! A radiant Sunstone keystone completes the circuit.', 'Hint: Radiant amber light stone crafted from Crystal + Gold.'],
    };
    const [expected, okMsg, hintMsg] = answers[rune];
    if (answer.trim().toLowerCase() === expected) {
      this.gateClues[rune] = true;
      this.state.npc.memories.unshift({ day: this.state.day, clock: this.state.clock_str, text: okMsg });
      return { correct: true, feedback: okMsg };
    }
    return { correct: false, feedback: hintMsg };
  }

  public studyGateWithNpc(agentId?: string): string {
    const ag = agentId && agentId !== 'aiden' ? this.extraAgents.find((a) => a.id === agentId) : undefined;
    const npc = ag ?? this.state.npc;
    for (const r of ['anchor', 'conduit', 'core'] as const) {
      if (!this.gateClues[r]) {
        this.gateClues[r] = true;
        const msg = `${npc.name} studied the ruined plinth and unlocked Rune (${r}).`;
        npc.thought = msg;
        npc.memories.unshift({ day: this.state.day, clock: this.state.clock_str, text: msg });
        return msg;
      }
    }
    return 'All 3 Teleport Gate runes are already deciphered!';
  }

  public buildGate(mode: 'place' | 'npc', agentId?: string): { updates: BlockUpdate[]; message: string } {
    if (!this.gateClues.anchor || !this.gateClues.conduit || !this.gateClues.core) {
      if (mode === 'npc') {
        const msg = this.studyGateWithNpc(agentId);
        return { updates: [], message: msg };
      }
      throw new Error('Decipher all 3 Teleport Gate runes first.');
    }
    const ag = agentId && agentId !== 'aiden' ? this.extraAgents.find((a) => a.id === agentId) : undefined;
    const npc = ag ?? this.state.npc;
    const inv = npc.inventory;
    const part = DEMO_GATE_ARCH.find((p) => {
      const idx = blockIndex(p.x, p.y, p.z);
      return !(this.blocks[idx] === BlockId.STONE && this.blockMaterials[idx] === p.surface);
    });
    if (!part) return { updates: [], message: 'Sky Teleport Gate is already complete!' };

    if ((inv[part.item] ?? 0) < 1) {
      if (mode === 'npc') {
        inv[part.item] = (inv[part.item] ?? 0) + 1;
        const msg = `${npc.name} gathered 1 ${part.item.replace(/_/g, ' ')} from island outcrops for the Gate.`;
        npc.thought = msg;
        return { updates: [], message: msg };
      }
      throw new Error(`Need 1 ${part.item.replace(/_/g, ' ')} in inventory (try Gather & Build with NPC).`);
    }

    inv[part.item] -= 1;
    this.setBlock(part.x, part.y, part.z, BlockId.STONE, 0, part.surface);
    this.state.stats.blocks_placed += 1;
    const updates: BlockUpdate[] = [{ x: part.x, y: part.y, z: part.z, block: BlockId.STONE, meta: 0, material: part.surface }];
    const unlocked = this.getGateState().unlocked;
    const msg = unlocked
      ? 'Sky Teleport Gate activated! Travel to Sky Market is unlocked.'
      : `Assembled ${part.surface.replace(/_/g, ' ')} onto the Teleport Gate.`;
    npc.thought = msg;
    return { updates, message: msg };
  }

  public npcAction(action: string, params: Record<string, unknown> = {}, agentId?: string): string {
    const ag = agentId && agentId !== 'aiden' ? this.extraAgents.find((a) => a.id === agentId) : undefined;
    const npc = ag ?? this.state.npc;
    const inv = npc.inventory;
    if (action === 'craft') {
      const recipe = String(params.recipe ?? '');
      if (recipe === 'wooden_spear') {
        if ((inv.wood_log ?? 0) < 1 || (inv.stone ?? 0) < 1) {
          throw new Error('Need 1 wood log and 1 stone to craft a Spear.');
        }
        inv.wood_log -= 1;
        inv.stone -= 1;
        inv.wooden_spear = (inv.wooden_spear ?? 0) + 1;
        npc.thought = 'Crafted a wooden spear for hunting!';
        return npc.thought;
      }
      if (recipe === 'hunting_bow') {
        if ((inv.wood_plank ?? 0) < 2) {
          throw new Error('Need 2 wood planks to craft a Hunting Bow.');
        }
        inv.wood_plank -= 2;
        inv.hunting_bow = (inv.hunting_bow ?? 0) + 1;
        npc.thought = 'Strung a curved hunting bow!';
        return npc.thought;
      }
      if (recipe === 'cooked_meat') {
        if ((inv.raw_meat ?? 0) < 1) throw new Error('Need 1 raw meat to cook.');
        inv.raw_meat -= 1;
        inv.cooked_meat = (inv.cooked_meat ?? 0) + 1;
        npc.thought = 'Roasted tender meat over the fire!';
        return npc.thought;
      }
      throw new Error(`Unsupported recipe "${recipe}".`);
    }
    if (action === 'idle') {
      npc.hostile_target = null;
      npc.threatened_by = null;
      npc.current_action = 'idle';
      npc.animation = 'idle';
      npc.thought = 'Standing down cleanly.';
      return npc.thought;
    }
    if (action === 'attack') {
      const allNpcs: NpcState[] = [this.state.npc, ...this.extraAgents];
      const attackerId = npc.id ?? 'aiden';
      const targetId = String(params.target_id ?? '').trim();
      const targetName = String(params.target_name ?? '').trim().toLowerCase();
      const target = allNpcs.find(
        (peer, idx) =>
          (peer.id ?? (idx === 0 ? 'aiden' : `npc-${idx + 1}`)) !== attackerId &&
          ((targetId && (peer.id ?? 'aiden') === targetId) ||
            (targetName && peer.name.toLowerCase().includes(targetName)) ||
            (!targetId && !targetName)),
      );
      if (!target) {
        throw new Error('No other NPC available to target.');
      }
      const tid = target.id ?? 'aiden';
      npc.hostile_target = tid;
      npc.current_action = 'attack';
      npc.animation = 'hunting';
      npc.thought = `Attacking ${target.name}!`;
      target.threatened_by = attackerId;
      target.thought = `${npc.name} attacked me! Defending myself!`;
      return npc.thought;
    }
    if (action === 'hunt') {
      const weapon =
        (inv.iron_sword ?? 0) > 0
          ? 'iron_sword'
          : (inv.hunting_bow ?? 0) > 0
            ? 'hunting_bow'
            : (inv.wooden_spear ?? 0) > 0
              ? 'wooden_spear'
              : null;
      if (!weapon) {
        throw new Error('Craft or buy a weapon (Spear, Bow, or Sword) before hunting.');
      }
      const huntable = new Set(['deer', 'sheep', 'fox', 'duck']);
      const idx = this.demoEntities.findIndex((e) => huntable.has(e.kind));
      if (idx < 0) {
        throw new Error('No wild deer, sheep, fox, or duck on this island right now.');
      }
      const [prey] = this.demoEntities.splice(idx, 1);
      const meat = prey.kind === 'deer' ? 3 : prey.kind === 'sheep' ? 2 : 1;
      inv.raw_meat = (inv.raw_meat ?? 0) + meat;
      if (prey.kind === 'duck') inv.feather = (inv.feather ?? 0) + 3;
      else inv.hide = (inv.hide ?? 0) + (prey.kind === 'sheep' ? 1 : 2);
      npc.animation = 'hunting';
      npc.current_action = 'hunt';
      npc.thought = `Hunted ${prey.name} (${prey.kind}) using my ${weapon.replace(/_/g, ' ')}!`;
      npc.memories.unshift({ day: this.state.day, clock: this.state.clock_str, text: npc.thought });
      return npc.thought;
    }
    throw new Error(`Action "${action}" unavailable.`);
  }

  public reset(seed = Math.floor(Math.random() * 9000) + 1000): WorldInitMessage {
    const coins = this.state.coins ?? 250;
    this.state = this.createInitialState(seed, this.activeWorldId, coins, this.activeWorldName, this.activePreset);
    this.demoEntities = [];
    this.extraAgents = [];
    this.entityCounter = 0;
    this.agentCounter = 1;
    const reg = this.worldRegistry.find((w) => w.id === this.activeWorldId);
    if (reg) reg.seed = seed;
    if (this.activeWorldId === 'homestead') {
      this.gateClues = { anchor: false, conduit: false, core: false };
    }
    if (this.activePreset === 'market') {
      this.generateMarketIsland(seed);
    } else if (this.activePreset === 'homestead') {
      this.generateIsland(seed);
    } else {
      this.generatePresetIsland(this.activePreset, seed);
    }
    this.saveAutosave();
    return this.getInitMessage();
  }

  private cacheCurrentWorld(): void {
    this.cachedWorlds[this.activeWorldId] = {
      blocks: new Uint8Array(this.blocks),
      blockMeta: new Uint8Array(this.blockMeta),
      blockMaterials: [...this.blockMaterials],
      surfaceY: new Int8Array(this.surfaceY),
      state: structuredClone(this.state),
      entities: structuredClone(this.demoEntities),
      extraAgents: structuredClone(this.extraAgents),
      waypoints: structuredClone(this.waypoints),
      entityCounter: this.entityCounter,
      agentCounter: this.agentCounter,
      preset: this.activePreset,
      name: this.activeWorldName,
    };
  }

  public createWorld(payload: {
    name?: string;
    preset: WorldPresetId | string;
    seed?: number;
    starter_name?: string;
    starter_role?: AgentRole;
    switch?: boolean;
  }): WorldInitMessage | null {
    if (this.worldRegistry.length >= 12) {
      throw new Error('Maximum 12 floating worlds reached.');
    }
    const preset = String(payload.preset || 'homestead');
    const label = DEMO_PRESET_LABELS[preset] ?? 'Floating Island';
    const cleanName = (payload.name?.trim() || `${label} ${this.worldRegistry.length + 1}`).slice(0, 40);
    const baseSlug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `world-${this.worldRegistry.length + 1}`;
    let wid = baseSlug;
    let suffix = 2;
    while (this.worldRegistry.some((w) => w.id === wid)) {
      wid = `${baseSlug.slice(0, 28)}-${suffix}`;
      suffix += 1;
    }
    const chosenSeed = Number.isFinite(payload.seed) ? Number(payload.seed) : this.state.seed + 137 * this.worldRegistry.length;
    this.worldRegistry.push({ id: wid, name: cleanName, preset, seed: chosenSeed, builtin: false });

    const enter = payload.switch ?? true;
    const prevCoins = this.state.coins ?? 250;
    const prevHomeState = structuredClone(this.state);
    this.cacheCurrentWorld();

    this.activeWorldId = wid;
    this.activeWorldName = cleanName;
    this.activePreset = preset;
    this.demoEntities = [];
    this.extraAgents = [];
    this.entityCounter = 0;
    this.agentCounter = 1;
    this.state = this.createInitialState(chosenSeed, wid, prevCoins, cleanName, preset);
    if (payload.starter_name?.trim()) {
      this.state.npc.name = payload.starter_name.trim().slice(0, 32);
    }
    if (payload.starter_role) {
      this.state.npc.role = payload.starter_role;
    }
    if (preset === 'market') {
      this.generateMarketIsland(chosenSeed);
    } else if (preset === 'homestead') {
      this.generateIsland(chosenSeed);
    } else {
      this.generatePresetIsland(preset, chosenSeed);
    }
    if (wid !== 'homestead') {
      this.state.npc.current_goal = `Explore ${cleanName} and thrive`;
      this.state.npc.thought = `Welcome to ${cleanName} (${label})! Ready for God's creations.`;
      this.state.npc.memories.unshift({
        day: 1,
        clock: '06:28',
        text: `Arrived in God-created world "${cleanName}" (${label}).`,
      });
    }
    this.cacheCurrentWorld();

    if (enter) {
      this.saveAutosave();
      return this.getInitMessage();
    }

    // Restore previous active world if user chose not to switch immediately
    const prevId = prevHomeState.world_id ?? 'homestead';
    const back = this.cachedWorlds[prevId];
    if (back) {
      this.activeWorldId = prevId;
      this.activeWorldName = back.name;
      this.activePreset = back.preset;
      this.blocks = new Uint8Array(back.blocks);
      this.blockMeta = new Uint8Array(back.blockMeta);
      this.blockMaterials = [...back.blockMaterials];
      this.surfaceY = new Int8Array(back.surfaceY);
      this.state = structuredClone(back.state);
      this.demoEntities = structuredClone(back.entities);
      this.extraAgents = structuredClone(back.extraAgents);
      this.waypoints = structuredClone(back.waypoints);
      this.entityCounter = back.entityCounter;
      this.agentCounter = back.agentCounter;
    }
    return null;
  }

  public deleteWorld(worldId: string): WorldInitMessage | null {
    const wid = worldId.trim().toLowerCase();
    if (wid === 'homestead' || wid === 'market') {
      throw new Error(`Cannot delete built-in world "${wid}".`);
    }
    this.worldRegistry = this.worldRegistry.filter((w) => w.id !== wid);
    delete this.cachedWorlds[wid];
    if (this.activeWorldId === wid) {
      return this.switchWorld('homestead');
    }
    this.saveAutosave();
    return null;
  }

  public switchWorld(target: FloatingWorldId): WorldInitMessage {
    if (target === this.activeWorldId) {
      return this.getInitMessage();
    }
    const targetMeta = this.worldRegistry.find((w) => w.id === target);
    if (!targetMeta) {
      throw new Error(`Unknown world "${target}".`);
    }
    const prevCoins = this.state.coins ?? 250;
    const prevInv = { ...this.state.npc.inventory };
    const prevNeeds = { ...this.state.npc.needs };

    this.cacheCurrentWorld();

    this.activeWorldId = target;
    this.activeWorldName = targetMeta.name;
    this.activePreset = targetMeta.preset;
    const cached = this.cachedWorlds[target];
    if (cached) {
      this.blocks = new Uint8Array(cached.blocks);
      this.blockMeta = new Uint8Array(cached.blockMeta);
      this.blockMaterials = [...cached.blockMaterials];
      this.surfaceY = new Int8Array(cached.surfaceY);
      this.state = structuredClone(cached.state);
      this.demoEntities = structuredClone(cached.entities);
      this.extraAgents = structuredClone(cached.extraAgents);
      this.waypoints = structuredClone(cached.waypoints);
      this.entityCounter = cached.entityCounter;
      this.agentCounter = cached.agentCounter;
    } else {
      this.state = this.createInitialState(targetMeta.seed, target, prevCoins, targetMeta.name, targetMeta.preset);
      this.demoEntities = [];
      this.extraAgents = [];
      this.entityCounter = 0;
      this.agentCounter = 1;
      if (targetMeta.preset === 'market') {
        this.generateMarketIsland(targetMeta.seed);
      } else if (targetMeta.preset === 'homestead') {
        this.generateIsland(targetMeta.seed);
      } else {
        this.generatePresetIsland(targetMeta.preset, targetMeta.seed);
      }
    }

    this.state.world_id = target;
    this.state.world_name = targetMeta.name;
    this.state.world_preset = targetMeta.preset;
    this.state.coins = prevCoins;
    this.state.npc.inventory = prevInv;
    this.state.npc.needs = prevNeeds;
    this.saveAutosave();
    return this.getInitMessage();
  }

  public getMarketCatalog(): MarketCatalogPayload {
    return {
      coins: this.state.coins ?? 250,
      world: this.activeWorldId,
      shop_items: DEMO_SHOP_ITEMS,
      sell_prices: DEMO_SELL_PRICES,
    };
  }

  public marketBuy(itemId: string, quantity = 1, agentId?: string): string {
    const item = DEMO_SHOP_ITEMS.find((it) => it.id === itemId);
    if (!item) throw new Error(`Unknown shop item "${itemId}".`);
    const coins = this.state.coins ?? 250;
    const totalCost = item.price * quantity;
    if (coins < totalCost) throw new Error(`Not enough coins (${coins} available, need ${totalCost}).`);

    if (item.spawn_entity) {
      if (quantity !== 1) throw new Error('Companions are adopted one at a time.');
      this.handleGodIntervene('spawn_entity', { kind: item.spawn_entity });
      this.state.coins = coins - totalCost;
      return `Adopted ${item.name} for ${totalCost} coins.`;
    }
    const ag = agentId && agentId !== 'aiden' ? this.extraAgents.find((a) => a.id === agentId) : undefined;
    const inv = ag ? ag.inventory : this.state.npc.inventory;
    const key = item.grant_item ?? item.id;
    const totalQty = (item.grant_qty ?? 1) * quantity;
    inv[key] = (inv[key] ?? 0) + totalQty;
    this.state.coins = coins - totalCost;
    const msg = `Purchased ${item.name} (${totalQty}) for ${totalCost} coins.`;
    this.state.npc.memories.unshift({ day: this.state.day, clock: this.state.clock_str, text: msg });
    return msg;
  }

  public marketSell(itemKey: string, quantity = 1, agentId?: string): string {
    const unitPrice = DEMO_SELL_PRICES[itemKey];
    if (!unitPrice) throw new Error(`Merchants are not buying "${itemKey}".`);
    const ag = agentId && agentId !== 'aiden' ? this.extraAgents.find((a) => a.id === agentId) : undefined;
    const inv = ag ? ag.inventory : this.state.npc.inventory;
    const have = inv[itemKey] ?? 0;
    if (have < quantity) throw new Error(`Not enough ${itemKey.replace(/_/g, ' ')} to sell.`);
    const earned = unitPrice * quantity;
    inv[itemKey] = have - quantity;
    this.state.coins = (this.state.coins ?? 250) + earned;
    const msg = `Sold ${quantity} ${itemKey.replace(/_/g, ' ')} for +${earned} coins.`;
    this.state.npc.memories.unshift({ day: this.state.day, clock: this.state.clock_str, text: msg });
    return msg;
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

    // Ancient Ruined Gate Plinth at (10, 10, 14..16)
    this.setBlock(10, 10, 14, BlockId.STONE, 0, 'obsidian');
    this.setBlock(10, 10, 15, BlockId.STONE, 0, 'marble');
    this.setBlock(10, 10, 16, BlockId.STONE, 0, 'obsidian');
    for (let y = 11; y <= 13; y++) {
      for (const gz of [14, 15, 16]) {
        this.setBlock(10, y, gz, BlockId.AIR);
      }
    }

    const hx = 12;
    const hz = 12;
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

  private generatePresetIsland(preset: string, seed: number): void {
    this.blocks.fill(BlockId.AIR);
    this.blockMeta.fill(0);
    this.blockMaterials.fill('');
    this.surfaceY.fill(-1);
    this.rng = mulberry32(seed);
    this.actionTimer = 0;
    this.buildQueue = [];
    this.farmQueue = [];

    const specs: Record<
      string,
      { topBlock: number; topMat: string; rockMat: string; rimBoost: number; treeCap: number; ores: string[] }
    > = {
      alpine_peaks: { topBlock: BlockId.GRASS, topMat: 'meadow_grass', rockMat: 'slate', rimBoost: 3, treeCap: 20, ores: ['iron_vein', 'crystal_vein', 'gold_vein', 'marble'] },
      sakura_grove: { topBlock: BlockId.GRASS, topMat: 'meadow_grass', rockMat: 'marble', rimBoost: 1, treeCap: 18, ores: ['marble', 'crystal_vein', 'gold_vein', 'iron_vein'] },
      crystal_canyon: { topBlock: BlockId.COBBLESTONE, topMat: 'sandstone', rockMat: 'slate', rimBoost: 2, treeCap: 10, ores: ['crystal_vein', 'gold_vein', 'copper_vein', 'sunstone'] },
      obsidian_caldera: { topBlock: BlockId.STONE, topMat: 'obsidian', rockMat: 'slate', rimBoost: 3, treeCap: 8, ores: ['obsidian', 'sunstone', 'copper_vein', 'gold_vein'] },
      flat_sandbox: { topBlock: BlockId.GRASS, topMat: 'meadow_grass', rockMat: 'granite', rimBoost: 0, treeCap: 5, ores: ['iron_vein', 'coal_vein', 'marble', 'crystal_vein'] },
    };
    const cfg = specs[preset] ?? specs.alpine_peaks;

    for (let x = 2; x <= 30; x++) {
      for (let z = 2; z <= 30; z++) {
        const r = Math.hypot((x - 16) / 14, (z - 16) / 13);
        const ripple = Math.sin(x * 0.44 + seed * 0.13) * Math.cos(z * 0.38 - seed * 0.09);
        if (r > 1.0 + 0.05 * ripple) continue;
        const ridge = preset === 'flat_sandbox' ? 0 : Math.max(0, Math.floor((r + ripple * 0.14 - 0.55) * cfg.rimBoost * 2.2));
        let top = 10 + Math.min(4, ridge);
        if (x >= 10 && x <= 25 && z >= 10 && z <= 21) top = 10;
        const bottom = Math.max(3, Math.min(top - 1, 3 + Math.floor(5.5 * r * r + ripple * 0.6)));
        for (let y = bottom; y <= top; y++) {
          if (y === top) {
            if ((preset === 'crystal_canyon' || preset === 'obsidian_caldera') && x >= 12 && x <= 20 && z >= 12 && z <= 20) {
              this.setBlock(x, y, z, BlockId.GRASS, 0, 'meadow_grass');
            } else {
              this.setBlock(x, y, z, cfg.topBlock, 0, cfg.topMat);
            }
          } else if (y >= top - 2) {
            this.setBlock(x, y, z, BlockId.DIRT);
          } else {
            const mat = y <= 4 ? 'obsidian' : preset === 'obsidian_caldera' && y === 5 && (x + z) % 6 === 0 ? 'sunstone' : cfg.rockMat;
            this.setBlock(x, y, z, BlockId.STONE, 0, mat);
          }
        }
        this.surfaceY[z * WORLD_WIDTH + x] = top;
      }
    }

    for (let x = 21; x <= 24; x++) {
      for (let z = 14; z <= 17; z++) {
        if (((x - 22.5) / 2.1) ** 2 + ((z - 15.5) / 2.2) ** 2 < 1) {
          this.setBlock(x, 9, z, BlockId.DIRT, 0, preset === 'crystal_canyon' ? 'sandy_bank' : 'clay_bank');
          this.setBlock(x, 10, z, BlockId.WATER);
          this.surfaceY[z * WORLD_WIDTH + x] = 10;
        }
      }
    }

    if (preset === 'sakura_grove') {
      for (let x = 12; x <= 20; x++) {
        for (const z of [14, 18]) {
          if (this.getBlock(x, 10, z) !== BlockId.WATER) this.setBlock(x, 10, z, BlockId.COBBLESTONE, 0, 'marble');
        }
      }
      for (const [lx, lz] of [[11, 14], [11, 18], [20, 14], [20, 18]]) {
        this.setBlock(lx, 11, lz, BlockId.TORCH, 0, 'copper_lantern');
      }
    } else if (preset === 'crystal_canyon' || preset === 'obsidian_caldera') {
      const accent = preset === 'crystal_canyon' ? 'crystal_vein' : 'sunstone';
      for (const [px, pz, h] of [[7, 8, 2], [24, 8, 2], [7, 23, 2], [25, 22, 1]]) {
        const sy = this.surfaceY[pz * WORLD_WIDTH + px];
        if (sy > 0) {
          for (let dy = 1; dy <= h + 1; dy++) {
            this.setBlock(px, sy + dy, pz, BlockId.STONE, 0, dy === h + 1 ? accent : cfg.rockMat);
          }
        }
      }
    }

    let treesPlaced = 0;
    const treePts: Array<{ x: number; z: number }> = [];
    for (let z = 4; z < WORLD_DEPTH - 4; z++) {
      for (let x = 4; x < WORLD_WIDTH - 4; x++) {
        if (x >= 10 && x <= 25 && z >= 10 && z <= 21) continue;
        const sy = this.surfaceY[z * WORLD_WIDTH + x];
        if (sy <= 0 || this.getBlock(x, sy, z) === BlockId.WATER) continue;
        if (treePts.some((tp) => Math.hypot(tp.x - x, tp.z - z) < 3.1)) continue;
        const r = this.rng();
        if (treesPlaced < cfg.treeCap && r < 0.16) {
          this.setBlock(x, sy, z, BlockId.GRASS, 0, 'meadow_grass');
          this.placeTree(x, sy + 1, z);
          treePts.push({ x, z });
          treesPlaced += 1;
        } else if (r >= 0.16 && r < 0.19) {
          this.setBlock(x, sy + 1, z, BlockId.STONE, 0, cfg.ores[treesPlaced % cfg.ores.length]);
        } else if (r >= 0.19 && r < 0.21) {
          this.setBlock(x, sy + 1, z, BlockId.WILD_BERRY);
        }
      }
    }

    this.state.npc.position = { x: 16, y: 11, z: 20 };
    this.state.npc.grid_pos = { x: 16, y: 11, z: 20 };
    this.state.stats.trees_count = treesPlaced;
    this.waypoints = [
      { x: 16, z: 18, action: 'exploring', goal: `Explore ${this.activeWorldName}`, thought: `Surveying ${this.activeWorldName} after God conjured it!` },
      { x: 19, z: 15, action: 'drinking', goal: 'Inspect spring water', thought: 'Found freshwater along the clearing bank.' },
      { x: 12, z: 14, action: 'thinking', goal: 'Plan camp layout', thought: 'Plenty of space here to build and craft.' },
    ];
    this.waypointIdx = 0;
  }

  private generateMarketIsland(seed: number): void {
    this.blocks.fill(BlockId.AIR);
    this.blockMeta.fill(0);
    this.blockMaterials.fill('');
    this.surfaceY.fill(-1);
    this.rng = mulberry32(seed);
    this.actionTimer = 0;
    this.buildQueue = [];
    this.farmQueue = [];

    for (let z = 3; z < WORLD_DEPTH - 2; z++) {
      for (let x = 3; x < WORLD_WIDTH - 2; x++) {
        const dx = (x - 16) / 13.5;
        const dz = (z - 16) / 12.8;
        const nEdge = (valueNoise2D(x * 0.16, z * 0.16, seed) - 0.5) * 0.2;
        const dist = Math.hypot(dx, dz) + nEdge;
        if (dist > 1.0) continue;
        const topY = 10;
        const bottomY = Math.max(3, Math.min(9, 3 + Math.round(5.5 * dist * dist)));
        for (let y = bottomY; y <= topY; y++) {
          if (y === topY) this.setBlock(x, y, z, BlockId.GRASS, 0, 'meadow_grass');
          else if (y >= topY - 2) this.setBlock(x, y, z, BlockId.DIRT);
          else this.setBlock(x, y, z, BlockId.STONE, 0, y <= 4 ? 'obsidian' : y < 7 ? 'slate' : 'granite');
        }
        this.surfaceY[z * WORLD_WIDTH + x] = topY;
      }
    }

    for (let x = 9; x <= 23; x++) {
      for (let z = 9; z <= 23; z++) {
        if ((x >= 12 && x <= 20 && z >= 12 && z <= 20) || (x >= 14 && x <= 18) || (z >= 14 && z <= 18)) {
          const isBorder = x === 9 || x === 12 || x === 20 || x === 23 || z === 9 || z === 12 || z === 20 || z === 23;
          this.setBlock(x, 10, z, BlockId.COBBLESTONE, 0, (x + z) % 2 === 0 && !isBorder ? 'marble' : 'sandstone');
        }
      }
    }

    for (let x = 15; x <= 17; x++) {
      for (let z = 15; z <= 17; z++) {
        if (x === 16 && z === 16) {
          this.setBlock(x, 10, z, BlockId.STONE, 0, 'marble');
          this.setBlock(x, 11, z, BlockId.STONE, 0, 'sunstone');
        } else {
          this.setBlock(x, 9, z, BlockId.STONE, 0, 'marble');
          this.setBlock(x, 10, z, BlockId.WATER);
        }
      }
    }

    const buildStall = (
      ox: number,
      oz: number,
      counterMat: string,
      postMat: string,
      roofMat: string,
      display: Array<[number, number, string]>,
    ) => {
      for (let dx = 0; dx < 5; dx++) {
        for (let dz = 0; dz < 4; dz++) {
          this.setBlock(ox + dx, 10, oz + dz, BlockId.WOOD_PLANK, 0, 'walnut_boards');
        }
      }
      for (const px of [ox, ox + 4]) {
        for (const pz of [oz, oz + 3]) {
          for (let py = 11; py <= 13; py++) this.setBlock(px, py, pz, BlockId.WOOD_LOG, 0, postMat);
        }
      }
      for (let dx = 1; dx <= 3; dx++) {
        this.setBlock(
          ox + dx,
          11,
          oz + 3,
          counterMat.endsWith('boards') || counterMat.endsWith('planks') ? BlockId.WOOD_PLANK : BlockId.COBBLESTONE,
          0,
          counterMat,
        );
      }
      for (const [dx, bType, mat] of display) {
        this.setBlock(ox + dx, 11, oz + 1, bType, 0, mat);
      }
      this.setBlock(ox, 12, oz + 3, BlockId.TORCH, 0, 'copper_lantern');
      this.setBlock(ox + 4, 12, oz + 3, BlockId.TORCH, 0, 'copper_lantern');
      for (let dx = 0; dx < 5; dx++) {
        for (let dz = 0; dz < 4; dz++) {
          this.setBlock(ox + dx, 14, oz + dz, BlockId.ROOF_SHINGLE, 0, roofMat);
        }
      }
    };

    buildStall(7, 7, 'bamboo_planks', 'oak_bark', 'terracotta_roof', [
      [1, BlockId.CHEST, ''],
      [2, BlockId.CRAFTING_BENCH, ''],
      [3, BlockId.CHEST, ''],
    ]);
    buildStall(20, 7, 'marble', 'birch_bark', 'slate_roof', [
      [1, BlockId.STONE, 'gold_vein'],
      [2, BlockId.STONE, 'crystal_vein'],
      [3, BlockId.COBBLESTONE, 'copper_block'],
    ]);
    buildStall(20, 19, 'walnut_boards', 'pine_bark', 'cedar_shingle', [
      [1, BlockId.CRAFTING_BENCH, ''],
      [2, BlockId.GLASS, 'stained_glass'],
      [3, BlockId.CHEST, ''],
    ]);

    for (const [tx, tz] of [
      [6, 15],
      [15, 6],
      [26, 14],
      [10, 25],
      [23, 25],
    ]) {
      if (this.getBlock(tx, 10, tz) === BlockId.GRASS) {
        this.placeTree(tx, 11, tz);
      }
    }

    for (const [lx, lz] of [
      [14, 22],
      [18, 22],
      [13, 13],
      [19, 13],
    ]) {
      this.setBlock(lx, 11, lz, BlockId.TORCH, 0, 'copper_lantern');
    }

    // Active Return Sky Gate at South Plaza (15..17, 10..13, 25)
    this.setBlock(15, 10, 25, BlockId.STONE, 0, 'obsidian');
    this.setBlock(16, 10, 25, BlockId.STONE, 0, 'marble');
    this.setBlock(17, 10, 25, BlockId.STONE, 0, 'obsidian');
    for (const gx of [15, 17]) {
      this.setBlock(gx, 11, 25, BlockId.STONE, 0, 'obsidian');
      this.setBlock(gx, 12, 25, BlockId.STONE, 0, 'marble');
      this.setBlock(gx, 13, 25, BlockId.STONE, 0, 'crystal_vein');
    }
    this.setBlock(16, 13, 25, BlockId.STONE, 0, 'sunstone');

    this.state.npc.position = { x: 16, y: 11, z: 22 };
    this.state.npc.grid_pos = { x: 16, y: 11, z: 22 };
    this.state.npc.current_goal = 'Browse the floating bazaar stalls and trade goods';
    this.state.npc.thought = 'Welcome to the Sky Market! Click Shop or inspect a merchant to buy rare goods.';
    this.state.stats.house_progress = 100;
    this.state.stats.house_stage = 'complete';

    const merchants: Array<[EntityKind, string, number, number, number]> = [
      ['villager', 'Baker Pip', 9, 9, 0],
      ['villager', 'Jeweler Kai', 22, 9, 1],
      ['villager', 'Artisan Nora', 22, 21, 2],
      ['cat', 'Mochi', 14, 14, 0],
      ['duck', 'Puddle', 15, 16, 3],
    ];
    for (const [kind, name, mx, mz, variant] of merchants) {
      this.entityCounter += 1;
      this.demoEntities.push({
        id: `ent-${this.entityCounter}`,
        kind,
        name,
        variant,
        position: { x: mx, y: 11, z: mz },
        grid_pos: { x: mx, y: 11, z: mz },
        yaw: 0,
        animation: 'idle',
        target: null,
        wait: 2.0,
      });
    }

    this.waypoints = [
      { x: 16, z: 19, action: 'exploring', goal: 'Browse Sky Market plaza', thought: 'The marble fountain gleams beside the stalls!' },
      { x: 9, z: 11, action: 'thinking', goal: 'Visit Baker Pip stall', thought: 'Warm bread and berries fresh from the sky bakery.' },
      { x: 22, z: 11, action: 'thinking', goal: 'Browse Jeweler Kai minerals', thought: 'Crystal veins and gleaming gold ore on display!' },
      { x: 21, z: 18, action: 'exploring', goal: 'Check Timber Studio', thought: 'Walnut timber and stained glass look ready for Homestead.' },
    ];
    this.waypointIdx = 0;
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

    if (dist > 0.25 && !npc.hostile_target && !npc.threatened_by) {
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
    } else if (!npc.hostile_target && !npc.threatened_by) {
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
    this.stepAutonomousGate(blockUpdates);

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
    if (this.state.tick % 15 === 0) {
      this.saveAutosave();
    }
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
      if (ag.hostile_target || ag.threatened_by) {
        continue;
      }
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

    this.stepCombat(dt);
  }

  private stepCombat(dt: number): void {
    const fighters: NpcState[] = [this.state.npc, ...this.extraAgents];
    const strikeCooldown = Math.max(0.2, dt * 10);
    for (const f of [...fighters]) {
      const fid = f.id ?? 'aiden';
      const tid = f.threatened_by || f.hostile_target;
      if (!tid) continue;
      const target = fighters.find((p, i) => (p.id ?? (i === 0 ? 'aiden' : `npc-${i + 1}`)) === tid);
      if (!target || target === f) {
        f.hostile_target = null;
        f.threatened_by = null;
        continue;
      }
      const dx = target.position.x - f.position.x;
      const dz = target.position.z - f.position.z;
      const d = Math.hypot(dx, dz);
      f.yaw = Math.atan2(dx, dz);
      f.path = [];
      const weapon =
        (f.inventory.iron_sword ?? 0) > 0
          ? 'iron_sword'
          : (f.inventory.hunting_bow ?? 0) > 0
            ? 'hunting_bow'
            : (f.inventory.wooden_spear ?? 0) > 0
              ? 'wooden_spear'
              : null;
      const reach = weapon === 'hunting_bow' ? 3.2 : 1.7;
      if (d > reach) {
        const move = Math.min(d - 1.0, 2.5 * dt);
        f.position.x += (dx / d) * move;
        f.position.z += (dz / d) * move;
        const gx = Math.max(1, Math.min(WORLD_WIDTH - 2, Math.round(f.position.x)));
        const gz = Math.max(1, Math.min(WORLD_DEPTH - 2, Math.round(f.position.z)));
        const sy = Math.max(9, this.surfaceY[gz * WORLD_WIDTH + gx]);
        f.position.y = sy + 1;
        f.grid_pos = { x: gx, y: sy + 1, z: gz };
        f.animation = 'walking';
        f.current_action = 'attack';
        continue;
      }

      // Engage & trigger defender self-defense
      f.animation = 'hunting';
      f.current_action = 'attack';
      f.current_goal = f.threatened_by === tid ? `Defending against ${target.name}` : `Attacking ${target.name}`;
      if (!target.threatened_by) {
        target.threatened_by = fid;
        target.thought = `${f.name} attacked me! Defending myself!`;
      }

      if (this.state.tick % 8 === 0 && strikeCooldown > 0) {
        const base = weapon === 'iron_sword' ? 34 : weapon === 'hunting_bow' ? 24 : weapon === 'wooden_spear' ? 20 : 11;
        const dmg = target.threatened_by === fid ? base * 0.8 : base;
        target.needs.health = Math.max(0, Number((target.needs.health - dmg).toFixed(1)));
        if (target.needs.health <= 0) {
          for (const [k, qty] of Object.entries(target.inventory)) {
            if (qty > 0) {
              f.inventory[k] = (f.inventory[k] ?? 0) + qty;
              target.inventory[k] = 0;
            }
          }
          f.hostile_target = null;
          f.threatened_by = null;
          f.animation = 'idle';
          f.current_action = 'idle';
          if (tid !== 'aiden') {
            this.extraAgents = this.extraAgents.filter((a) => a.id !== tid);
            for (const peer of [this.state.npc, ...this.extraAgents]) {
              if (peer.hostile_target === tid) peer.hostile_target = null;
              if (peer.threatened_by === tid) peer.threatened_by = null;
            }
            f.thought = `Defeated ${target.name} in combat.`;
          } else {
            target.needs.health = 25;
            target.hostile_target = null;
            target.threatened_by = null;
            target.position = { x: 16, y: 11, z: 20 };
            target.grid_pos = { x: 16, y: 11, z: 20 };
            target.thought = `Knocked out by ${f.name} and barely recovered!`;
            f.thought = `Overpowered ${target.name}!`;
          }
        }
      }
    }
  }

  private stepAutonomousGate(updates: BlockUpdate[]): void {
    if (this.activeWorldId !== 'homestead' || this.state.tick < 18 || this.state.tick % 24 !== 0) return;
    const npc = this.state.npc;
    if (npc.hostile_target || npc.threatened_by) return;
    const gate = this.getGateState();
    if (gate.unlocked) return;

    if (!this.gateClues.anchor) {
      this.gateClues.anchor = true;
      npc.current_action = 'study_gate';
      npc.current_goal = 'Decipher Sky Teleport Gate runes';
      npc.thought = 'Studied the West Clearing plinth: Obsidian crust anchors the portal foundation!';
      npc.memories.unshift({ day: this.state.day, clock: this.state.clock_str, text: npc.thought });
      return;
    }
    if (!this.gateClues.conduit) {
      this.gateClues.conduit = true;
      npc.current_action = 'study_gate';
      npc.current_goal = 'Decipher Sky Teleport Gate runes';
      npc.thought = 'Decoded the pillars: White Marble columns crowned with glowing Crystal conduits!';
      npc.memories.unshift({ day: this.state.day, clock: this.state.clock_str, text: npc.thought });
      return;
    }
    if (!this.gateClues.core) {
      this.gateClues.core = true;
      npc.current_action = 'study_gate';
      npc.current_goal = 'Build Sky Teleport Gate';
      npc.thought = 'Solved Rune III! Crystal + Gold Ore forges the radiant Sunstone keystone!';
      npc.memories.unshift({ day: this.state.day, clock: this.state.clock_str, text: npc.thought });
      return;
    }

    const nextPart = DEMO_GATE_ARCH.find((p) => {
      const idx = blockIndex(p.x, p.y, p.z);
      return !(this.blocks[idx] === BlockId.STONE && this.blockMaterials[idx] === p.surface);
    });
    if (!nextPart) return;

    this.setBlock(nextPart.x, nextPart.y, nextPart.z, BlockId.STONE, 0, nextPart.surface);
    this.state.stats.blocks_placed += 1;
    updates.push({
      x: nextPart.x,
      y: nextPart.y,
      z: nextPart.z,
      block: BlockId.STONE,
      meta: 0,
      material: nextPart.surface,
    });
    npc.current_action = 'build_gate';
    npc.current_goal = 'Build Sky Teleport Gate';
    const done = this.getGateState().unlocked;
    npc.thought = done
      ? 'Finished assembling the Sky Teleport Gate! The portal to Sky Market is alive!'
      : `Gathered & placed ${nextPart.surface.replace(/_/g, ' ')} onto the Teleport Gate arch.`;
    if (done) {
      npc.memories.unshift({ day: this.state.day, clock: this.state.clock_str, text: npc.thought });
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
    this.saveAutosave();
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
      const low = msg.toLowerCase();
      const allNpcs: NpcState[] = [this.state.npc, ...this.extraAgents];
      const stop = ['stop fighting', 'peace', 'cease', 'stand down', 'calm'].some((k) => low.includes(k));
      const attackVerbs = ['kill', 'attack', 'fight', 'slay', 'defeat', 'eliminate', 'strike'];
      const verbPositions = attackVerbs.map((v) => low.indexOf(v)).filter((i) => i >= 0);
      const verbPos = verbPositions.length > 0 ? Math.min(...verbPositions) : -1;
      const killIntent = verbPos >= 0;

      let recipients: NpcState[] =
        agentId === 'all' ? allNpcs : targetAgent ? [targetAgent] : [this.state.npc];
      if (killIntent && agentId === 'all' && verbPos > 0) {
        const pre = low.slice(0, verbPos);
        const namedAttackers = allNpcs.filter((p) => pre.includes(p.name.toLowerCase()));
        if (namedAttackers.length > 0) recipients = namedAttackers;
      }

      const pickPreyFor = (agId: string): NpcState | undefined => {
        const peers = allNpcs.filter((p, idx) => (p.id ?? (idx === 0 ? 'aiden' : `npc-${idx + 1}`)) !== agId);
        if (verbPos >= 0) {
          const post = low.slice(verbPos);
          const after = peers.filter((p) => post.includes(p.name.toLowerCase()));
          if (after.length > 0) {
            after.sort((a, b) => post.indexOf(a.name.toLowerCase()) - post.indexOf(b.name.toLowerCase()));
            return after[0];
          }
        }
        return peers.find((p) => low.includes(p.name.toLowerCase())) ?? (peers.length === 1 ? peers[0] : undefined);
      };

      for (const ag of recipients) {
        const agId = ag.id ?? 'aiden';
        ag.memories.unshift({ day: this.state.day, clock: this.state.clock_str, text: `Whisper: "${msg}"` });
        if (stop) {
          ag.hostile_target = null;
          ag.threatened_by = null;
          ag.current_action = 'idle';
          ag.animation = 'idle';
          ag.thought = 'Standing down as instructed.';
        } else if (killIntent) {
          const namedTarget = pickPreyFor(agId);
          if (namedTarget && (namedTarget.id ?? 'aiden') !== agId) {
            ag.hostile_target = namedTarget.id ?? 'aiden';
            ag.current_action = 'attack';
            ag.animation = 'hunting';
            ag.thought = `Understood. Moving to attack ${namedTarget.name}!`;
            namedTarget.threatened_by = agId;
            namedTarget.current_action = 'attack';
            namedTarget.animation = 'hunting';
            namedTarget.thought = `${ag.name} is attacking me! Defending myself!`;
          } else {
            ag.thought = `I heard a whisper: "${msg}"`;
          }
        } else {
          ag.thought = `I heard a whisper: "${msg}"`;
        }
      }
      this.state.npc.memories = this.state.npc.memories.slice(0, 15);
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
    this.saveAutosave();
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
      hostile_target: a.hostile_target ?? null,
      threatened_by: a.threatened_by ?? null,
      memories: [...a.memories],
      journal: [...a.journal],
      explored: true,
      last_journal_day: state.day,
      last_plant_time: -999,
    });

    return {
      format: 'land66-save-v1',
      save_version: 1,
      world_id: this.activeWorldId,
      world_name: this.activeWorldName,
      biome: this.activePreset,
      coins: state.coins ?? 250,
      gate_clues: { ...this.gateClues },
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

    const rawBiome = String((payload as Record<string, unknown>).biome ?? 'homestead');
    const rawWorldId = String((payload as Record<string, unknown>).world_id ?? rawBiome).trim().toLowerCase() || 'homestead';
    const rawWorldName = String(
      (payload as Record<string, unknown>).world_name ??
        (rawWorldId === 'homestead' ? 'Homestead' : rawWorldId === 'market' ? 'Market' : DEMO_PRESET_LABELS[rawBiome] ?? rawWorldId),
    ).slice(0, 40);
    const coins = Math.max(0, Number((payload as Record<string, unknown>).coins ?? 250));
    const rawClues = (payload as Record<string, unknown>).gate_clues as Record<string, unknown> | undefined;
    this.gateClues =
      rawWorldId !== 'homestead'
        ? { anchor: true, conduit: true, core: true }
        : {
            anchor: Boolean(rawClues?.anchor),
            conduit: Boolean(rawClues?.conduit),
            core: Boolean(rawClues?.core),
          };
    if (!this.worldRegistry.some((w) => w.id === rawWorldId)) {
      this.worldRegistry.push({ id: rawWorldId, name: rawWorldName, preset: rawBiome, seed, builtin: false });
    }
    this.activeWorldId = rawWorldId;
    this.activeWorldName = rawWorldName;
    this.activePreset = rawBiome;
    this.state = this.createInitialState(seed, rawWorldId, coins, rawWorldName, rawBiome);
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
        hostile_target: (src.hostile_target as string | null | undefined) ?? null,
        threatened_by: (src.threatened_by as string | null | undefined) ?? null,
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
    if (this.waypoints.length === 0) {
      this.waypoints = [
        { x: 16, z: 18, action: 'exploring', goal: `Explore ${rawWorldName}`, thought: `Continuing life inside ${rawWorldName}.` },
        { x: 19, z: 15, action: 'thinking', goal: 'Observe surroundings', thought: 'Everything feels peaceful here.' },
      ];
    }

    return this.getInitMessage();
  }

  public saveAutosave(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      this.cacheCurrentWorld();
      const serializedWorlds: Record<string, WorldSavePayload> = {};
      const snapshotNow = this.activeWorldId;
      for (const [wid, cached] of Object.entries(this.cachedWorlds)) {
        if (!cached) continue;
        // Temporarily project cached world fields to build consistent save payloads
        const DAY_SECONDS = 360.0;
        const st = cached.state;
        const elapsed = ((st.day - 1) + st.time_of_day) * DAY_SECONDS;
        const primary: NpcState = { ...st.npc, id: 'aiden', role: st.npc.role ?? 'pioneer', variant: st.npc.variant ?? 0 };
        const agents: NpcState[] = [
          primary,
          ...cached.extraAgents.map(({ target: _t, wait: _w, llmConfig: _cfg, ...rest }) => rest),
        ];
        serializedWorlds[wid] = {
          format: 'land66-save-v1',
          save_version: 1,
          world_id: wid,
          world_name: cached.name,
          biome: cached.preset,
          coins: st.coins ?? 250,
          gate_clues: { ...this.gateClues },
          saved_at: new Date().toISOString(),
          seed: st.seed,
          tick: st.tick,
          elapsed: Number(elapsed.toFixed(4)),
          paused: st.paused,
          speed: st.speed,
          weather: st.weather,
          weather_override: false,
          blocks_placed: st.stats.blocks_placed,
          blocks_broken: st.stats.blocks_broken,
          entity_counter: cached.entityCounter,
          agent_counter: cached.agentCounter,
          world: {
            seed: st.seed,
            width: WORLD_WIDTH,
            height: WORLD_HEIGHT,
            depth: WORLD_DEPTH,
            blocks: Array.from(cached.blocks),
            meta: Array.from(cached.blockMeta),
            materials: Object.fromEntries(
              cached.blockMaterials
                .map((m, i) => (m ? [String(i), m] : null))
                .filter((e): e is [string, string] => e !== null),
            ),
          },
          entities: cached.entities.map((e) => ({ ...e })),
          agents: agents.map((a, idx) => ({
            id: a.id ?? (idx === 0 ? 'aiden' : `npc-${idx + 1}`),
            name: a.name,
            role: a.role ?? 'pioneer',
            variant: a.variant ?? idx,
            position: [a.position.x, a.position.y, a.position.z],
            grid_pos: [a.grid_pos.x, a.grid_pos.y, a.grid_pos.z],
            yaw: a.yaw,
            needs: { ...a.needs },
            inventory: { ...a.inventory },
            current_goal: a.current_goal,
            thought: a.thought,
            hostile_target: a.hostile_target ?? null,
            threatened_by: a.threatened_by ?? null,
            memories: [...a.memories],
            journal: [...a.journal],
          })),
          brains: {},
        };
      }
      const bundle = {
        format: 'land66-offline-autosave-v1',
        activeWorldId: snapshotNow,
        worldRegistry: this.worldRegistry,
        gateClues: this.gateClues,
        worlds: serializedWorlds,
      };
      window.localStorage.setItem(OFFLINE_AUTOSAVE_KEY, JSON.stringify(bundle));
    } catch {
      // Ignore storage quota or disabled storage errors cleanly
    }
  }

  public restoreAutosave(): boolean {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;
      const raw = window.localStorage.getItem(OFFLINE_AUTOSAVE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as {
        format?: string;
        activeWorldId?: string;
        worldRegistry?: Array<{ id: string; name: string; preset: string; seed: number; builtin: boolean }>;
        gateClues?: { anchor?: boolean; conduit?: boolean; core?: boolean };
        worlds?: Record<string, WorldSavePayload>;
      };
      if (parsed?.format !== 'land66-offline-autosave-v1' || !parsed.worlds || typeof parsed.worlds !== 'object') {
        return false;
      }
      const worldEntries = Object.entries(parsed.worlds);
      if (worldEntries.length === 0) return false;

      if (Array.isArray(parsed.worldRegistry) && parsed.worldRegistry.length > 0) {
        this.worldRegistry = parsed.worldRegistry;
      }
      const savedClues = parsed.gateClues
        ? {
            anchor: Boolean(parsed.gateClues.anchor),
            conduit: Boolean(parsed.gateClues.conduit),
            core: Boolean(parsed.gateClues.core),
          }
        : undefined;

      this.cachedWorlds = {};
      for (const [wid, wPayload] of worldEntries) {
        if (!wPayload?.world?.blocks) continue;
        this.loadSave(wPayload);
        if (wid === 'homestead' && savedClues) {
          this.gateClues = { ...savedClues };
        }
        this.cacheCurrentWorld();
      }
      if (savedClues) {
        this.gateClues = savedClues;
      }

      const targetId =
        parsed.activeWorldId && this.cachedWorlds[parsed.activeWorldId]
          ? parsed.activeWorldId
          : 'homestead';
      const targetCached = this.cachedWorlds[targetId];
      if (!targetCached) return false;
      this.activeWorldId = targetId;
      this.activeWorldName = targetCached.name;
      this.activePreset = targetCached.preset;
      this.blocks = new Uint8Array(targetCached.blocks);
      this.blockMeta = new Uint8Array(targetCached.blockMeta);
      this.blockMaterials = [...targetCached.blockMaterials];
      this.surfaceY = new Int8Array(targetCached.surfaceY);
      this.state = structuredClone(targetCached.state);
      this.demoEntities = structuredClone(targetCached.entities);
      this.extraAgents = structuredClone(targetCached.extraAgents);
      this.waypoints = structuredClone(targetCached.waypoints);
      this.entityCounter = targetCached.entityCounter;
      this.agentCounter = targetCached.agentCounter;
      return true;
    } catch {
      return false;
    }
  }
}

const OFFLINE_SAVES_KEY = 'land66_offline_saves_v1';
const OFFLINE_AUTOSAVE_KEY = 'land66_offline_autosave_v1';

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
