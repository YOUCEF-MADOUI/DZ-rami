import { AIDifficulty, DEFAULT_CONFIG, GameConfig } from './types';

export const GAME_CONFIG_STORAGE_KEY = 'dz-rami:config:v1';

/** Minimal storage port so the game configuration stays independent of DOM APIs. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DIFFICULTIES: AIDifficulty[] = ['easy', 'normal', 'hard'];
const PLAYER_COUNTS: GameConfig['playerCount'][] = [2, 3, 4, 5];

export function loadGameConfig(
  storage: KeyValueStorage,
  fallback: GameConfig = DEFAULT_CONFIG,
): GameConfig {
  try {
    const raw = storage.getItem(GAME_CONFIG_STORAGE_KEY);
    if (!raw) return { ...fallback };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...fallback };

    const value = parsed as Partial<GameConfig>;
    const merged: GameConfig = { ...DEFAULT_CONFIG, ...fallback, ...value };
    if(merged.variant && !['classic','teams'].includes(merged.variant))merged.variant='classic';
    if(merged.variant==='teams'&&merged.playerCount!==4)merged.variant='classic';
    if (!PLAYER_COUNTS.includes(merged.playerCount)) merged.playerCount = fallback.playerCount;
    if (!DIFFICULTIES.includes(merged.aiDifficulty)) merged.aiDifficulty = fallback.aiDifficulty;
    if(!Number.isInteger(merged.maxCycles)||merged.maxCycles<1||merged.maxCycles>10) merged.maxCycles=fallback.maxCycles;
    if(merged.targetScore!==undefined && (!Number.isInteger(merged.targetScore)||merged.targetScore<0||merged.targetScore>3000)) merged.targetScore=fallback.targetScore;
    return merged;
  } catch {
    return { ...fallback };
  }
}

export function saveGameConfig(storage: KeyValueStorage, config: GameConfig): boolean {
  try {
    storage.setItem(GAME_CONFIG_STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch {
    // Private mode/quota errors should not break a local game.
    return false;
  }
}
