import { _decorator, Component } from 'cc';
const { ccclass } = _decorator;

/**
 * Loa角色动画事件处理器
 * 用于在动画中触发攻击事件
 */
@ccclass('LoaAnimEvent')
export class LoaAnimEvent extends Component {
    private _attackLogic: Component | null = null;

    protected start(): void {
        // TODO: 获取父节点的AttackLogic组件
        // this._attackLogic = this.node.parent?.getComponent('AttackLogic');
    }

    /**
     * 动画事件：触发攻击
     * 在动画编辑器中配置此方法为帧事件
     */
    public onAnimFire(): void {
        // TODO: 调用AttackLogic的TryAttackOnce方法
        // if (this._attackLogic) {
        //     (this._attackLogic as any).tryAttackOnce();
        // }
    }
}
