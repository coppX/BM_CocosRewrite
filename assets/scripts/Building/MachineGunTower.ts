import { _decorator, Node, Vec3, Prefab, instantiate, Animation } from 'cc';
import { TowerBase } from './TowerBase';
import { Bullet } from '../Weapons/Bullet';
import { EnemyController } from '../Enemy/EnemyController';
const { ccclass, property } = _decorator;

@ccclass('MachineGunTower')
export class MachineGunTower extends TowerBase {
    @property(Prefab)
    public bulletPrefab: Prefab | null = null;

    @property(Node)
    public firePoint: Node | null = null;

    @property
    public burstCount: number = 3;

    @property
    public burstInterval: number = 0.1;

    private _burstTimer: number = 0;
    private _currentBurst: number = 0;
    private _isBursting: boolean = false;

    protected Attack(_target: Node): void {
        if (!this.bulletPrefab || !this.firePoint) {
            console.warn('[MachineGunTower] Missing bullet prefab or fire point');
            return;
        }

        this._isBursting = true;
        this._currentBurst = 0;
        this._burstTimer = 0;

        const anim = this.node.getComponent(Animation);
        if (anim && anim.defaultClip) {
            anim.play();
        }
    }

    protected update(dt: number): void {
        super.update(dt);

        if (!this._isBursting) {
            return;
        }

        this._burstTimer += dt;
        if (this._burstTimer < this.burstInterval) {
            return;
        }

        this._burstTimer = 0;
        this.fireBullet();
        this._currentBurst++;

        if (this._currentBurst >= this.burstCount) {
            this._isBursting = false;
        }
    }

    private fireBullet(): void {
        if (!this.bulletPrefab || !this.firePoint || !this._currentTarget) {
            return;
        }

        const bullet = instantiate(this.bulletPrefab);
        bullet.active = false;

        if (this.node.scene) {
            this.node.scene.addChild(bullet);
        }

        const spawnPos = this.firePoint.getWorldPosition();
        bullet.setWorldPosition(spawnPos);

        const shootDir = this.buildShootDirection(this._currentTarget, spawnPos);

        const bulletComponent = bullet.getComponent(Bullet);
        if (bulletComponent) {
            bulletComponent.setBulletStartPosition(spawnPos);
            bulletComponent.setInitialDirection(shootDir);
            bulletComponent.setBulletDamage(this.damage);
            bulletComponent.shooter = this.node;
            bulletComponent.setTarget(this._currentTarget);
        }

        bullet.active = true;
    }

    private buildShootDirection(target: Node, spawnPos: Vec3): Vec3 {
        const shootDir = new Vec3(this.firePoint!.forward.x, this.firePoint!.forward.y, this.firePoint!.forward.z);

        if (target && target.isValid) {
            let targetPos = target.getWorldPosition();
            const enemy = target.getComponent(EnemyController);
            if (enemy && enemy.attackPoint && enemy.attackPoint.isValid) {
                targetPos = enemy.attackPoint.getWorldPosition();
            }

            Vec3.subtract(shootDir, targetPos, spawnPos);
        }

        if (shootDir.lengthSqr() <= 0) {
            shootDir.set(this.node.forward.x, this.node.forward.y, this.node.forward.z);
        }

        if (shootDir.lengthSqr() <= 0) {
            shootDir.set(0, 0, -1);
        } else {
            shootDir.normalize();
        }

        return shootDir;
    }
}
