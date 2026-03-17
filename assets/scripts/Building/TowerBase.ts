import { _decorator, Component, Node, Vec3 } from 'cc';
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
    protected FindTarget(): Node | null {
        // TODO: 实现查找敌人逻辑
        // 1. 获取范围内所有敌人
        // 2. 选择最近或优先级最高的目标
        return null;
    }

    /**
     * 旋转朝向目标
     */
    protected RotateToTarget(target: Node, dt: number): void {
        if (!target) return;

        // 计算目标方向
        const targetPos = target.getWorldPosition();
        const selfPos = this.node.getWorldPosition();
        const direction = new Vec3();
        Vec3.subtract(direction, targetPos, selfPos);
        direction.y = 0; // 只在水平面旋转
        direction.normalize();

        // TODO: 实现平滑旋转
    }

    /**
     * 执行攻击
     */
    protected Attack(target: Node): void {
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
            this._currentTarget = this.FindTarget();
        }

        // 如果有目标
        if (this._currentTarget) {
            // 旋转朝向目标
            this.RotateToTarget(this._currentTarget, dt);

            // 检查是否可以攻击
            if (this._attackTimer >= this.attackInterval) {
                this.Attack(this._currentTarget);
                this._attackTimer = 0;
            }
        }
    }
}
