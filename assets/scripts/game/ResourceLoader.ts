import { AudioClip, resources, Sprite, SpriteFrame } from "cc";

/** 资源加载工具，资源缺失时保留代码占位表现，避免空项目运行失败。 */
export class ResourceLoader {
    public static setSpriteFrame(sprite: Sprite | null, path: string, isRequestValid?: () => boolean): void {
        if (!sprite) return;
        resources.load(path, SpriteFrame, (err, frame) => {
            if (err || !sprite.isValid || (isRequestValid && !isRequestValid())) {
                return;
            }
            sprite.spriteFrame = frame;
        });
    }

    public static loadAudio(path: string, callback: (clip: AudioClip | null) => void): void {
        resources.load(path, AudioClip, (err, clip) => {
            if (err) {
                callback(null);
                return;
            }
            callback(clip);
        });
    }
}
