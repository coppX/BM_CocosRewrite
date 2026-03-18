import { _decorator, Component, Node, Vec3, Prefab, instantiate, Animation } from 'cc';
import { TowerBase } from './TowerBase';
import { Bullet } from '../Weapons/Bullet';
const { ccclass, property } = _decorator;

/**
 * 机枪塔
 * 连续射击攻击敌人
 */
@ccclass('MachineGunTower')
export class MachineGunTower extends TowerBase {

    @property(Prefab)
    public bulletPrefab: Prefab | null = null;

    @property(Node)
    public firePoint: Node | null = null;

    @property
    public burstCount: number = 3; // 连发子弹数

    @property
    public burstInterval: number = 0.1; // 连发间隔

    private _burstTimer: number = 0;
    private _currentBurst: number = 0;
    private _isBursting: boolean = false;

    protected Attack(target: Node): void {
        if (!this.bulletPrefab || !this.firePoint) {
            console.warn('[MachineGunTower] 缺少子弹预制体或发射点');
            return;
        }

        // 开始连发
        this._isBursting = true;
        this._currentBurst = 0;
        this._burstTimer = 0;

        // 播放射击动画
        const anim = this.node.getComponent(Animation);
        if (anim && anim.defaultClip) {
            anim.play();
        }
    }

    protected update(dt: number): void {
        super.update(dt);

        // 处理连发
        if (this._isBursting) {
            this._burstTimer += dt;

            if (this._burstTimer >= this.burstInterval) {
                this.FireBullet();
                this._currentBurst++;
                this._burstTimer = 0;

                if (this._currentBurst >= this.burstCount) {
                    this._isBursting = false;
                }
            }
        }
    }

    private FireBullet(): void {
        if (!this.bulletPrefab || !this.firePoint || !this._currentTarget) {
            return;
        }

        // 创建子弹
        const bullet = instantiate(this.bulletPrefab);
        if (this.node.scene) {
            this.node.scene.addChild(bullet);
        }
        bullet.setWorldPosition(this.firePoint.getWorldPosition());

        // 设置子弹目标和速度
        const bulletComponent = bullet.getComponent(Bullet);
        if (bulletComponent) {
            bulletComponent.setTarget(this._currentTarget);
            bulletComponent.setBulletDamage(this.damage);
            bulletComponent.shooter = this.node;
            bulletComponent.setBulletStartPosition(this.firePoint.getWorldPosition());
        }

        bullet.active = true;

        console.log('[MachineGunTower] 发射子弹');
    }
}
