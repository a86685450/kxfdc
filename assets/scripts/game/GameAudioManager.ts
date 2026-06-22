import { AudioClip, AudioSource, Component, Node } from "cc";
import { AudioPaths } from "./GameConfig";
import { ResourceLoader } from "./ResourceLoader";

type AudioKey = keyof typeof AudioPaths;

/** 音效管理，优先播放生成资源，资源缺失时静默跳过。 */
export class GameAudioManager {
    private _source: AudioSource;
    private _clips: Map<string, AudioClip> = new Map();

    public constructor(host: Component) {
        const node = new Node("AudioManager");
        host.node.addChild(node);
        this._source = node.addComponent(AudioSource);
        this._preload();
    }

    public play(key: AudioKey): void {
        const path = AudioPaths[key];
        const clip = this._clips.get(path);
        if (clip) {
            this._source.playOneShot(clip, 0.8);
        }
    }

    private _preload(): void {
        Object.keys(AudioPaths).forEach((key) => {
            const path = AudioPaths[key as AudioKey];
            ResourceLoader.loadAudio(path, (clip) => {
                if (clip) {
                    this._clips.set(path, clip);
                }
            });
        });
    }
}
