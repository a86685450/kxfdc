import { Color } from "cc";

/** 核心玩法配置，先集中在代码里，后续可迁移为 JSON 配置。 */
export const GameConfig = {
    DESIGN_WIDTH: 720,
    DESIGN_HEIGHT: 1280,
    HOUSE_SIZE: 160,
    FOUNDATION_TOP_Y: -512,
    GROUND_WIDTH: 720,
    GROUND_HEIGHT: 128,
    GROUND_PATH: "textures/grounds/ground/spriteFrame",
    HOOK_PIVOT_Y: 520,
    HOOK_LENGTH: 250,
    HOOK_SPRITE_PATH: "textures/hooks/top_hook/spriteFrame",
    HOOK_SPRITE_WIDTH: 26,
    HOOK_SPRITE_HEIGHT: 48,
    HOOK_SPRITE_HOUSE_GAP: 10,
    HOOK_ROPE_SOURCE_HALF_SPREAD: 5,
    HOOK_ROPE_SOURCE_Y: -20,
    HOOK_ROPE_WIDTH: 3,
    HOOK_HOUSE_ATTACH_X: 64,
    HOOK_HOUSE_ATTACH_Y: 72,
    HOOK_AMPLITUDE_DEG: 33,
    HOOK_SPEED: 1.45,
    DROP_GRAVITY: 1450,
    DROP_INITIAL_Y_SPEED: -80,
    DROP_INERTIA_SCALE: 0.72,
    PERFECT_LIMIT: 5,
    GOOD_LIMIT: 10,
    SUCCESS_LIMIT: 50,
    GOOD_RISK_ADD: 2,
    PERFECT_RISK_REDUCE: 3,
    NORMAL_RISK_SCALE: 0.36,
    MAX_CUMULATIVE_RISK: 100,
    SWAY_START_FLOOR: 6,
    MAX_VISIBLE_FLOOR_NODES: 4,
    VISIBLE_FLOOR_COUNT: 2.5,
    BACKGROUND_SCROLL_RATIO: 3,
    BACKGROUND_SCROLL_DURATION: 0.26,
    BACKGROUND_TILE_HEIGHT_RATIO: 1.5,
    BACKGROUND_GRADIENT_STEPS: 32,
    BACKGROUND_DECOR_PRELOAD: 120,
    BACKGROUND_DECOR_RELEASE_PADDING: 180,
};

export const HouseSkinConfigs = [
    { path: "textures/houses/processed/house_01/spriteFrame" },
    { path: "textures/houses/processed/house_02/spriteFrame" },
    { path: "textures/houses/processed/house_03/spriteFrame" },
    { path: "textures/houses/processed/house_04/spriteFrame" },
    { path: "textures/houses/processed/house_05/spriteFrame" },
    { path: "textures/houses/processed/house_06/spriteFrame" },
    { path: "textures/houses/processed/house_07/spriteFrame" },
    { path: "textures/houses/processed/house_08/spriteFrame" },
    { path: "textures/houses/processed/house_09/spriteFrame" },
    { path: "textures/houses/processed/house_10/spriteFrame" },
    { path: "textures/houses/processed/house_11/spriteFrame" },
    { path: "textures/houses/processed/house_12/spriteFrame" },
    { path: "textures/houses/processed/house_13/spriteFrame" },
    { path: "textures/houses/processed/house_14/spriteFrame" },
];

export const BackgroundStageConfigs = [
    { minFloor: 1, name: "城市", path: "textures/backgrounds/bg_city/spriteFrame", color: new Color(91, 181, 231, 255) },
    { minFloor: 6, name: "高楼天空", path: "textures/backgrounds/bg_skyline/spriteFrame", color: new Color(95, 196, 255, 255) },
    { minFloor: 16, name: "云层", path: "textures/backgrounds/bg_cloud/spriteFrame", color: new Color(166, 222, 255, 255) },
    { minFloor: 31, name: "高空", path: "textures/backgrounds/bg_high_sky/spriteFrame", color: new Color(66, 133, 214, 255) },
    { minFloor: 51, name: "太空", path: "textures/backgrounds/bg_space/spriteFrame", color: new Color(35, 37, 85, 255) },
    { minFloor: 81, name: "银河", path: "textures/backgrounds/bg_galaxy/spriteFrame", color: new Color(31, 20, 64, 255) },
];

