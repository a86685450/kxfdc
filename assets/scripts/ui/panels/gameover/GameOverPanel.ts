import { Color, Label, Node, Sprite, UITransform } from "cc";
import { UIBase } from "../../../framework/ui/UIBase";
import { UIManager } from "../../../framework/ui/UIManager";
import { GameOverInfo } from "../../../game/HouseGameManager";
import { GamePanel } from "../game/GamePanel";
import { UIIds } from "../../UIIds";

/** 失败结算面板，提供重新开始和返回登录。 */
export class GameOverPanel extends UIBase {
    private _summaryLabel: Label | null = null;

    protected onInit(): void {
        this._buildView();
    }

    protected onShow(info?: GameOverInfo): void {
        if (!this._summaryLabel || !info) return;
        this._summaryLabel.string = `本局分数：${info.score}\n本局层数：${info.floor}\n最高分：${info.bestScore}\n最高层：${info.bestFloor}\n最高连击：${info.bestCombo}`;
    }

    private _buildView(): void {
        if (!this.node) return;
        const mask = this._createRect("Mask", 720, 1280, new Color(0, 0, 0, 150));
        this.node.addChild(mask);
        const panel = this._createRect("Panel", 520, 520, new Color(32, 62, 88, 245));
        this.node.addChild(panel);
        panel.setPosition(0, 0, 0);

        const title = this._createLabel("Title", "楼歪啦！", 56, new Color(255, 226, 112, 255), 480, 80);
        title.setPosition(0, 175, 0);
        panel.addChild(title);

        const summary = this._createLabel("Summary", "", 30, new Color(255, 255, 255, 255), 460, 210);
        summary.setPosition(0, 40, 0);
        panel.addChild(summary);
        this._summaryLabel = summary.getComponent(Label);

        const restart = this._createButton("Restart", "重新开始");
        restart.setPosition(0, -135, 0);
        panel.addChild(restart);
        restart.on(Node.EventType.TOUCH_END, () => this._restart(), this);

        const back = this._createButton("BackLogin", "返回登录");
        back.setPosition(0, -215, 0);
        panel.addChild(back);
        back.on(Node.EventType.TOUCH_END, () => this._backLogin(), this);
    }

    private _createButton(name: string, text: string): Node {
        const node = this._createRect(name, 280, 62, new Color(255, 169, 72, 255));
        const label = this._createLabel("Text", text, 32, new Color(54, 38, 30, 255), 260, 54);
        node.addChild(label);
        return node;
    }

    private _createRect(name: string, width: number, height: number, color: Color): Node {
        const node = new Node(name);
        node.addComponent(UITransform).setContentSize(width, height);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = color;
        return node;
    }

    private _createLabel(name: string, text: string, fontSize: number, color: Color, width: number, height: number): Node {
        const node = new Node(name);
        node.addComponent(UITransform).setContentSize(width, height);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 10;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.isBold = true;
        return node;
    }

    private _restart(): void {
        UIManager.instance.close(UIIds.GameOverPanel);
        const game = UIManager.instance.find<GamePanel>(UIIds.GamePanel);
        game?.restart();
    }

    private async _backLogin(): Promise<void> {
        UIManager.instance.close(UIIds.GameOverPanel);
        UIManager.instance.close(UIIds.GamePanel);
        await UIManager.instance.open(UIIds.LoginPanel);
    }
}
