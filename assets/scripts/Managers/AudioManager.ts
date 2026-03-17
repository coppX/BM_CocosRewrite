import { _decorator, Component, AudioClip, AudioSource } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 音效配置类
 */
@ccclass('Sound')
export class Sound {
    @property
    public name: string = '';

    @property(AudioClip)
    public clip: AudioClip | null = null;

    @property({ range: [0, 1, 0.01] })
    public volume: number = 1;

    @property({ range: [0.1, 3, 0.1] })
    public playbackSpeed: number = 1;

    @property
    public loop: boolean = false;

    @property({
        tooltip: '同一声音同时播放的最大实例数'
    })
    public maxInstances: number = 1;

    public source: AudioSource | null = null;
    public currentInstances: number = 0;
}

/**
 * 音频管理器
 * 管理游戏中的所有音效和背景音乐
 */
@ccclass('AudioManager')
export class AudioManager extends Component {
    private static _instance: AudioManager | null = null;

    public static get Instance(): AudioManager | null {
        return this._instance;
    }

    @property([Sound])
    public sounds: Sound[] = [];

    @property(Sound)
    public backgroundMusic: Sound | null = null;

    private _soundDictionary: Map<string, Sound> = new Map();

    protected onLoad(): void {
        if (AudioManager._instance !== null && AudioManager._instance !== this) {
            this.node.destroy();
            return;
        }
        AudioManager._instance = this;

        this.initializeSounds();
    }

    private initializeSounds(): void {
        for (const sound of this.sounds) {
            const source = this.node.addComponent(AudioSource);
            sound.source = source;
            source.clip = sound.clip;
            source.volume = sound.volume;
            source.playbackRate = sound.playbackSpeed;
            source.loop = sound.loop;

            this._soundDictionary.set(sound.name, sound);
        }
    }

    /**
     * 播放背景音乐
     */
    public playBGM(): void {
        if (this.backgroundMusic) {
            const source = this.node.addComponent(AudioSource);
            this.backgroundMusic.source = source;
            source.clip = this.backgroundMusic.clip;
            source.volume = this.backgroundMusic.volume;
            source.playbackRate = this.backgroundMusic.playbackSpeed;
            source.loop = this.backgroundMusic.loop;
            source.play();
        }
    }

    /**
     * 暂停背景音乐
     */
    public pauseBGM(): void {
        if (this.backgroundMusic && this.backgroundMusic.source) {
            this.backgroundMusic.source.pause();
        }
    }

    /**
     * 恢复背景音乐
     */
    public resumeBGM(): void {
        if (this.backgroundMusic && this.backgroundMusic.source) {
            this.backgroundMusic.source.play();
        }
    }

    /**
     * 停止背景音乐
     */
    public stopBGM(): void {
        if (this.backgroundMusic && this.backgroundMusic.source) {
            this.backgroundMusic.source.stop();
        }
    }

    /**
     * 播放音效
     */
    public play(name: string): void {
        const sound = this._soundDictionary.get(name);
        if (sound && sound.source && sound.clip) {
            // 只有在实例数限制内才播放
            if (sound.currentInstances < sound.maxInstances) {
                sound.currentInstances++;
                sound.source.playOneShot(sound.clip, sound.volume);

                // 计划释放实例计数
                const duration = (sound.clip.getDuration() / sound.playbackSpeed) * 1000;
                setTimeout(() => {
                    sound.currentInstances = Math.max(0, sound.currentInstances - 1);
                }, duration);
            }
        }
    }

    /**
     * 停止音效
     */
    public stop(name: string): void {
        const sound = this._soundDictionary.get(name);
        if (sound && sound.source) {
            sound.source.stop();
            sound.currentInstances = 0;
        }
    }

    protected onDestroy(): void {
        if (AudioManager._instance === this) {
            AudioManager._instance = null;
        }
    }
}