export const BottomBackgroundGradientColors = [
    // 背景按清晨、白天、黄昏、夜空到黑色过渡，避免蓝色段来回跳变。
    new Color(204, 238, 255, 255),
    new Color(126, 207, 255, 255),
    new Color(255, 221, 150, 255),
    new Color(255, 151, 116, 255),
    new Color(118, 95, 182, 255),
    new Color(34, 45, 112, 255),
    new Color(10, 16, 45, 255),
    new Color(0, 0, 0, 255),
];

export type MiddleBackgroundDecorAnimation = "none" | "sway" | "flyAcross" | "drift" | "float";

export interface MiddleBackgroundDecorConfig {
    id: string;
    label: string;
    appearOffset: number;
    x: number;
    y: number;
    width: number;
    height: number;
    parallax: number;
    color?: Color;
    path?: string;
    paths?: string[];
    anchorFloor?: number;
    animation?: MiddleBackgroundDecorAnimation;
    animationAmplitude?: number;
    animationDuration?: number;
}

export const MiddleBackgroundDecorConfigs: MiddleBackgroundDecorConfig[] = [
    { id: "city", label: "", appearOffset: 0, x: 0, y: 0, width: 720, height: 1280, parallax: 0.18, path: "textures/backgrounds/city_skyline/spriteFrame" },
    { id: "moon", label: "", appearOffset: 0, anchorFloor: 30, x: 210, y: 270, width: 220, height: 220, parallax: 0.35, path: "textures/backgrounds/decor/moon/moon_01/spriteFrame", animation: "float", animationAmplitude: 8, animationDuration: 5.8 },
    { id: "balloon", label: "", appearOffset: 0, anchorFloor: 40, x: -220, y: 220, width: 210, height: 210, parallax: 0.45, paths: ["textures/backgrounds/decor/balloon/balloon_01/spriteFrame", "textures/backgrounds/decor/balloon/balloon_02/spriteFrame", "textures/backgrounds/decor/balloon/balloon_03/spriteFrame"], animation: "sway", animationAmplitude: 32, animationDuration: 4.2 },
    { id: "superman", label: "", appearOffset: 0, anchorFloor: 50, x: 0, y: 130, width: 260, height: 260, parallax: 0.55, path: "textures/backgrounds/decor/superman/superman_01/spriteFrame", animation: "flyAcross", animationDuration: 5.2 },
    { id: "satellite", label: "", appearOffset: 0, anchorFloor: 65, x: 180, y: 220, width: 160, height: 160, parallax: 0.5, paths: ["textures/backgrounds/decor/satellite/satellite_01/spriteFrame", "textures/backgrounds/decor/satellite/satellite_02/spriteFrame", "textures/backgrounds/decor/satellite/satellite_03/spriteFrame"], animation: "drift", animationAmplitude: 46, animationDuration: 7.2 },
    { id: "planet_gray", label: "", appearOffset: 0, anchorFloor: 78, x: -230, y: 270, width: 190, height: 190, parallax: 0.36, path: "textures/backgrounds/decor/planet/planet_03/spriteFrame", animation: "float", animationAmplitude: 10, animationDuration: 6.4 },
    { id: "planet_saturn", label: "", appearOffset: 0, anchorFloor: 88, x: 160, y: 220, width: 240, height: 240, parallax: 0.34, path: "textures/backgrounds/decor/planet/planet_05/spriteFrame", animation: "float", animationAmplitude: 12, animationDuration: 7.4 },
    { id: "planet_blue", label: "", appearOffset: 0, anchorFloor: 98, x: -170, y: 260, width: 210, height: 210, parallax: 0.32, path: "textures/backgrounds/decor/planet/planet_07/spriteFrame", animation: "float", animationAmplitude: 9, animationDuration: 6.8 },
    { id: "planet_random", label: "", appearOffset: 0, anchorFloor: 108, x: 220, y: 240, width: 200, height: 200, parallax: 0.3, paths: ["textures/backgrounds/decor/planet/planet_01/spriteFrame", "textures/backgrounds/decor/planet/planet_02/spriteFrame", "textures/backgrounds/decor/planet/planet_04/spriteFrame", "textures/backgrounds/decor/planet/planet_06/spriteFrame", "textures/backgrounds/decor/planet/planet_08/spriteFrame"], animation: "float", animationAmplitude: 11, animationDuration: 7 },
];

export const AudioPaths = {
    click: "audio/click",
    drop: "audio/drop",
    perfect: "audio/perfect",
    good: "audio/good",
    combo: "audio/combo",
    fail: "audio/fail",
};
