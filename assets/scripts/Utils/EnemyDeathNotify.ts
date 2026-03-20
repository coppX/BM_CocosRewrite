import { _decorator, Component } from 'cc';
import { EnemyController } from '../Enemy/EnemyController';
const { ccclass } = _decorator;

/**
 * 敌人死亡通知组件
 * 用于动画事件中通知死亡完成
 */
@ccclass('EnemyDeathNotify')
export class EnemyDeathNotify extends Component {
    /**
     * 死亡动画结束事件
     * 在动画编辑器中配置此方法为帧事件
     */
    public onDeathEnd(): void {
        const enemy = this.node.parent?.getComponent(EnemyController);
        if (enemy) {
            enemy.ReleaseToPool();
        }
    }
}
