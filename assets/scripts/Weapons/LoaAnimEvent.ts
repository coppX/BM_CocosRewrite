import { _decorator, Component } from 'cc';
import { AttackLogic } from '../Utils/AttackLogic';
const { ccclass } = _decorator;

/**
 * Loa角色动画事件处理器
 * 用于在动画中触发攻击事件
 */
@ccclass('LoaAnimEvent')
export class LoaAnimEvent extends Component {
    private _attackLogic: AttackLogic | null = null;

    protected start(): void {
        // 获取父节点的AttackLogic组件
        this._attackLogic = this.node.parent?.getComponent(AttackLogic) || null;
    }

    /**
     * 动画事件：触发攻击
     * 在动画编辑器中配置此方法为帧事件
     */
    public onAnimFire(): void {
        // 调用AttackLogic的TryAttackOnce方法
        if (this._attackLogic) {
            this._attackLogic.tryAttackOnce();
        }
    }
}
