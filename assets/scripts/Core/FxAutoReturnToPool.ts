import { _decorator, Component } from 'cc';
import { PoolManager } from '../Managers/PoolManager';
import { GlobalVariables } from './GlobalVariables';
const { ccclass, property } = _decorator;

/**
 * 自动返回对象池组件
 * 放置在粒子特效或其他临时对象上，在指定时间后自动返回对象池
 */
@ccclass('FxAutoReturnToPool')
export class FxAutoReturnToPool extends Component {
    @property({
        tooltip: '特效的生命周期（秒）。在此时间后，对象将返回对象池。'
    })
    public lifeTime: number = 1;

    @property({
        type: GlobalVariables.EffectType,
        tooltip: '特效类型'
    })
    public effectType: GlobalVariables.EffectType = GlobalVariables.EffectType.None;

    private _timeoutHandle: number | null = null;

    protected onEnable(): void {
        this.scheduleReturnToPool();
    }

    protected onDisable(): void {
        if (this._timeoutHandle !== null) {
            clearTimeout(this._timeoutHandle);
            this._timeoutHandle = null;
        }
    }

    private scheduleReturnToPool(): void {
        this._timeoutHandle = setTimeout(() => {
            if (this.node.active) {
                PoolManager.Instance?.pushObj(this.node.name, this.node);

                if (this.effectType === GlobalVariables.EffectType.HitEffect) {
                    GlobalVariables.activeHitEffectsCount--;
                } else if (this.effectType === GlobalVariables.EffectType.FireEffect) {
                    GlobalVariables.activeMuzzleEffectsCount--;
                }
            }
        }, this.lifeTime * 1000) as any;
    }
}
