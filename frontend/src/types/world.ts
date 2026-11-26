export const WORLD_WIDTH = 32;
export const WORLD_HEIGHT = 24;
export const WORLD_DEPTH = 32;
export const WORLD_VOLUME = WORLD_WIDTH * WORLD_HEIGHT * WORLD_DEPTH;

export const BlockId = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  WATER: 4,
  WOOD_LOG: 5,
  LEAVES: 6,
  WOOD_PLANK: 7,
  COBBLESTONE: 8,
  GLASS: 9,
  DOOR_CLOSED: 10,
  DOOR_OPEN: 11,
  BED: 12,
  CHEST: 13,
  CRAFTING_BENCH: 14,
  TORCH: 15,
  FARMLAND: 16,
  CROP_WHEAT: 17,
  WILD_BERRY: 18,
  SAPLING: 19,
  ROOF_SHINGLE: 20,
  FENCE: 21,
} as const;

export type BlockTypeId = (typeof BlockId)[keyof typeof BlockId];

export const BLOCK_NAMES: Record<number, string> = {
  0: 'air',
  1: 'grass',
  2: 'dirt',
  3: 'stone',
  4: 'water',
  5: 'wood_log',
  6: 'leaves',
  7: 'wood_plank',
  8: 'cobblestone',
  9: 'glass',
  10: 'door_closed',
  11: 'door_open',
  12: 'bed',
  13: 'chest',
  14: 'crafting_bench',
  15: 'torch',
  16: 'farmland',
  17: 'crop_wheat',
  18: 'wild_berry',
  19: 'sapling',
  20: 'roof_shingle',
  21: 'fence',
};

export const BLOCK_LABELS: Record<number, string> = {
  0: 'Air',
  1: 'Grass Block',
  2: 'Dirt',
  3: 'Stone',
  4: 'Freshwater',
  5: 'Oak Wood Log',
  6: 'Tree Leaves',
  7: 'Wood Planks',
  8: 'Cobblestone',
  9: 'Glass Pane',
  10: 'Wooden Door (Closed)',
  11: 'Wooden Door (Open)',
  12: 'Bed',
  13: 'Storage Chest',
  14: 'Crafting Bench',
  15: 'Torch',
  16: 'Farmland Soil',
  17: 'Wheat Crop',
  18: 'Wild Berry Bush',
  19: 'Tree Sapling',
  20: 'Roof Shingle',
  21: 'Wooden Fence',
};

