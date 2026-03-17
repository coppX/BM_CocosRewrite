import { _decorator, Component, Node, Vec3, Prefab, instantiate } from 'cc';
import { TowerBase } from './TowerBase';
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
        arrow.setParent(this.node.scene);
        arrow.setWorldPosition(this.firePoint.getWorldPosition());

        // TODO: 设置箭矢目标和速度
        // const arrowComponent = arrow.getComponent(Arrow);
        // if (arrowComponent) {
        //     arrowComponent.SetTarget(target);
        // }

        console.log('[BowTower] 发射箭矢');
    }
}
