import { _decorator, Component, Node } from 'cc';
import { EnemyController } from '../Enemy/EnemyController';
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
        // 检测预设敌人
        for (let i = this.preEnemies.length - 1; i >= 0; i--) {
            const enemy = this.preEnemies[i];
            if (!enemy || !enemy.node) continue;

            const distance = this.node.getPosition().subtract(enemy.node.getPosition()).lengthSqr();
            if (distance < this.detectionRadius * this.detectionRadius) {
                // TODO: 建筑受击
                // if (this._building) {
                //     (this._building as any).beHit(enemy.node);
                // }

                enemy.releaseToPool();
                this.preEnemies.splice(i, 1);
                return;
            }
        }

        // TODO: 检测EnemyManager中的敌人
    }
}
