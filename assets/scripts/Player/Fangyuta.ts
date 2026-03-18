import { _decorator, Component, Node, Quat, Vec3 } from 'cc';
import { AttackLogic } from '../Utils/AttackLogic';
import { AudioManager } from '../Managers/AudioManager';
const { ccclass, property } = _decorator;

/**
 * 防御塔组件
 * 自动瞄准最近的敌人
 */
@ccclass('Fangyuta')
export class Fangyuta extends Component {
    @property({
        type: Node,
        tooltip: '将模型中用于瞄准的骨骼拖到这里'
    })
    public aimingBone: Node | null = null;

    private _logic: AttackLogic | null = null;
    private _correctionRotation: Quat = new Quat();
    private _lastAimRotation: Quat = new Quat();

    protected onLoad(): void {
        this._logic = this.getComponent(AttackLogic);

        // 播放升级音效
        AudioManager.Instance?.play('防御塔升级');

        // 设置修正旋转
        const right = new Vec3(-1, 0, 0);
        const forward = new Vec3(0, 0, 1);
        Quat.fromViewUp(this._correctionRotation, right, forward);

        if (this.aimingBone) {
            this._lastAimRotation = this.aimingBone.getRotation().clone();
        }
    }

    protected lateUpdate(dt: number): void {
        if (!this._logic || !this.aimingBone) return;

        const target = this._logic.findNearestTarget(false);

        if (target) {
            const dir = new Vec3();
            Vec3.subtract(dir, target.getWorldPosition(), this.aimingBone.getWorldPosition());
            dir.normalize();

            const lookRotation = new Quat();
            Quat.fromViewUp(lookRotation, dir);

            const finalRotation = new Quat();
            Quat.multiply(finalRotation, lookRotation, this._correctionRotation);

            // 可选：使用插值使旋转更平滑
            // const lerpSpeed = 8;
            // Quat.slerp(finalRotation, this.aimingBone.getRotation(), finalRotation, dt * lerpSpeed);

            this.aimingBone.setWorldRotation(finalRotation);
            this._lastAimRotation = finalRotation.clone();
        } else if (this.aimingBone) {
            // 保持最后的瞄准方向
            this.aimingBone.setWorldRotation(this._lastAimRotation);
        }
    }
}
