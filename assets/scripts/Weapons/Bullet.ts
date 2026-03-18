import { _decorator, Component, Node, Vec3, Prefab, instantiate, Quat, ParticleSystem } from 'cc';
import { HealthSystem } from '../Core/HealthSystem';
import { EnemyController } from '../Enemy/EnemyController';
import { GlobalVariables } from '../Core/GlobalVariables';
import { BulletManager } from '../Managers/BulletManager';
const { ccclass, property } = _decorator;

/**
 * Bullet behavior: movement, tracking and hit handling.
 */
@ccclass('Bullet')
export class Bullet extends Component {
    @property
    public speed: number = 50;

    @property(Prefab)
    public hitEffectPrefab: Prefab | null = null;

    @property
    public collisionRadius: number = 0.8;

    @property
    public minArmingTime: number = 0.12;

    @property
    public maxTravelDistance: number = 20;

    // Flight state
    private damage: number = 0;
    private startPosition: Vec3 = new Vec3();
    private readonly _tmpCurrentPos: Vec3 = new Vec3();
    private readonly _tmpTargetPos: Vec3 = new Vec3();
    private readonly _tmpDirection: Vec3 = new Vec3();
    private readonly _tmpMovement: Vec3 = new Vec3();
    private readonly _tmpRotation: Quat = new Quat();
    private readonly _flightDirection: Vec3 = new Vec3();
    private _aliveTime: number = 0;
    private _updatedThisFrame: boolean = false;

    // Target tracking
    public target: Node | null = null;
    private hasTarget: boolean = false;

    public shooter: Node | null = null;

    protected onEnable(): void {
        this._aliveTime = 0;
        this._updatedThisFrame = false;
        if (this._flightDirection.lengthSqr() <= 0) {
            this.captureForwardAsFlightDirection();
        }
        this.register();
        this.restartVisualParticles();
    }

    private register(): void {
        BulletManager.Instance?.registerBullet(this);
    }

    protected manualUpdate(deltaTime: number): void {
        this._updatedThisFrame = true;
        this.move(deltaTime);
        this._aliveTime += deltaTime;
        this.checkForCollision();
    }

    protected lateUpdate(deltaTime: number): void {
        // Fallback path: keep bullets moving even if manager update is not active.
        if (!this._updatedThisFrame) {
            this.manualUpdate(deltaTime);
        }
        this._updatedThisFrame = false;
    }

    public move(deltaTime: number): void {
        const currentPos = this.node.getWorldPosition(this._tmpCurrentPos);
        const hasTrackDirection = this.tryGetTrackDirection(currentPos, this._tmpDirection);

        if (hasTrackDirection) {
            this._flightDirection.set(this._tmpDirection.x, this._tmpDirection.y, this._tmpDirection.z);
            this.faceDirection(this._flightDirection);
        } else if (this._flightDirection.lengthSqr() <= 0) {
            this.captureForwardAsFlightDirection();
        }

        this._tmpMovement
            .set(this._flightDirection.x, this._flightDirection.y, this._flightDirection.z)
            .multiplyScalar(this.speed * deltaTime);

        currentPos.add(this._tmpMovement);
        this.node.setWorldPosition(currentPos);

        // Always run range despawn check, including tracking mode.
        const distanceSqr = Vec3.squaredDistance(currentPos, this.startPosition);
        if (distanceSqr >= this.maxTravelDistance * this.maxTravelDistance) {
            this.deactivateBullet();
        }
    }

    private checkForCollision(): void {
        if (this._aliveTime < this.minArmingTime) {
            return;
        }

        if (!this.hasTarget || !this.target || !this.target.isValid || !this.target.active) {
            return;
        }

        const targetPosition = this.getTargetWorldPosition(this._tmpTargetPos);
        const currentPosition = this.node.getWorldPosition(this._tmpCurrentPos);
        const distanceToTarget = Vec3.squaredDistance(targetPosition, currentPosition);
        const collisionRadiusSqr = this.collisionRadius * this.collisionRadius;

        if (distanceToTarget > collisionRadiusSqr) {
            return;
        }

        let attackPoint = this.target;

        const enemy = this.target.getComponent(EnemyController);
        if (enemy) {
            const shooterTransform = this.shooter ? this.shooter : this.node;
            enemy.BeAttack(this.damage, shooterTransform);
            attackPoint = enemy.attackPoint ? enemy.attackPoint : this.target;
        }

        this.deactivateBullet();

        if (GlobalVariables.activeHitEffectsCount >= GlobalVariables.maxHitEffects) {
            return;
        }

        if (this.hitEffectPrefab) {
            const fx = instantiate(this.hitEffectPrefab);
            fx.setWorldPosition(attackPoint.getWorldPosition());
            fx.setScale(5, 5, 5);
            fx.active = true;
            GlobalVariables.activeHitEffectsCount++;

            if (this.node.scene) {
                this.node.scene.addChild(fx);
            }
        }
    }

