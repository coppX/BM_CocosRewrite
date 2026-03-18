import { _decorator, Component, Node, Vec3, Prefab, instantiate, director } from 'cc';
import { PlayerController } from '../Player/PlayerController';
import { EnemyController } from '../Enemy/EnemyController';
import { AttackLogic } from '../Utils/AttackLogic';
const { ccclass, property } = _decorator;

/**
 * 武器基类
 * 处理攻击逻辑、目标管理和动画控制
 */
@ccclass('Weapon')
export abstract class Weapon extends Component {
    @property
    public damage: number = 10;

    @property(Node)
    public muzzle: Node | null = null;

    @property(Prefab)
    public bulletPrefab: Prefab | null = null;

    @property(Prefab)
    public muzzlePrefab: Prefab | null = null;

    @property({
        tooltip: '是否使用方向箭头'
    })
    public useDirectionalArrow: boolean = true;

    @property(PlayerController)
    public ownerPlayer: PlayerController | null = null;

    public currentTarget: Node | null = null;

    protected _attackLogic: AttackLogic | null = null;
    protected _actorAnimator: Component | null = null;
    protected _directionalArrow: any = null;
    protected _isAttacking: boolean = false;

    protected get hasValidTarget(): boolean {
        return this.currentTarget !== null && this.isValidTarget(this.currentTarget);
    }

    protected onLoad(): void {
        // 获取AttackLogic组件
        this._attackLogic = this.getComponent(AttackLogic);

        // 获取动画控制器
        this._actorAnimator = this.getComponentInChildren('cc.animation.AnimationController') as any;
        if (!this._actorAnimator) {
            this._actorAnimator = this.getComponent('cc.animation.AnimationController') as any;
        }

        // 查找DirectionalArrow
        const scene = director.getScene();
        if (scene) {
            this._directionalArrow = scene.getComponentInChildren('DirectionalArrow') as any;
            if (!this._directionalArrow) {
                this.useDirectionalArrow = false;
            }
        }
    }

    protected onEnable(): void {
        // 订阅DirectionalArrow的目标变化事件
        if (this._directionalArrow && this._directionalArrow.OnTargetChanged) {
            this._directionalArrow.OnTargetChanged.add(this.onDirectionalArrowTargetChanged, this);

            // 立即获取当前目标
            if (this.useDirectionalArrow && this._directionalArrow.CurrentTarget) {
                this.currentTarget = this._directionalArrow.CurrentTarget;
            }
        }
    }

    protected onDisable(): void {
        // 取消订阅事件
        if (this._directionalArrow && this._directionalArrow.OnTargetChanged) {
            this._directionalArrow.OnTargetChanged.remove(this.onDirectionalArrowTargetChanged, this);
        }
    }

    protected update(dt: number): void {
        // 更新目标
        this.updateTarget();

        // 根据目标状态控制攻击启停
        if (this.hasValidTarget) {
            this.startAttacking();
        } else {
            this.stopAttacking();
        }
    }

    /**
     * 开始攻击，播放动画
     */
    protected startAttacking(): void {
        this._isAttacking = true;
        this.attack(this.currentTarget);
    }

    /**
     * 停止攻击，重置动画
     */
    protected stopAttacking(): void {
        // 停止攻击动画
        if (this.ownerPlayer) {
            this.ownerPlayer.SetAttackAnimation(false);
        }

        // 如果武器自身有动画控制器，也停止攻击动画
        if (this._actorAnimator && typeof (this._actorAnimator as any).setValue === 'function') {
            (this._actorAnimator as any).setValue('IsAttack', false);
        }

        this._isAttacking = false;
    }

    /**
     * 攻击逻辑的入口，主要负责播放动画和音效
     */
    public attack(target: Node | null): void {
        // 播放攻击动画
        if (this.ownerPlayer) {
            this.ownerPlayer.SetAttackAnimation(true);
        }

        // 如果武器自身有动画控制器，也播放攻击动画
        if (this._actorAnimator && typeof (this._actorAnimator as any).setValue === 'function') {
            (this._actorAnimator as any).setValue('IsAttack', true);
        }
    }

    /**
     * 由动画事件调用，执行实际的攻击（如发射子弹）
     */
    public onAttackAnimEvent(): void {
        this.updateTarget();
        this._isAttacking = false;
    }

    /**
     * 更新当前目标
     */
    public updateTarget(): void {
        let newTarget: Node | null = null;

        if (this.useDirectionalArrow && this._directionalArrow) {
            const arrowTarget = this._directionalArrow.CurrentTarget;

            // 优先使用箭头指向的敌人目标
            if (arrowTarget && arrowTarget.getComponent(EnemyController)) {
                newTarget = arrowTarget;
            } else {
                // 如果箭头没指向敌人，则武器尝试寻找最近的敌人
                const closestEnemy = this._directionalArrow.GetClosestAttackableTarget?.();
                // 只有在确实找到了一个可攻击的敌人时，才更新目标
                if (closestEnemy) {
                    newTarget = closestEnemy;
                }
            }
        } else if (this._attackLogic) {
            // Fallback to old logic if arrow is missing
            newTarget = this._attackLogic.findNearestTarget(true);
        }

        // 如果找到了新目标，更新currentTarget
        if (newTarget) {
            this.currentTarget = newTarget;
        }

        // 检查是否在攻击范围内
        if (!this.isInAttackRange()) {
            this.currentTarget = null;
        }
    }

    /**
     * DirectionalArrow目标改变回调
     */
    private onDirectionalArrowTargetChanged(newTarget: Node): void {
        // 当箭头目标改变时，立即更新武器的目标
        if (this.useDirectionalArrow && this._directionalArrow) {
            if (newTarget && newTarget.getComponent(EnemyController)) {
                this.currentTarget = newTarget;
            } else {
                const closestEnemy = this._directionalArrow.GetClosestAttackableTarget?.();
                if (closestEnemy) {
                    this.currentTarget = closestEnemy;
                }
            }
        }
    }

    /**
     * 检查目标是否有效
     */
    protected isValidTarget(target: Node): boolean {
        if (!target) return false;

        const enemy = target.getComponent(EnemyController);
        if (enemy) {
            return !enemy.IsDead() && target.active;
        }

        return true;
    }

    /**
     * 检查目标是否在攻击范围内
     */
    public isInAttackRange(): boolean {
        if (!this.currentTarget || !this._attackLogic) return false;

        const distance = Vec3.squaredDistance(
            this.node.getPosition(),
            this.currentTarget.getPosition()
        );

        return distance <= this._attackLogic.attackRange * this._attackLogic.attackRange;
    }

    /**
     * 开始自动攻击
     */
    public tryAttack(): void {
        this.updateTarget();
    }
}