export function blockIndex(
  x: number,
  y: number,
  z: number,
  width = WORLD_WIDTH,
  depth = WORLD_DEPTH,
): number {
  return y * (width * depth) + z * width + x;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type NpcAnimation =
  | 'idle'
  | 'walking'
  | 'chopping'
  | 'mining'
  | 'building'
  | 'tilling'
  | 'planting'
  | 'watering'
  | 'harvesting'
  | 'eating'
  | 'drinking'
  | 'sleeping'
  | 'thinking';

export type DayPhase = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';
export type WeatherType = 'clear' | 'rain' | 'storm';
export type SimSpeed = 1 | 2 | 5;

export interface NpcNeeds {
  hunger: number;
  energy: number;
  thirst: number;
  health: number;
  mood: number;
}

export interface NearbyEntity {
  kind: string;
  distance: number;
  x: number;
  y: number;
  z: number;
  label?: string;
}

export interface NpcPerception {
  location_label: string;
  sheltered: boolean;
  visible_summary: string;
  nearby_entities: NearbyEntity[];
}

export interface MemoryItem {
  day?: number;
  clock?: string;
  text: string;
}

export type AgentRole = 'pioneer' | 'builder' | 'farmer' | 'forager' | 'explorer';

export interface NpcState {
  id?: string;
  name: string;
  role?: AgentRole | string;
  variant?: number;
  position: Vec3;
  grid_pos: Vec3;
  yaw: number;
  animation: NpcAnimation | string;
  action_progress: number;
  current_action: string;
  current_goal: string;
  thought: string;
  needs: NpcNeeds;
  inventory: Record<string, number>;
  target_block: Vec3 | null;
  path: Vec3[];
  perception: NpcPerception;
  memories: Array<MemoryItem | string>;
  journal: Array<MemoryItem | string>;
  llm_status?: LlmStatus;
}

export interface HouseBounds {
  min_x: number;
  max_x: number;
  min_z: number;
  max_z: number;
  min_y?: number;
  max_y?: number;
}

export interface WorldStats {
  trees_count: number;
  house_progress: number;
  house_stage: string;
  house_bounds: HouseBounds | null;
  farm_plots: number;
  crops_growing: number;
  crops_ripe: number;
  blocks_placed: number;
  blocks_broken: number;
  entities_count?: number;
  agents_count?: number;
}

export type EntityKind = 'companion' | 'villager' | 'cat' | 'fox' | 'sheep' | 'deer' | 'duck';

export interface WorldEntity {
  id: string;
  kind: EntityKind | string;
  name: string;
  variant?: number;
  position: Vec3;
  grid_pos: Vec3;
  yaw: number;
  animation: string;
}

export interface LlmStatus {
  provider: string;
  model: string;
  thinking: boolean;
  last_latency_ms: number | null;
  calls_count: number;
  fallback_active: boolean;
  last_error: string | null;
}

export interface WorldStateSnapshot {
  tick: number;
  day: number;
  time_of_day: number;
  clock_str: string;
  phase: DayPhase | string;
  weather: WeatherType | string;
  paused: boolean;
  speed: SimSpeed | number;
  seed: number;
  npc: NpcState;
  agents?: NpcState[];
  stats: WorldStats;
  entities?: WorldEntity[];
  llm_status: LlmStatus;
}

export interface BlockUpdate {
  x: number;
  y: number;
  z: number;
  block: number;
  meta?: number;
}

export interface WorldInitMessage {
  type: 'world_init';
  dimensions: { width: number; height: number; depth: number };
  index_formula: string;
  blocks: number[];
  block_meta: number[];
  palette?: Record<string, string>;
  state: WorldStateSnapshot;
}

export interface TickUpdateMessage {
  type: 'tick_update';
  block_updates: BlockUpdate[];
  state: WorldStateSnapshot;
}

export interface LlmTrace {
  id: string;
  timestamp: string;
  agent_id?: string;
  agent_name?: string;
  provider: string;
  model: string;
  latency_ms: number;
  prompt_summary: string;
  raw_prompt: string;
  raw_response: string;
  parsed_decision: {
    thought?: string;
    goal?: string;
    action?: string;
    params?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  used_fallback: boolean;
  error: string | null;
}

export interface LlmTraceMessage {
  type: 'llm_trace';
  trace: LlmTrace;
}

export type ServerWsMessage = WorldInitMessage | TickUpdateMessage | LlmTraceMessage;

export type LlmProvider =
  | 'ollama'
  | 'lmstudio'
  | 'openai'
  | 'gemini'
  | 'openrouter'
  | 'custom'
  | 'fallback';

export interface LlmConfig {
  provider: LlmProvider | string;
  model: string;
  base_url: string;
  has_api_key?: boolean;
  api_key?: string;
  temperature: number;
  decision_interval_ticks: number;
  enabled: boolean;
}

export interface LlmTestResponse {
  ok: boolean;
  latency_ms: number;
  reply: string;
  error: string | null;
}

export interface DetectedLocalModel {
  provider: LlmProvider | string;
  label: string;
  base_url: string;
  model: string;
  status: 'running' | 'installed' | string;
  size?: string | null;
}

export interface DetectLocalLlmResponse {
  detected: DetectedLocalModel[];
  checked_endpoints: string[];
}

export type CameraMode = 'orbit' | 'follow' | 'pov';

export type ConnectionMode = 'connecting' | 'live' | 'reconnecting' | 'offline_demo';

export type InspectTarget =
  | {
      kind: 'block';
      x: number;
      y: number;
      z: number;
      block: number;
      meta: number;
    }
  | {
      kind: 'npc';
      agentId?: string;
    }
  | {
      kind: 'entity';
      entity: WorldEntity;
    };

export type GodTool =
  | { mode: 'inspect' }
  | { mode: 'erase' }
  | { mode: 'object'; object: string; label: string }
  | { mode: 'entity'; kind: EntityKind; label: string; customName?: string }
  | { mode: 'agent'; role: AgentRole; label: string; customName?: string };

export interface SaveSlotSummary {
  slot: string;
  name: string;
  saved_at: string;
  day: number;
  clock_str: string;
  tick: number;
  weather: string;
  agents_count: number;
  entities_count: number;
  seed: number;
  size_bytes: number;
}

export interface WorldSavePayload {
  format: string;
  save_version?: number;
  name?: string;
  saved_at?: string;
  seed: number;
  tick: number;
  elapsed: number;
  paused: boolean;
  speed: number;
  weather: string;
  weather_override: boolean;
  world: {
    seed: number;
    width: number;
    height: number;
    depth: number;
    blocks: number[];
    meta: number[];
    materials?: Record<string, string> | string[];
    decorations?: unknown[];
    resource_nodes?: Record<string, unknown>;
  };
  home?: Record<string, unknown>;
  crop_age?: unknown[];
  wet_age?: unknown[];
  berry_regrowth?: unknown[];
  sapling_age?: unknown[];
  entities?: unknown[];
  agents: unknown[];
  brains?: Record<string, unknown>;
  [key: string]: unknown;
}
