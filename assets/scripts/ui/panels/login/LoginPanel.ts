import { Color, input, Input, EventKeyboard, KeyCode, Label, Node, Sprite, UITransform } from "cc";
import { UIBase } from "../../../framework/ui/UIBase";
import { UIManager } from "../../../framework/ui/UIManager";
import { GameStartParam } from "../../../game/GameStartParam";
import { GameStorage } from "../../../game/GameStorage";
import { ResourceLoader } from "../../../game/ResourceLoader";
import { UIIds } from "../../UIIds";
import { LoginModel } from "./LoginModel";

/** 登录界面，参考 HongHuang 菜单式入口，并增加主玩法测试按钮。 */
export class LoginPanel extends UIBase {
    private _model = new LoginModel();
    private _menuLabels: Label[] = [];
    private _tipLabel: Label | null = null;
    private _onKeyDownBound: (event: EventKeyboard) => void = null;
    private _processing = false;

    protected onInit(): void {
        this._buildView();
        this._onKeyDownBound = this._onKeyDown.bind(this);
        input.on(Input.EventType.KEY_DOWN, this._onKeyDownBound);
        this._updateSelection();
    }

    protected onShow(): void {
        this._processing = false;
        this._model.reset();
        this._updateSelection();
        this._updateTip("点击菜单或使用方向键 + 回车开始");
    }

    protected onClose(): void {
        if (this._onKeyDownBound) {
            input.off(Input.EventType.KEY_DOWN, this._onKeyDownBound);
            this._onKeyDownBound = null;
        }
    }

    private _buildView(): void {
        if (!this.node) return;
        const bg = this._createRect("LoginBackground", 720, 1280, new Color(36, 78, 128, 255));
        this.node.addChild(bg);
        ResourceLoader.setSpriteFrame(bg.getComponent(Sprite), "textures/login/login_bg/spriteFrame");

        const menuContainer = new Node("MenuContainer");
        this.node.addChild(menuContainer);
        menuContainer.setPosition(0, -410, 0);
        for (let i = 0; i < this._model.menuCount; i++) {
            const menuNode = this._createMenuItem(this._model.menuTexts[i]);
            menuNode.setPosition(0, 90 - i * 88, 0);
            menuContainer.addChild(menuNode);
            menuNode.on(Node.EventType.TOUCH_END, () => this._onMenuClick(i), this);
            const label = menuNode.getChildByName("Text")?.getComponent(Label);
            if (label) {
                this._menuLabels.push(label);
            }
        }

        const tip = this._createLabel("Tip", "", 24, new Color(230, 246, 255, 255));
        tip.setPosition(0, -545, 0);
        this.node.addChild(tip);
        this._tipLabel = tip.getComponent(Label);
    }

    private _createMenuItem(text: string): Node {
        const root = this._createRect(`Menu_${text}`, 340, 66, new Color(23, 54, 82, 185));
        const label = this._createLabel("Text", text, 34, new Color(255, 255, 255, 255));
        root.addChild(label);
        return root;
    }

    private _createRect(name: string, width: number, height: number, color: Color): Node {
        const node = new Node(name);
        node.addComponent(UITransform).setContentSize(width, height);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = color;
        return node;
    }

    private _createLabel(name: string, text: string, fontSize: number, color: Color): Node {
        const node = new Node(name);
        node.addComponent(UITransform).setContentSize(640, fontSize + 20);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 12;
        label.color = color;
        label.isBold = true;
        return node;
    }

    private _onKeyDown(event: EventKeyboard): void {
        if (this._processing) return;
        if (event.keyCode === KeyCode.ARROW_UP) {
            this._model.selectPrevious();
            this._updateSelection();
        } else if (event.keyCode === KeyCode.ARROW_DOWN) {
            this._model.selectNext();
            this._updateSelection();
        } else if (event.keyCode === KeyCode.ENTER) {
            this._onConfirm();
        }
    }

    private _onMenuClick(index: number): void {
        if (this._processing) return;
        this._model.selectByIndex(index);
        this._updateSelection();
        this._onConfirm();
    }

    private async _onConfirm(): Promise<void> {
        this._processing = true;
        const selected = this._model.selectedText;
        if (selected === "开始游戏" || selected === "继续游戏") {
            GameStartParam.mode = "normal";
            UIManager.instance.close(UIIds.LoginPanel);
            await UIManager.instance.open(UIIds.GamePanel, { mode: "normal" });
            return;
        }
        if (selected === "玩法测试") {
            GameStartParam.mode = "test";
            UIManager.instance.close(UIIds.LoginPanel);
            await UIManager.instance.open(UIIds.GamePanel, { mode: "test", autoPlay: true, autoPlayFloors: 110, autoPlayInterval: 0.18 });
            return;
        }
        if (selected === "清空存档") {
            GameStorage.clear();
            this._updateTip("本地最高分、最高层数和最高连击已清空");
        }
        this._processing = false;
    }

    private _updateSelection(): void {
        for (let i = 0; i < this._menuLabels.length; i++) {
            this._menuLabels[i].color = this._model.getColorByIndex(i);
        }
    }

    private _updateTip(text: string): void {
        if (this._tipLabel) {
            this._tipLabel.string = text;
        }
    }
}
