import { BestRecord, GameStorage } from "./GameStorage";

export interface ScoreSnapshot {
    score: number;
    floor: number;
    combo: number;
    maxCombo: number;
    best: BestRecord;
}

/** 分数、楼层、连击和本地最高纪录管理。 */
export class ScoreController {
    private _score = 0;
    private _floor = 0;
    private _combo = 0;
    private _maxCombo = 0;
    private _best: BestRecord = GameStorage.loadBest();

    public reset(): void {
        this._score = 0;
        this._floor = 0;
        this._combo = 0;
        this._maxCombo = 0;
        this._best = GameStorage.loadBest();
    }

    public apply(scoreAdd: number, floor: number, combo: number): void {
        this._score += scoreAdd;
        this._floor = floor;
        this._combo = combo;
        this._maxCombo = Math.max(this._maxCombo, combo);
    }

    public flushBest(): BestRecord {
        this._best = GameStorage.updateBest(this._score, this._floor, this._maxCombo);
        return this._best;
    }

    public getSnapshot(): ScoreSnapshot {
        return {
            score: this._score,
            floor: this._floor,
            combo: this._combo,
            maxCombo: this._maxCombo,
            best: this._best,
        };
    }
}
