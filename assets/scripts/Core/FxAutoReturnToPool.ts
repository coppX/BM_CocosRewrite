import { _decorator, Component } from 'cc';
import { PoolManager } from '../Managers/PoolManager';
import { GlobalVariables, EffectType } from './GlobalVariables';
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
        tooltip: '特效类型'
    })
    public effectType: EffectType = GlobalVariables.EffectType.None;

    private readonly _returnToPool = () => {
        if (this.node && this.node.isValid && this.node.active) {
            PoolManager.Instance?.pushObj(this.node.name, this.node);

            if (this.effectType === GlobalVariables.EffectType.HitEffect) {
                GlobalVariables.activeHitEffectsCount--;
            } else if (this.effectType === GlobalVariables.EffectType.FireEffect) {
                GlobalVariables.activeMuzzleEffectsCount--;
            }
        }
    };

    protected onEnable(): void {
        this.scheduleOnce(this._returnToPool, this.lifeTime);
    }

    protected onDisable(): void {
        this.unschedule(this._returnToPool);
    }
}
