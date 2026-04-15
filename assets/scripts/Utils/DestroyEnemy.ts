import { _decorator, Component, Node, Vec3 } from 'cc';
import { EnemyController } from '../Enemy/EnemyController';
import { EnemyManager } from '../Managers/EnemyManager';
import { Building } from '../Building/Building';
const { ccclass, property } = _decorator;

/**
 * 摧毁敌人组件
 * 检测敌人与建筑的碰撞
 */
@ccclass('DestroyEnemy')
export class DestroyEnemy extends Component {

    @property
    public detectionRadius: number = 1;

    @property
    public checkInterval: number = 0.5;

    @property(Building)
    public build: Building | null = null;

    @property({ type: [EnemyController], tooltip: '场景预置敌人，单独判断碰撞' })
    public preEnemies: EnemyController[] = [];

    private _checkTimer: number = 0;

    protected update(dt: number): void {
        this._checkTimer -= dt;
        if (this._checkTimer <= 0) {
            this._checkTimer = this.checkInterval;
            this.checkCollision();
        }
    }

    private checkCollision(): void {
        if (!this.build || !this.build.isValid) return;

        const selfPos = this.node.getWorldPosition();
        const radiusSqr = this.detectionRadius * this.detectionRadius;

        // 检测预设敌人
        for (let i = this.preEnemies.length - 1; i >= 0; i--) {
            const enemy = this.preEnemies[i];
            if (!enemy || !enemy.node) continue;

            const distance = Vec3.distance(selfPos, enemy.node.getWorldPosition());
            if (distance < radiusSqr) {
                this.build.beHit(enemy.node);
                enemy.releaseToPool();
                this.preEnemies.splice(i, 1);
                return;
            }
        }

        // 检测EnemyManager中的敌人
        if (EnemyManager.Instance) {
            const selfPos2 = this.node.getWorldPosition();
            const enemies = EnemyManager.Instance.getTargetsInRange(selfPos2, this.detectionRadius);
            for (const enemy of enemies) {
                if (!enemy.isDeadState()) {
                    this.build.beHit(enemy.node);
                    enemy.releaseToPool();
                    return;
                }
            }
        }
    }
}