    protected onDisable(): void {
        BulletManager.Instance?.unregisterBullet(this);
        this.target = null;
        this.hasTarget = false;
        this._flightDirection.set(0, 0, 0);
        this._aliveTime = 0;
        this._updatedThisFrame = false;
    }

    /**
     * Set target for homing.
     */
    public setTarget(newTarget: Node | null): void {
        if (newTarget && newTarget.isValid) {
            this.target = newTarget;
            this.hasTarget = true;
            this.orientTowardsCurrentTarget();
        } else {
            this.target = null;
            this.hasTarget = false;
        }
    }

    /**
     * Set initial world-space flight direction from emitter.
     */
    public setInitialDirection(direction: Vec3): void {
        if (!direction || direction.lengthSqr() <= 0) {
            return;
        }
        this._flightDirection.set(direction.x, direction.y, direction.z).normalize();
    }

    /**
     * Set bullet damage.
     */
    public setBulletDamage(newDamage: number): void {
        this.damage = newDamage;
    }

    /**
     * Set start position in world-space.
     */
    public setBulletStartPosition(position: Vec3): void {
        this.startPosition = position.clone();
    }

    private deactivateBullet(): void {
        this.node.destroy();
    }

    private tryGetTrackDirection(currentWorldPos: Vec3, outDirection: Vec3): boolean {
        if (!this.hasTarget || !this.target || !this.target.isValid || !this.target.active) {
            return false;
        }

        const healthSystem = this.target.getComponent(HealthSystem);
        if (healthSystem && !healthSystem.IsAlive) {
            return false;
        }

        const targetWorldPos = this.getTargetWorldPosition(this._tmpTargetPos);
        Vec3.subtract(outDirection, targetWorldPos, currentWorldPos);
        if (outDirection.lengthSqr() <= 0) {
            return false;
        }

        outDirection.normalize();
        return true;
    }

    private getTargetWorldPosition(outPos: Vec3): Vec3 {
        if (!this.target || !this.target.isValid) {
            return this.node.getWorldPosition(outPos);
        }

        const enemy = this.target.getComponent(EnemyController);
        if (enemy && enemy.attackPoint && enemy.attackPoint.isValid) {
            return enemy.attackPoint.getWorldPosition(outPos);
        }

        return this.target.getWorldPosition(outPos);
    }

    private orientTowardsCurrentTarget(): void {
        const currentWorldPos = this.node.getWorldPosition(this._tmpCurrentPos);
        if (this.tryGetTrackDirection(currentWorldPos, this._tmpDirection)) {
            this._flightDirection.set(this._tmpDirection.x, this._tmpDirection.y, this._tmpDirection.z);
            this.faceDirection(this._flightDirection);
        }
    }

    private faceDirection(direction: Vec3): void {
        if (direction.lengthSqr() <= 0) {
            return;
        }

        Quat.fromViewUp(this._tmpRotation, direction);
        this.node.setWorldRotation(this._tmpRotation);
    }

    private captureForwardAsFlightDirection(): void {
        this._flightDirection.set(this.node.forward.x, this.node.forward.y, this.node.forward.z);
        if (this._flightDirection.lengthSqr() <= 0) {
            this._flightDirection.set(0, 0, -1);
        } else {
            this._flightDirection.normalize();
        }
    }

    private restartVisualParticles(): void {
        const particles = this.node.getComponentsInChildren(ParticleSystem);
        for (const particle of particles) {
            if (!particle || !particle.isValid) {
                continue;
            }
            particle.clear();
            particle.stop();
            particle.play();
        }
    }
}
