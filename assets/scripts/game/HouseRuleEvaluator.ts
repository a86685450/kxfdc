import { GameConfig } from "./GameConfig";

export enum LandingGrade {
    First = "first",
    Perfect = "perfect",
    Good = "good",
    Normal = "normal",
    Fail = "fail",
}

export interface LandingRuleState {
    cumulativeRisk: number;
    riskEverExceededFive: boolean;
    combo: number;
}

export interface LandingRuleResult {
    grade: LandingGrade;
    scoreAdd: number;
    feedback: string;
    shouldSnap: boolean;
    shouldFail: boolean;
    nextState: LandingRuleState;
}

/**
 * 落点规则计算器。
 * 将判定逻辑从表现层拆出，便于玩法测试直接验证核心规则。
 */
export class HouseRuleEvaluator {
    public static evaluate(offsetPercent: number, state: LandingRuleState, isFirstFloor: boolean): LandingRuleResult {
        if (isFirstFloor) {
            return this._makeResult(LandingGrade.First, 10, "", false, false, {
                cumulativeRisk: state.cumulativeRisk,
                riskEverExceededFive: state.riskEverExceededFive,
                combo: 0,
            });
        }

        if (offsetPercent > GameConfig.SUCCESS_LIMIT) {
            return this._makeResult(LandingGrade.Fail, 0, "", false, true, {
                cumulativeRisk: state.cumulativeRisk,
                riskEverExceededFive: state.riskEverExceededFive,
                combo: 0,
            });
        }

        if (offsetPercent <= GameConfig.PERFECT_LIMIT) {
            const nextCombo = state.combo + 1;
            const nextRisk = this._reduceRiskByPerfect(state);
            const comboBonus = nextCombo > 1 ? nextCombo * 10 : 0;
            return this._makeResult(
                LandingGrade.Perfect,
                50 + comboBonus,
                nextCombo > 1 ? `perfect x${nextCombo}` : "perfect",
                true,
                false,
                {
                    cumulativeRisk: nextRisk,
                    riskEverExceededFive: state.riskEverExceededFive || state.cumulativeRisk > GameConfig.PERFECT_LIMIT,
                    combo: nextCombo,
                },
            );
        }

        if (offsetPercent <= GameConfig.GOOD_LIMIT) {
            const nextRisk = state.cumulativeRisk + GameConfig.GOOD_RISK_ADD;
            return this._makeResult(LandingGrade.Good, 20, "good", false, false, {
                cumulativeRisk: nextRisk,
                riskEverExceededFive: state.riskEverExceededFive || nextRisk > GameConfig.PERFECT_LIMIT,
                combo: 0,
            });
        }

        const nextRisk = state.cumulativeRisk + offsetPercent * GameConfig.NORMAL_RISK_SCALE;
        return this._makeResult(LandingGrade.Normal, 10, "", false, false, {
            cumulativeRisk: nextRisk,
            riskEverExceededFive: state.riskEverExceededFive || nextRisk > GameConfig.PERFECT_LIMIT,
            combo: 0,
        });
    }

    private static _reduceRiskByPerfect(state: LandingRuleState): number {
        const reduced = Math.max(0, state.cumulativeRisk - GameConfig.PERFECT_RISK_REDUCE);
        if (state.riskEverExceededFive || state.cumulativeRisk > GameConfig.PERFECT_LIMIT) {
            return Math.max(GameConfig.PERFECT_LIMIT, reduced);
        }
        return reduced;
    }

    private static _makeResult(
        grade: LandingGrade,
        scoreAdd: number,
        feedback: string,
        shouldSnap: boolean,
        shouldFail: boolean,
        nextState: LandingRuleState,
    ): LandingRuleResult {
        return { grade, scoreAdd, feedback, shouldSnap, shouldFail, nextState };
    }
}
