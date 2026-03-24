import { _decorator, Node, Vec3, Prefab, instantiate } from 'cc';
import { TowerBase } from './TowerBase';
import { Bullet } from '../Weapons/Bullet';
import { EnemyController } from '../Enemy/EnemyController';
const { ccclass, property } = _decorator;

@ccclass('BowTower')
export class BowTower extends TowerBase {
    @property(Prefab)
    public arrowPrefab: Prefab | null = null;

    @property(Node)
    public firePoint: Node | null = null;

    protected attack(target: Node): void {
        if (!this.arrowPrefab || !this.firePoint) {
            console.warn('[BowTower] Missing arrow prefab or fire point');
            return;
        }

        const arrow = instantiate(this.arrowPrefab);
        arrow.active = false;

        if (this.node.scene) {
            this.node.scene.addChild(arrow);
        }

        const spawnPos = this.firePoint.getWorldPosition();
        arrow.setWorldPosition(spawnPos);

        const shootDir = this.buildShootDirection(target, spawnPos);

        const arrowComponent = arrow.getComponent(Bullet);
        if (arrowComponent) {
            arrowComponent.setBulletStartPosition(spawnPos);
            arrowComponent.setInitialDirection(shootDir);
            arrowComponent.setBulletDamage(this.damage);
            arrowComponent.shooter = this.node;
            arrowComponent.setTarget(target);
        }

        arrow.active = true;
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
