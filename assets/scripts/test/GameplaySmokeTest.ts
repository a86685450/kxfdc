import { HouseGameManager } from "../game/HouseGameManager";
import { HouseRuleEvaluator, LandingGrade, LandingRuleState } from "../game/HouseRuleEvaluator";

export interface GameplaySmokeTestResult {
    passed: boolean;
    total: number;
    failed: number;
    details: string[];
}

/**
 * 主玩法冒烟测试。
 * 参考 HongHuang 的 SmokeTest 思路，覆盖纯规则和真实管理器链路。
 */
export class GameplaySmokeTest {
    public static run(manager: HouseGameManager, logger: (message: string) => void): GameplaySmokeTestResult {
        const details: string[] = [];
        const assert = (name: string, passed: boolean, detail = "") => {
            const line = `${passed ? "[PASS]" : "[FAIL]"} ${name}${detail ? ` - ${detail}` : ""}`;
            details.push(line);
            logger(line);
        };

        this._runRuleTests(assert);
        manager.reset();
        const initialSnapshot = manager.getDebugSnapshot();
        assert("背景初始化城市装饰", initialSnapshot.backgroundDecorCount === 1 && initialSnapshot.backgroundDecorIds.indexOf("city") >= 0, `decor=${initialSnapshot.backgroundDecorIds.join(",")}`);
        assert("第一层落地", manager.forceDropForTest(12), "地基承接");
        const afterFirst = manager.getDebugSnapshot();
        assert("第一层保留落点", Math.abs(afterFirst.topX - 19.2) < 0.01, `topX=${afterFirst.topX.toFixed(1)}`);
        assert("Perfect 自动吸附", manager.forceDropForTest(3), "<= 5% 自动修正");
        const afterPerfect = manager.getDebugSnapshot();
        assert("Perfect 连击", afterPerfect.combo === 1, `combo=${afterPerfect.combo}`);
        assert("Good 不修正并累加偏移", manager.forceDropForTest(8), "5%-10% 成功");
        const afterGood = manager.getDebugSnapshot();
        assert("Good 打断连击", afterGood.combo === 0, `combo=${afterGood.combo}`);
        assert("普通成功", manager.forceDropForTest(22), "10%-50% 成功");
        assert("大偏移仍成功", manager.forceDropForTest(45), "<=50% 仍成功");
        manager.forceDropForTest(1);
        manager.forceDropForTest(1);
        manager.forceDropForTest(1);
        const swaySnapshot = manager.getDebugSnapshot();
        assert("楼体超过 5 层", swaySnapshot.floor >= 6, `floor=${swaySnapshot.floor}`);
        assert("背景按 3 倍距离下移", swaySnapshot.backgroundY <= -2000, `bgY=${swaySnapshot.backgroundY.toFixed(1)}`);
        assert("高层装饰未提前出现", swaySnapshot.backgroundDecorIds.indexOf("city") >= 0 && swaySnapshot.backgroundDecorIds.indexOf("moon") < 0, `decor=${swaySnapshot.backgroundDecorIds.join(",")}`);
        for (let i = 0; i < 28; i++) {
            manager.forceDropForTest(1);
        }
        const moonSnapshot = manager.getDebugSnapshot();
        assert("30 层附近出现月亮", moonSnapshot.backgroundDecorIds.indexOf("moon") >= 0, `decor=${moonSnapshot.backgroundDecorIds.join(",")}`);
        for (let i = 0; i < 5; i++) {
            manager.forceDropForTest(1);
        }
        const balloonSnapshot = manager.getDebugSnapshot();
        assert("40 层附近出现热气球", balloonSnapshot.backgroundDecorIds.indexOf("balloon") >= 0, `decor=${balloonSnapshot.backgroundDecorIds.join(",")}`);
        for (let i = 0; i < 10; i++) {
            manager.forceDropForTest(1);
        }
        const supermanSnapshot = manager.getDebugSnapshot();
        assert("50 层附近出现超人", supermanSnapshot.backgroundDecorIds.indexOf("superman") >= 0, `decor=${supermanSnapshot.backgroundDecorIds.join(",")}`);
        for (let i = 0; i < 15; i++) {
            manager.forceDropForTest(1);
        }
        const satelliteSnapshot = manager.getDebugSnapshot();
        assert("65 层附近出现卫星", satelliteSnapshot.backgroundDecorIds.indexOf("satellite") >= 0, `decor=${satelliteSnapshot.backgroundDecorIds.join(",")}`);
        for (let i = 0; i < 14; i++) {
            manager.forceDropForTest(1);
        }
        const planetSnapshot = manager.getDebugSnapshot();
        assert("80 层后出现行星", planetSnapshot.backgroundDecorIds.some((id) => id.indexOf("planet_") === 0), `decor=${planetSnapshot.backgroundDecorIds.join(",")}`);
        assert("对象池创建受控", swaySnapshot.poolCreated <= 8, `created=${swaySnapshot.poolCreated}`);
        const failResult = manager.forceDropForTest(55);
        assert("超过 50% 失败", !failResult, "失败阈值生效");
        manager.reset();
        const afterRestart = manager.getDebugSnapshot();
        assert("重开清理失败房子", afterRestart.looseHouseCount === 1 && afterRestart.floor === 0, `loose=${afterRestart.looseHouseCount}, floor=${afterRestart.floor}`);
        assert("重开重置背景装饰", afterRestart.backgroundDecorCount === 1 && afterRestart.backgroundDecorIds.indexOf("city") >= 0, `decor=${afterRestart.backgroundDecorIds.join(",")}`);

        const failed = details.filter((line) => line.indexOf("[FAIL]") === 0).length;
        const result: GameplaySmokeTestResult = {
            passed: failed === 0,
            total: details.length,
            failed,
            details,
        };
        logger(`[GameplaySmokeTest] ${result.passed ? "全部通过" : "存在失败"} ${result.total - result.failed}/${result.total}`);
        return result;
    }

    private static _runRuleTests(assert: (name: string, passed: boolean, detail?: string) => void): void {
        const base: LandingRuleState = { cumulativeRisk: 0, riskEverExceededFive: false, combo: 0 };
        const first = HouseRuleEvaluator.evaluate(99, base, true);
        assert("规则: 第一层不判失败", first.grade === LandingGrade.First && !first.shouldFail);

        const perfect = HouseRuleEvaluator.evaluate(4, base, false);
        assert("规则: Perfect 阈值", perfect.grade === LandingGrade.Perfect && perfect.shouldSnap);

        const good = HouseRuleEvaluator.evaluate(8, base, false);
        assert("规则: Good 阈值", good.grade === LandingGrade.Good && !good.shouldSnap && good.nextState.cumulativeRisk > 0);

        const normal = HouseRuleEvaluator.evaluate(45, base, false);
        assert("规则: 普通成功阈值", normal.grade === LandingGrade.Normal && normal.nextState.cumulativeRisk > 0);

        const fail = HouseRuleEvaluator.evaluate(51, base, false);
        assert("规则: 失败阈值", fail.grade === LandingGrade.Fail && fail.shouldFail);

        const risky: LandingRuleState = { cumulativeRisk: 12, riskEverExceededFive: true, combo: 0 };
        const reduced = HouseRuleEvaluator.evaluate(2, risky, false);
        assert("规则: Perfect 风险下限", reduced.nextState.cumulativeRisk >= 5, `risk=${reduced.nextState.cumulativeRisk}`);
    }
}
