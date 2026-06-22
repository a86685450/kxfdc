import { Color } from "cc";

const MENU_TEXTS = ["开始游戏", "继续游戏", "玩法测试", "清空存档"];

export class LoginModel {
    private _selectedIndex = 0;

    public get menuTexts(): string[] {
        return MENU_TEXTS;
    }

    public get menuCount(): number {
        return MENU_TEXTS.length;
    }

    public get selectedText(): string {
        return MENU_TEXTS[this._selectedIndex];
    }

    public reset(): void {
        this._selectedIndex = 0;
    }

    public selectPrevious(): void {
        this._selectedIndex = (this._selectedIndex - 1 + MENU_TEXTS.length) % MENU_TEXTS.length;
    }

    public selectNext(): void {
        this._selectedIndex = (this._selectedIndex + 1) % MENU_TEXTS.length;
    }

    public selectByIndex(index: number): void {
        this._selectedIndex = Math.max(0, Math.min(index, MENU_TEXTS.length - 1));
    }

    public getColorByIndex(index: number): Color {
        return index === this._selectedIndex ? new Color(255, 235, 118, 255) : new Color(255, 255, 255, 255);
    }
}
