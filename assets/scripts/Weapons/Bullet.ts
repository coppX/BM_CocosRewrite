import { _decorator, Component, Node, Vec3, Collider, ITriggerEvent } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 子弹基类
 * 提供子弹的基础飞行和碰撞检测功能
 */
@ccclass('Bullet')
export class Bullet extends Component {

    @property
    public speed: number = 50;

    @property
    public damage: number = 10;

    @property
    public lifeTime: number = 5; // 子弹生存时间

    protected _target: Node | null = null;
    protected _direction: Vec3 = new Vec3();
    protected _currentLifeTime: number = 0;
    protected _shooter: Node | null = null;

    /**
     * 设置子弹目标
     */
    public SetTarget(target: Node): void {
        this._target = target;
        if (target) {
            this.UpdateDirection();
        }
    }

    /**
     * 设置射击者
     */
    public SetShooter(shooter: Node): void {
        this._shooter = shooter;
    }

    /**
     * 更新飞行方向
     */
    protected UpdateDirection(): void {
        if (!this._target) return;

        const targetPos = this._target.getWorldPosition();
        const selfPos = this.node.getWorldPosition();
        Vec3.subtract(this._direction, targetPos, selfPos);
        this._direction.normalize();

        // 设置朝向
        this.node.lookAt(targetPos);
    }

    /**
     * 命中目标
     */
    protected OnHit(target: Node): void {
        // TODO: 对目标造成伤害
        // const health = target.getComponent(HealthSystem);
        // if (health) {
        //     health.TakeDamage(this.damage);
        // }

        // TODO: 播放击中特效
        this.DestroyBullet();
    }

    /**
     * 销毁子弹
     */
    protected DestroyBullet(): void {
        // TODO: 对象池回收
        this.node.destroy();
    }

    protected start(): void {
        // 添加碰撞监听
        const collider = this.node.getComponent(Collider);
        if (collider) {
            collider.on('onTriggerEnter', this.onTriggerEnter, this);
        }
    }

    protected update(dt: number): void {
        // 更新生存时间
        this._currentLifeTime += dt;
        if (this._currentLifeTime >= this.lifeTime) {
            this.DestroyBullet();
            return;
        }

        // 追踪目标（可选）
        if (this._target && this._target.isValid) {
            this.UpdateDirection();
        }

        // 移动
        const movement = new Vec3();
        Vec3.multiplyScalar(movement, this._direction, this.speed * dt);
        this.node.translate(movement);
    }

    private onTriggerEnter(event: ITriggerEvent): void {
        const otherNode = event.otherCollider.node;

        // 忽略射击者
        if (otherNode === this._shooter) {
            return;
        }

        // TODO: 检查是否是敌人
        // if (otherNode.getComponent(EnemyController)) {
        //     this.OnHit(otherNode);
        // }

        this.OnHit(otherNode);
    }

    protected onDestroy(): void {
        const collider = this.node.getComponent(Collider);
        if (collider) {
            collider.off('onTriggerEnter', this.onTriggerEnter, this);
        }
    }
}
