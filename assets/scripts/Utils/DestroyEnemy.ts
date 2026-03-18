import { _decorator, Component, Node, Vec3 } from 'cc';
import { EnemyController } from '../Enemy/EnemyController';
import { EnemyManager } from '../Managers/EnemyManager';
const { ccclass, property } = _decorator;

/**
 * 摧毁敌人组件
 * 检测敌人与建筑的碰撞
 */
@ccclass('DestroyEnemy')
export class DestroyEnemy extends Component {
    @property
    public actorTag: string = 'Enemy';

    @property
    public detectionRadius: number = 1;

    @property
    public checkInterval: number = 0.5;

    @property({ type: [EnemyController] })
    public preEnemies: EnemyController[] = [];

    private _checkTimer: number = 0;
    private _building: Component | null = null;

    protected start(): void {
        // TODO: 获取Building组件
        // this._building = this.getComponent('Building');
    }

    protected update(dt: number): void {
        this._checkTimer -= dt;
        if (this._checkTimer <= 0) {
            this._checkTimer = this.checkInterval;
            this.checkCollision();
        }
    }

    private checkCollision(): void {
        const selfPos = this.node.getPosition();

        // 检测预设敌人
        for (let i = this.preEnemies.length - 1; i >= 0; i--) {
            const enemy = this.preEnemies[i];
            if (!enemy || !enemy.node) continue;

            const distance = Vec3.squaredDistance(selfPos, enemy.node.getPosition());
            if (distance < this.detectionRadius * this.detectionRadius) {
                // 建筑受击（如果有Building组件）
                if (this._building && typeof (this._building as any).beHit === 'function') {
                    (this._building as any).beHit(enemy.node);
                }

                enemy.ReleaseToPool();
                this.preEnemies.splice(i, 1);
                return;
            }
        }

        // 检测EnemyManager中的敌人
        if (EnemyManager.Instance) {
            const enemies = EnemyManager.Instance.getTargetsInRange(selfPos, this.detectionRadius);

            for (const enemy of enemies) {
                if (!enemy || !enemy.node.active || enemy.IsDead()) continue;

                const distance = Vec3.squaredDistance(selfPos, enemy.node.getPosition());
                if (distance < this.detectionRadius * this.detectionRadius) {
                    // 建筑受击（如果有Building组件）
                    if (this._building && typeof (this._building as any).beHit === 'function') {
                        (this._building as any).beHit(enemy.node);
                    }

                    enemy.ReleaseToPool();
                    return;
                }
            }
        }
    }
}
