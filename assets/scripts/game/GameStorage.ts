import { sys } from "cc";

export interface BestRecord {
    bestScore: number;
    bestFloor: number;
    bestCombo: number;
}

const KEY_BEST_SCORE = "kxfdc.bestScore";
const KEY_BEST_FLOOR = "kxfdc.bestFloor";
const KEY_BEST_COMBO = "kxfdc.bestCombo";

/** 本地存储封装，统一管理最高分、最高层数和最高连击。 */
export class GameStorage {
    public static loadBest(): BestRecord {
        return {
            bestScore: this._getNumber(KEY_BEST_SCORE),
            bestFloor: this._getNumber(KEY_BEST_FLOOR),
            bestCombo: this._getNumber(KEY_BEST_COMBO),
        };
    }

    public static updateBest(score: number, floor: number, combo: number): BestRecord {
        const record = this.loadBest();
        const next: BestRecord = {
            bestScore: Math.max(record.bestScore, score),
            bestFloor: Math.max(record.bestFloor, floor),
            bestCombo: Math.max(record.bestCombo, combo),
        };
        sys.localStorage.setItem(KEY_BEST_SCORE, String(next.bestScore));
        sys.localStorage.setItem(KEY_BEST_FLOOR, String(next.bestFloor));
        sys.localStorage.setItem(KEY_BEST_COMBO, String(next.bestCombo));
        return next;
    }

    public static clear(): void {
        sys.localStorage.removeItem(KEY_BEST_SCORE);
        sys.localStorage.removeItem(KEY_BEST_FLOOR);
        sys.localStorage.removeItem(KEY_BEST_COMBO);
    }

    private static _getNumber(key: string): number {
        const value = Number(sys.localStorage.getItem(key));
        return Number.isFinite(value) ? value : 0;
    }
}
