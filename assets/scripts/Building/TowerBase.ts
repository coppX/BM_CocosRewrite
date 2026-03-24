import { _decorator, Component, Node, Vec3, Quat, math } from 'cc';
import { EnemyManager } from '../Managers/EnemyManager';
const { ccclass, property } = _decorator;

/**
 * 防御塔基类
 * 提供防御塔的基础功能
 */
@ccclass('TowerBase')
export class TowerBase extends Component {

    @property
    public attackRange: number = 10;

    @property
    public attackInterval: number = 1.0;

    @property
    public damage: number = 10;

    @property
    public rotationSpeed: number = 5.0;

    protected _currentTarget: Node | null = null;
    protected _attackTimer: number = 0;

    /**
     * 查找攻击目标
     */
    protected findTarget(): Node | null {
        if (!EnemyManager.Instance) {
            return null;
        }

        // 获取范围内所有敌人
        const selfPos = this.node.getWorldPosition();
        const enemiesInRange = EnemyManager.Instance.getTargetsInRange(selfPos, this.attackRange);

        if (enemiesInRange.length === 0) {
            return null;
        }

        // 选择最近的存活敌人
        let closestEnemy: Node | null = null;
        let shortestDistance = Number.MAX_VALUE;

        for (const enemy of enemiesInRange) {
            if (!enemy.node.active || enemy.isDeadState()) {
                continue;
            }

            const distance = Vec3.squaredDistance(selfPos, enemy.node.getWorldPosition());
            if (distance < shortestDistance) {
                shortestDistance = distance;
                closestEnemy = enemy.node;
            }
        }

        return closestEnemy;
    }

    /**
     * 旋转朝向目标
     */
    protected rotateToTarget(target: Node, dt: number): void {
        if (!target) return;

        // 计算目标方向
        const targetPos = target.getWorldPosition();
        const selfPos = this.node.getWorldPosition();
        const direction = new Vec3();
        Vec3.subtract(direction, targetPos, selfPos);
        direction.y = 0; // 只在水平面旋转
        direction.normalize();

        if (direction.lengthSqr() === 0) return;

        // 计算目标旋转
        const targetRotation = new Quat();
        Quat.fromViewUp(targetRotation, direction);

        // 平滑旋转到目标
        const currentRotation = this.node.getWorldRotation();
        const newRotation = new Quat();
        Quat.slerp(newRotation, currentRotation, targetRotation, this.rotationSpeed * dt);
        this.node.setWorldRotation(newRotation);
    }

    /**
     * 执行攻击
     */
    protected attack(target: Node): void {
        // TODO: 实现攻击逻辑
        // 1. 播放攻击动画
        // 2. 生成子弹/箭矢
        // 3. 播放攻击音效
    }

    protected update(dt: number): void {
        // 更新攻击计时器
        this._attackTimer += dt;

        // 查找或更新目标
        if (!this._currentTarget || !this._currentTarget.isValid) {
            this._currentTarget = this.findTarget();
        }

        // 如果有目标
        if (this._currentTarget) {
            // 旋转朝向目标
            this.rotateToTarget(this._currentTarget, dt);

            // 检查是否可以攻击
            if (this._attackTimer >= this.attackInterval) {
                this.attack(this._currentTarget);
                this._attackTimer = 0;
            }
        }
    }
}
