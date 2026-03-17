import { _decorator, Prefab, Node, Vec3, instantiate } from 'cc';
import { Bullet } from './Bullet';
const { ccclass, property } = _decorator;

/**
 * 箭矢
 * 弩箭塔发射的抛物线箭矢
 */
@ccclass('Arrow')
export class Arrow extends Bullet {

    @property
    public gravity: number = 9.8; // 重力

    @property(Prefab)
    public hitEffectPrefab: Prefab | null = null;

    private _verticalVelocity: number = 0;

    protected start(): void {
        super.start();

        // 计算初始垂直速度（抛物线）
        if (this._target) {
            const targetPos = this._target.getWorldPosition();
            const selfPos = this.node.getWorldPosition();
            const distance = Vec3.distance(targetPos, selfPos);

            // 简化的抛物线计算
            const timeToTarget = distance / this.speed;
            this._verticalVelocity = this.gravity * timeToTarget * 0.5;
        }
    }

    protected update(dt: number): void {
        // 更新生存时间
        this._currentLifeTime += dt;
        if (this._currentLifeTime >= this.lifeTime) {
            this.DestroyBullet();
            return;
        }

        // 水平移动
        const movement = new Vec3();
        Vec3.multiplyScalar(movement, this._direction, this.speed * dt);

        // 垂直运动（抛物线）
        movement.y = this._verticalVelocity * dt;
        this._verticalVelocity -= this.gravity * dt;

        this.node.translate(movement);

        // 更新朝向（跟随飞行方向）
        const forward = new Vec3(this._direction.x, this._verticalVelocity / this.speed, this._direction.z);
        forward.normalize();
        this.node.forward = forward;
    }

    protected OnHit(target: Node): void {
        // 播放击中特效
        if (this.hitEffectPrefab) {
            const effect = instantiate(this.hitEffectPrefab);
            effect.setParent(this.node.scene);
            effect.setWorldPosition(this.node.getWorldPosition());
        }

        super.OnHit(target);
    }
}
