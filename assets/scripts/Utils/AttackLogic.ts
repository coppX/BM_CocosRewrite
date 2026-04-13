import { _decorator, Component, Node, Vec3, game } from 'cc';
import { Weapon } from '../Weapons/Weapon';
import { EnemyManager } from '../Managers/EnemyManager';
import { EnemyController } from '../Enemy/EnemyController';
import { GameManager, GameState } from '../Managers/GameManager';
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

    @property({ tooltip: '攻击间隔（秒），发射子弹后开始计时' })
    public searchInterval: number = 0.5;

    private _weapon: Weapon | null = null;
    private _searchTimer: number = 0;
    private _waitingForAttack: boolean = false;

    protected onLoad(): void {
        this._weapon = this.getComponent(Weapon);
    }

    protected update(dt: number): void {
        if (!this.canAttack || !this._weapon) return;

        if (GameManager.Instance && GameManager.Instance.CurrentState === GameState.GameOver) {
            this._waitingForAttack = false;
            this._weapon.stopAttacking();
            return;
        }

        // 正在播放攻击动画，持续驱动动画状态，等子弹发射
        if (this._waitingForAttack) {
            if (this._weapon.currentTarget && this._weapon.currentTarget.isValid) {
                this._weapon.attack(this._weapon.currentTarget);
            } else {
                // 目标已失效，重置攻击状态
                this._waitingForAttack = false;
                this._weapon.stopAttacking();
                this._searchTimer = this.searchInterval;
            }
            return;
        }

        this._searchTimer -= dt;
        if (this._searchTimer <= 0) {
            this._weapon.tryAttack();

            if (this._weapon.currentTarget && this._weapon.currentTarget.isValid) {
                // 找到敌人，驱动攻击动画，等子弹发射后再重置计时
                this._waitingForAttack = true;
                this._weapon.attack(this._weapon.currentTarget);
            } else {
                // 没找到敌人，停止攻击动画，继续下一轮计时
                this._weapon.stopAttacking();
                this._searchTimer = this.searchInterval;
            }
        }
    }

    /**
     * 子弹发射后调用，重置攻击间隔计时
     */
    public onAttackFired(): void {
        this._waitingForAttack = false;
        this._searchTimer = this.searchInterval;
    }

    /**
     * 查找最近的目标
     */
    public findNearestTarget(useY: boolean): Node | null {
        let searchCenter = this.node.getWorldPosition().clone();
        if (!useY) {
            searchCenter = new Vec3(searchCenter.x, 0, searchCenter.z);
        }

        return this.getClosestTarget(searchCenter);
    }

    /**
     * 触发一次攻击（由动画事件调用）
     */
    public tryAttackOnce(): void {
        if (GameManager.Instance && GameManager.Instance.CurrentState === GameState.GameOver) {
            return;
        }

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
            const distance = Vec3.squaredDistance(searchCenter, target.getWorldPosition());

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
        if (!enemy.node.active || enemy.isDeadState()) {
            return false;
        }

        // 如果敌人已被瞄准，则跳过
        if (enemy.aimer) {
            // 清理失效瞄准引用
            if (!enemy.aimer.isValid || !enemy.aimer.active) {
                enemy.aimer = null;
            } else {
                return false;
            }
        }

        return true;
    }
}
