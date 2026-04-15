import { _decorator, Component, Vec3, Node, animation, Quat, PhysicsSystem, geometry } from 'cc';
import { HealthSystem } from '../Core/HealthSystem';
import { GameManager, GameState } from '../Managers/GameManager';
import { AttackLogic } from '../Utils/AttackLogic';
import { Weapon } from '../Weapons/Weapon';
const { ccclass, property } = _decorator;

type AnimationControllerLike = animation.AnimationController;

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

    @property(Weapon)
    public currentWeapon: Weapon | null = null;

    private _moveDirection: Vec3 = new Vec3();
    private _animationController: AnimationControllerLike | null = null;
    private _healthSystem: HealthSystem | null = null;
    private _attackLogic: AttackLogic | null = null;
    private _ray: geometry.Ray = new geometry.Ray();

    private _initialPosition: Vec3 = new Vec3();
    private _initialRotation: Quat | null = null;

    protected onLoad(): void {
        // 单例模式
        if (PlayerController._instance !== null && PlayerController._instance !== this) {
            this.node.destroy();
            return;
        }
        PlayerController._instance = this;

        // 记录初始位置和旋转
        this._initialPosition = this.node.getWorldPosition().clone();
        this._initialRotation = this.node.getWorldRotation().clone();
    }

    protected start(): void {
        this._animationController = this.findAnimationControllerInChildren();
        this._healthSystem = this.node.getComponent(HealthSystem);

        if (this._healthSystem) {
            this._healthSystem.OnHealthChanged = this.onHealthChanged.bind(this);
            this._healthSystem.OnDeath = this.onDeath.bind(this);
        }

        this._attackLogic = this.currentWeapon?.getComponent(AttackLogic) || null;
        this.setAnimationBool('IsMoving', false);
        this.setAnimationBool('IsAttack', false);
    }

    protected update(dt: number): void {
        if (!GameManager.Instance || GameManager.Instance.CurrentState !== GameState.Playing) {
            return;
        }

        this.handleMovement(dt);
    }

    private handleMovement(dt: number): void {
        const canAttack = this._attackLogic?.canAttack;
        const hasTarget = this.currentWeapon?.currentTarget != null && this.currentWeapon?.currentTarget?.isValid && this.currentWeapon?.isInAttackRange();
        const targetNode = this.currentWeapon?.currentTarget;

        const shouldFaceTarget = canAttack && hasTarget;
        const isMovingNow = this._moveDirection.lengthSqr() > 0.01;
        if (shouldFaceTarget && targetNode && targetNode.isValid)
        {
            // 如果正在攻击且目标在范围内，朝向攻击目标
            const directionToTarget = targetNode.getWorldPosition().subtract(this.node.getWorldPosition());
            directionToTarget.y = 0; // 保持在水平面上

            if (directionToTarget.lengthSqr() > 0.0001)
            {
                directionToTarget.normalize();
                const angle = Math.atan2(directionToTarget.x, directionToTarget.z);
                const toRotation = new Quat();
                Quat.fromEuler(toRotation, 0, angle * 180 / Math.PI, 0);
                const smoothRotation = new Quat();
                Quat.slerp(smoothRotation, this.node.getRotation(), toRotation, this.rotationSpeed * dt);
                this.node.setRotation(smoothRotation);
            }
        }
        else
        {
            if (isMovingNow) {
                // 朝向移动方向（平滑旋转）
                const dir = this._moveDirection.clone().normalize();
                const angle = Math.atan2(dir.x, dir.z);
                const toRotation = new Quat();
                Quat.fromEuler(toRotation, 0, angle * 180 / Math.PI, 0);
                const smoothRotation = new Quat();
                Quat.slerp(smoothRotation, this.node.getRotation(), toRotation, this.rotationSpeed * dt);
                this.node.setRotation(smoothRotation);
            }
        }

        if (isMovingNow) {
            const moveVec = this._moveDirection.clone().multiplyScalar(this.moveSpeed * dt);
            const currentPos = this.node.getWorldPosition();
            const moveDir = this._moveDirection.clone().normalize();
            const moveDist = moveVec.length();

            // 射线检测：检查移动方向上是否有碰撞体阻挡
            geometry.Ray.set(this._ray, currentPos.x, currentPos.y + 0.5, currentPos.z, moveDir.x, 0, moveDir.z);
            if (PhysicsSystem.instance.raycastClosest(this._ray, 0xffffffff, moveDist + 0.5)) {
                const hit = PhysicsSystem.instance.raycastClosestResult;
                if (hit.collider && hit.collider.node !== this.node && !hit.collider.node.isChildOf(this.node)) {
                    const safeDistance = Math.max(0, hit.distance - 0.5);
                    if (safeDistance < moveDist) {
                        moveVec.set(moveDir).multiplyScalar(safeDistance);
                    }
                }
            }

            const newPos = currentPos.clone().add(moveVec);
            this.node.setWorldPosition(newPos);
        }

        this.setAnimationBool('IsMoving', isMovingNow);
    }

    /**
     * 设置移动方向
     */
    public setMoveDirection(direction: Vec3): void {
        this._moveDirection = direction.clone();
    }

    /**
     * 设置攻击动画
     */
    public setAttackAnimation(isAttacking: boolean): void {
        this.setAnimationBool('IsAttack', isAttacking);
    }

    private onHealthChanged(currentHealth: number, maxHealth: number): void {
        // 更新UI或触发效果
    }

    private onDeath(): void {
        this.setAnimationBool('IsMoving', false);
        this.setAnimationBool('IsAttack', false);

        if (GameManager.Instance) {
            GameManager.Instance.gameOver();
        }
    }

    /**
     * 重置玩家状态
     */
    public resetState(): void {
        this.node.setWorldPosition(this._initialPosition);
        this.node.setWorldRotation(this._initialRotation);

        if (this._healthSystem) {
            this._healthSystem.resetHealth();
        }

        this.setAnimationBool('IsMoving', false);
        this.setAnimationBool('IsAttack', false);

        this._moveDirection = new Vec3();
    }

    protected onDestroy(): void {
        if (PlayerController._instance === this) {
            PlayerController._instance = null;
        }
    }

    private setAnimationBool(variableName: string, value: boolean): void {
        if (!this._animationController) {
            return;
        }

        this._animationController.setValue(variableName, value);
    }

    private findAnimationControllerInChildren(): AnimationControllerLike | null {
        const queue: Node[] = [this.node];
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                continue;
            }

            const controller = current.getComponent(animation.AnimationController) as AnimationControllerLike | null;
            if (controller) {
                return controller;
            }

            queue.push(...current.children);
        }

        return null;
    }
}
