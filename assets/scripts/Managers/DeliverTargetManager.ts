import { _decorator, Component, Node, Vec3 } from 'cc';
import { CoinTrigger } from '../Core/CoinTrigger';
const { ccclass } = _decorator;

/**
 * 投递目标管理器
 * 管理所有金币投递目标
 */
@ccclass('DeliverTargetManager')
export class DeliverTargetManager extends Component {
    private static _instance: DeliverTargetManager | null = null;

    public static get Instance(): DeliverTargetManager | null {
        return this._instance;
    }

    private _deliverTargets: CoinTrigger[] = [];

    protected onLoad(): void {
        if (DeliverTargetManager._instance !== null && DeliverTargetManager._instance !== this) {
            this.node.destroy();
            return;
        }
        DeliverTargetManager._instance = this;
    }

    /**
     * 注册投递目标
     */
    public registerTarget(target: CoinTrigger): void {
        if (!this._deliverTargets.includes(target)) {
            this._deliverTargets.push(target);
        }
    }

    /**
     * 注销投递目标
     */
    public unregisterTarget(target: CoinTrigger): void {
        const index = this._deliverTargets.indexOf(target);
        if (index !== -1) {
            this._deliverTargets.splice(index, 1);
        }
    }

    /**
     * 获取最近的投递目标
     */
    public getNearestTarget(position: Vec3, radius: number): Node | null {
        let nearestTarget: CoinTrigger | null = null;
        let minDistance = Number.MAX_VALUE;
        const radiusSqr = radius * radius;

        for (const target of this._deliverTargets) {
            // 跳过未激活的目标
            if (!target.node.active) {
                continue;
            }

            const distance = Vec3.squaredDistance(position, target.node.getPosition());
            if (distance < minDistance && distance <= radiusSqr) {
                minDistance = distance;
                nearestTarget = target;
            }
        }

        return nearestTarget ? nearestTarget.node : null;
    }

    protected onDestroy(): void {
        if (DeliverTargetManager._instance === this) {
            DeliverTargetManager._instance = null;
        }
    }
}
