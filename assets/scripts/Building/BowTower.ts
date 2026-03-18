import { _decorator, Component, Node, Vec3, Prefab, instantiate } from 'cc';
import { TowerBase } from './TowerBase';
import { Bullet } from '../Weapons/Bullet';
const { ccclass, property } = _decorator;

/**
 * 弩箭塔
 * 发射箭矢攻击敌人
 */
@ccclass('BowTower')
export class BowTower extends TowerBase {

    @property(Prefab)
    public arrowPrefab: Prefab | null = null;

    @property(Node)
    public firePoint: Node | null = null;

    protected Attack(target: Node): void {
        if (!this.arrowPrefab || !this.firePoint) {
            console.warn('[BowTower] 缺少箭矢预制体或发射点');
            return;
        }

        // 创建箭矢
        const arrow = instantiate(this.arrowPrefab);
        if (this.node.scene) {
            this.node.scene.addChild(arrow);
        }
        arrow.setWorldPosition(this.firePoint.getWorldPosition());

        // 设置箭矢目标和速度
        const arrowComponent = arrow.getComponent(Bullet);
        if (arrowComponent) {
            arrowComponent.setTarget(target);
            arrowComponent.setBulletDamage(this.damage);
            arrowComponent.shooter = this.node;
            arrowComponent.setBulletStartPosition(this.firePoint.getWorldPosition());
        }

        arrow.active = true;

        console.log('[BowTower] 发射箭矢');
    }
}
