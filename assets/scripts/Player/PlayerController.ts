import { _decorator, Component, Vec3, RigidBody, BoxCollider, Node, Animation } from 'cc';
import { HealthSystem } from '../Core/HealthSystem';
import { GameManager, GameState } from '../Managers/GameManager';
const { ccclass, property } = _decorator;

/**
 * 玩家控制器
 */
@ccclass('PlayerController')
export class PlayerController extends Component {
    private static _instance: PlayerController | null = null;

    public static get Instance(): PlayerController | null {
        return this._instance;
    }

    @property
    public moveSpeed: number = 5;

    @property
    public rotationSpeed: number = 10;

    @property
    public attackRange: number = 20;

    public isMoving: boolean = false;

    private _moveDirection: Vec3 = new Vec3();
    private _animation: Animation | null = null;
    private _healthSystem: HealthSystem | null = null;
    private _rigidBody: RigidBody | null = null;

    private _initialPosition: Vec3 = new Vec3();
    private _initialRotation: any = null;

    protected onLoad(): void {
        // 单例模式
        if (PlayerController._instance !== null && PlayerController._instance !== this) {
            this.node.destroy();
            return;
        }
        PlayerController._instance = this;

        // 记录初始位置和旋转
        this._initialPosition = this.node.getPosition().clone();
        this._initialRotation = this.node.getRotation().clone();
    }

    protected start(): void {
        this._animation = this.node.getComponent(Animation);
        this._healthSystem = this.node.getComponent(HealthSystem);
        this._rigidBody = this.node.getComponent(RigidBody);

        if (this._healthSystem) {
            this._healthSystem.OnHealthChanged = this.OnHealthChanged.bind(this);
            this._healthSystem.OnDeath = this.OnDeath.bind(this);
        }
    }

    protected update(dt: number): void {
        if (!GameManager.Instance || GameManager.Instance.CurrentState !== GameState.Playing) {
            return;
        }

        this.HandleMovement(dt);
    }

    private HandleMovement(dt: number): void {
        // TODO: 检查攻击逻辑
        // const canAttack = this.attackLogic?.canAttack;
        // const hasTarget = this.currentWeapon?.IsInAttackRange();

        if (this._moveDirection.lengthSqr() > 0.01) {
            // 朝向移动方向
            const dir = this._moveDirection.clone().normalize();
            const targetRotation = new Vec3();
            Vec3.transformQuat(targetRotation, Vec3.FORWARD, this.node.getRotation());

            // 简单的朝向处理
            const angle = Math.atan2(dir.x, dir.z);
            this.node.setRotationFromEuler(0, angle * 180 / Math.PI, 0);
        }

        if (this._moveDirection.lengthSqr() > 0.01) {
            const moveVec = this._moveDirection.clone().multiplyScalar(this.moveSpeed * dt);
            const newPos = this.node.getPosition().clone().add(moveVec);
            this.node.setPosition(newPos);

            // TODO: 播放移动动画
            this.isMoving = true;
        } else {
            this.isMoving = false;
        }
    }

    /**
     * 设置移动方向
     */
    public SetMoveDirection(direction: Vec3): void {
        this._moveDirection = direction.clone();
    }

    /**
     * 设置攻击动画
     */
    public SetAttackAnimation(isAttacking: boolean): void {
        // TODO: 实现攻击动画
    }

    private OnHealthChanged(currentHealth: number, maxHealth: number): void {
        // 更新UI或触发效果
    }

    private OnDeath(): void {
        // TODO: 播放死亡动画
        if (GameManager.Instance) {
            GameManager.Instance.GameOver();
        }
    }

    /**
     * 重置玩家状态
     */
    public ResetState(): void {
        this.node.setPosition(this._initialPosition);
        this.node.setRotation(this._initialRotation);

        if (this._healthSystem) {
            this._healthSystem.ResetHealth();
        }

        this._moveDirection = new Vec3();
        this.isMoving = false;
    }

    protected onDestroy(): void {
        if (PlayerController._instance === this) {
            PlayerController._instance = null;
        }
    }
}
