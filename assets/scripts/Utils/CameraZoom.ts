import { _decorator, Component, Camera, tween, CCInteger } from 'cc';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
import { GlobalVariables, Stage } from '../Core/GlobalVariables';
const { ccclass, property } = _decorator;

/**
 * 相机缩放组件
 * 根据游戏阶段调整相机大小
 */
@ccclass('CameraZoom')
export class CameraZoom extends Component {
    @property(Camera)
    public controlledCamera: Camera | null = null;

    @property
    public targetSizeScale: number = 1.2;

    @property({ type: [CCInteger] })
    public targetStage: number[] = [];

    private _hasStartedZoom: boolean = false;
    private _baseSize: number = 0;
    private _finishedStages: number[] = [];

    protected onLoad(): void {
        EventCenter.Instance.AddEventListener(EventName.MapLevelUpgrade, this.onMapLevelUpgrade.bind(this));

        if (this.controlledCamera) {
            this._baseSize = this.controlledCamera.orthoHeight;
        }
    }

    protected onDisable(): void {
        EventCenter.Instance.RemoveEventListener(EventName.MapLevelUpgrade, this.onMapLevelUpgrade.bind(this));
    }

    private onMapLevelUpgrade(stage: Stage): void {
        this._finishedStages.push(stage);

        // 检查所有目标阶段是否都完成
        if (!this._hasStartedZoom && this.targetStage.every(t => this._finishedStages.includes(t))) {
            this._hasStartedZoom = true;
            this.smoothCameraSizeChange(this._baseSize * this.targetSizeScale);
        }
    }

    private smoothCameraSizeChange(targetSize: number): void {
        if (!this.controlledCamera) return;

        const initialSize = this.controlledCamera.orthoHeight;
        const duration = 1;

        tween({ size: initialSize })
            .to(duration, { size: targetSize }, {
                onUpdate: (target: any) => {
                    if (this.controlledCamera) {
                        this.controlledCamera.orthoHeight = target.size;
                    }
                }
            })
            .start();
    }
}
