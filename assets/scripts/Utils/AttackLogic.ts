import { _decorator, Component, Node, Vec3 } from 'cc';
import { Weapon } from '../Weapons/Weapon';
import { EnemyManager } from '../Managers/EnemyManager';
import { EnemyController } from '../Enemy/EnemyController';
const { ccclass, property } = _decorator;

/**
 * 攻击逻辑组件
 * 处理目标查找和攻击触发
 */
@ccclass('AttackLogic')
export class AttackLogic extends Component {
    @property
    public attackRange: number = 10;

    @property
    public canAttack: boolean = true;

    private _weapon: Weapon | null = null;

    protected onLoad(): void {
        this._weapon = this.getComponent(Weapon);
    }

    protected update(dt: number): void {
        if (this.canAttack && this._weapon) {
            this._weapon.tryAttack();
        }
    }

    /**
     * 查找最近的目标
     */
    public findNearestTarget(useY: boolean): Node | null {
        let searchCenter = this.node.getPosition().clone();
        if (!useY) {
            searchCenter = new Vec3(searchCenter.x, 0, searchCenter.z);
        }

        return this.getClosestTarget(searchCenter);
    }

    /**
     * 触发一次攻击（由动画事件调用）
     */
    public tryAttackOnce(): void {
        if (this._weapon) {
            this._weapon.onAttackAnimEvent();
        }
    }

    /**
     * 获取最近的目标
     */
    private getClosestTarget(searchCenter: Vec3): Node | null {
        const validTargets = this.collectValidTargets(searchCenter);
        if (validTargets.length === 0) {
            return null;
        }

        return this.findClosestFromList(validTargets, searchCenter);
    }

    /**
     * 收集有效目标
     */
    private collectValidTargets(searchCenter: Vec3): Node[] {
        if (!EnemyManager.Instance) {
            return [];
        }

        const targetsInRange = EnemyManager.Instance.getTargetsInRange(searchCenter, this.attackRange);
        const validTargets: Node[] = [];

        for (const target of targetsInRange) {
            if (this.isTargetValid(target)) {
                validTargets.push(target.node);
            }
        }

        return validTargets;
    }

    /**
     * 从列表中查找最近的目标
     */
    private findClosestFromList(targets: Node[], searchCenter: Vec3): Node | null {
        let closest: Node | null = null;
        let shortestDistance = Number.MAX_VALUE;

        for (const target of targets) {
            const distance = Vec3.squaredDistance(searchCenter, target.getPosition());

            if (distance < shortestDistance) {
                shortestDistance = distance;
                closest = target;
            }
        }

        return closest;
    }

    /**
     * 检查目标是否有效
     */
    private isTargetValid(enemy: EnemyController): boolean {
        if (!enemy.node.active || enemy.IsDead()) {
            return false;
        }

        // 如果敌人已被瞄准，则跳过
        if (enemy.aimer) {
            return false;
        }

        return true;
    }
}
