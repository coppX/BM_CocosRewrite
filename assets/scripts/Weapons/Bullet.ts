import { _decorator, Component, Node, Vec3, Prefab, instantiate, Quat } from 'cc';
import { HealthSystem } from '../Core/HealthSystem';
import { EnemyController } from '../Enemy/EnemyController';
import { GlobalVariables } from '../Core/GlobalVariables';
import { BulletManager } from '../Managers/BulletManager';
const { ccclass, property } = _decorator;

/**
 * 子弹组件
 * 完全参照BM_Minigame/Bullet.cs实现
 */
@ccclass('Bullet')
export class Bullet extends Component {
    @property
    public speed: number = 50;

    @property(Prefab)
    public hitEffectPrefab: Prefab | null = null;

    // Flight Settings
    private damage: number = 0;
    private maxTravelDistance: number = 20;
    private startPosition: Vec3 = new Vec3();

    // Target Tracking
    public target: Node | null = null;
    private hasTarget: boolean = false;

    public shooter: Node | null = null;

    protected onEnable(): void {
        this.register();
    }

    private register(): void {
        BulletManager.Instance?.registerBullet(this);
    }

    protected manualUpdate(deltaTime: number): void {
        this.move(deltaTime);
        this.checkForCollision();
    }

    public move(deltaTime: number): void {
        // 检查是否有有效的目标，且目标存在激活状态，并且若有 HealthSystem 则目标仍然存活
        if (this.hasTarget && this.target && this.target.active) {
            const healthSystem = this.target.getComponent(HealthSystem);
            if (!healthSystem || healthSystem.IsAlive) {
                // --- 追踪模式 ---
                let targetPosition = this.target.getPosition();

                const enemy = this.target.getComponent(EnemyController);
                if (enemy && enemy.attackPoint) {
                    targetPosition = enemy.attackPoint.getPosition();
                }

                const direction = new Vec3();
                Vec3.subtract(direction, targetPosition, this.node.getPosition());
                direction.normalize();

                const movement = direction.clone().multiplyScalar(this.speed * deltaTime);
                this.node.setPosition(this.node.getPosition().add(movement));

                if (direction.lengthSqr() > 0) {
                    const rotation = new Quat();
                    Quat.fromViewUp(rotation, direction);
                    this.node.setRotation(rotation);
                }
                return;
            }
        }

        // --- 直线飞行模式 ---
        const forward = new Vec3();
        this.node.getForward(forward);
        const movement = forward.multiplyScalar(this.speed * deltaTime);
        this.node.setPosition(this.node.getPosition().add(movement));

        const currentPos = this.node.getPosition();
        const distanceSqr = Vec3.squaredDistance(currentPos, this.startPosition);
        if (distanceSqr >= this.maxTravelDistance * this.maxTravelDistance) {
            this.deactivateBullet();
        }
    }

    private checkForCollision(): void {
        if (this.hasTarget && this.target) {
            let targetPosition = this.target.getPosition();
            const distanceToTarget = Vec3.squaredDistance(targetPosition, this.node.getPosition());
            const collisionRadius = 2; // 假设的碰撞半径

            if (distanceToTarget <= collisionRadius * collisionRadius) {
                let attackPoint = this.target;

                // 击中目标
                const enemy = this.target.getComponent(EnemyController);
                if (enemy) {
                    const shooterTransform = this.shooter ? this.shooter : this.node;
                    // 记录子弹为伤害来源
                    enemy.BeAttack(this.damage, shooterTransform);
                    attackPoint = enemy.attackPoint ? enemy.attackPoint : this.target;
                }

                // 销毁子弹
                this.deactivateBullet();

                // 如果当前活跃特效数量已达上限，跳过特效播放
                if (GlobalVariables.activeHitEffectsCount >= GlobalVariables.maxHitEffects) {
                    return;
                }

                if (this.hitEffectPrefab) {
                    const fx = instantiate(this.hitEffectPrefab);
                    fx.setPosition(attackPoint.getPosition());
                    fx.setScale(5, 5, 5);
                    fx.active = true;
                    GlobalVariables.activeHitEffectsCount++;

                    // 添加到场景
                    if (this.node.scene) {
                        this.node.scene.addChild(fx);
                    }
                }

                // TODO: 播放音效
                // AudioManager.Instance.Play("击中");
            }
        }
    }

    protected onDisable(): void {
        // 注销
        BulletManager.Instance?.unregisterBullet(this);

        this.target = null;
        this.hasTarget = false;
    }

    /**
     * 设置目标
     */
    public setTarget(newTarget: Node | null): void {
        if (newTarget) {
            this.target = newTarget;
            this.hasTarget = true;
        } else {
            this.hasTarget = false;
        }
    }

    /**
     * 设置子弹伤害
     */
    public setBulletDamage(newDamage: number): void {
        this.damage = newDamage;
    }

    /**
     * 设置子弹起始位置
     */
    public setBulletStartPosition(position: Vec3): void {
        this.startPosition = position.clone();
    }

    /**
     * 销毁子弹
     */
    private deactivateBullet(): void {
        this.node.destroy();
    }
}
