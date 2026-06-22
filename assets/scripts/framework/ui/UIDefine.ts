/** UI 层级定义，参考 HongHuang 的 Scene / Default / Popup 分层。 */
export enum UILayer {
    Scene = 0,
    Default = 1,
    Popup = 2,
    Guide = 3,
    Loading = 4,
    Toast = 5,
    System = 6,
}

/** UI 打开方式，保留隐藏前序面板的能力。 */
export enum UIOpenType {
    DontHideOthers = 0,
    HidePrevious = 1,
    HideCustom = 2,
}

export enum UIBgType {
    None = 0,
    Black = 1,
}

export interface UIConfig {
    /** 预制体路径可为空；为空时由面板代码动态搭建节点，便于当前 MVP 快速开发。 */
    prefabPath?: string;
    layer: UILayer;
    openType?: UIOpenType;
    bgType?: UIBgType;
    canHideByOther?: boolean;
    closeOnSceneChange?: boolean;
}

export const UIEvents = {
    UI_OPEN: "UI_OPEN",
    UI_CLOSE: "UI_CLOSE",
    UI_HIDE: "UI_HIDE",
    UI_SHOW: "UI_SHOW",
};
