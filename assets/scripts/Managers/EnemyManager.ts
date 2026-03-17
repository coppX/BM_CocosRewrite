import { _decorator, Component, Vec3 } from 'cc';
import { EnemyController } from '../Enemy/EnemyController';
const { ccclass } = _decorator;

/**
 * 敌人管理器
 * 管理所有敌人实例，提供范围查询功能
 */
@ccclass('EnemyManager')
export class EnemyManager extends Component {
    private static _instance: EnemyManager | null = null;

    public static get Instance(): EnemyManager | null {
        return this._instance;
    }

    private _targets: EnemyController[] = [];

    protected onLoad(): void {
        if (EnemyManager._instance !== null && EnemyManager._instance !== this) {
            this.node.destroy();
            return;
        }
        EnemyManager._instance = this;
    }

    /**
     * 注册敌人
     */
    public registerTarget(target: EnemyController): void {
        if (!this._targets.includes(target)) {
            this._targets.push(target);
        }
    }

    /**
     * 注销敌人
     */
    public unregisterTarget(target: EnemyController): void {
        const index = this._targets.indexOf(target);
        if (index !== -1) {
            this._targets.splice(index, 1);
        }
    }

    /**
     * 获取范围内的敌人
     */
    public getTargetsInRange(center: Vec3, range: number): EnemyController[] {
        const targetsInRange: EnemyController[] = [];
        const rangeSqr = range * range;

        for (const target of this._targets) {
            if (target && target.node.active) {
                const disSqr = Vec3.squaredDistance(center, target.node.getPosition());
                if (disSqr <= rangeSqr) {
                    targetsInRange.push(target);
                }
            }
        }

        return targetsInRange;
    }

    /**
     * 获取左右两侧的小兵
     * @returns [左侧敌人列表, 右侧敌人列表]
     */
    public getMinions(): [EnemyController[], EnemyController[]] {
        const leftEnemies: EnemyController[] = [];
        const rightEnemies: EnemyController[] = [];

        for (const target of this._targets) {
            if (target.isLeftMinion) {
                leftEnemies.push(target);
            } else {
                rightEnemies.push(target);
            }
        }

        return [leftEnemies, rightEnemies];
    }

    protected onDestroy(): void {
        if (EnemyManager._instance === this) {
            EnemyManager._instance = null;
        }
    }
}
