import { _decorator, Component, Node, Vec3, Prefab, instantiate } from 'cc';
import { PlayerController } from '../Player/PlayerController';
import { EnemyController } from '../Enemy/EnemyController';
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

    protected _attackLogic: Component | null = null;
    protected _actorAnimator: Component | null = null;
    protected _directionalArrow: Component | null = null;
    protected _isAttacking: boolean = false;

    protected get hasValidTarget(): boolean {
        return this.currentTarget !== null && this.isValidTarget(this.currentTarget);
    }

    protected onLoad(): void {
        // TODO: 获取AttackLogic组件
        // this._attackLogic = this.getComponent('AttackLogic');

        // TODO: 获取动画控制器
        // this._actorAnimator = this.FindAnimationControllerInChildren();

        // TODO: 查找DirectionalArrow
        // this._directionalArrow = director.getScene().getComponentInChildren('DirectionalArrow');
    }

    protected onEnable(): void {
        // TODO: 订阅DirectionalArrow的目标变化事件
    }

    protected onDisable(): void {
        // TODO: 取消订阅事件
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
        // TODO: 实现动画停止逻辑
        if (this.ownerPlayer) {
            this.ownerPlayer.SetAttackAnimation(false);
        }
    }

    /**
     * 攻击逻辑的入口，主要负责播放动画和音效
     */
    public attack(target: Node | null): void {
        // TODO: 播放攻击动画
        if (this.ownerPlayer) {
            this.ownerPlayer.SetAttackAnimation(true);
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
        // TODO: 实现目标更新逻辑
        // 1. 如果使用DirectionalArrow，从箭头获取目标
        // 2. 否则使用AttackLogic查找最近目标
        // 3. 检查目标是否在攻击范围内
    }

    /**
     * 检查目标是否有效
     */
    protected isValidTarget(target: Node): boolean {
        if (!target) return false;

        const enemy = target.getComponent(EnemyController);
        if (enemy) {
            return !enemy.isDead() && target.active;
        }

        return true;
    }

    /**
     * 检查目标是否在攻击范围内
     */
    public isInAttackRange(): boolean {
        if (!this.currentTarget) return false;

        // TODO: 使用AttackLogic的攻击范围检查
        const distance = Vec3.squaredDistance(
            this.node.getPosition(),
            this.currentTarget.getPosition()
        );

        // 临时使用固定范围
        const attackRange = 20;
        return distance <= attackRange * attackRange;
    }

    /**
     * 开始自动攻击
     */
    public tryAttack(): void {
        this.updateTarget();
    }
}
