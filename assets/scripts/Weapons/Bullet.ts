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
    public maxTravelDistance: number = 50;

    // Flight state
    private damage: number = 0;
    private startPosition: Vec3 = new Vec3();
    private readonly _tmpCurrentPos: Vec3 = new Vec3();
    private readonly _tmpTargetPos: Vec3 = new Vec3();
    private readonly _tmpDirection: Vec3 = new Vec3();
    private readonly _tmpMovement: Vec3 = new Vec3();
    private readonly _tmpRotation: Quat = new Quat();
    private readonly _flightDirection: Vec3 = new Vec3();
    private readonly _fixedTargetPosition: Vec3 = new Vec3();
    private _aliveTime: number = 0;
    private _hasResolvedHit: boolean = false;
    private _hasFixedTargetPosition: boolean = false;
    private _arrivedAtTarget: boolean = false;

    // Target tracking
    public target: Node | null = null;
    private hasTarget: boolean = false;

    public shooter: Node | null = null;

    protected onEnable(): void {
        this._aliveTime = 0;
        this._hasResolvedHit = false;
        this._hasFixedTargetPosition = false;
        this._arrivedAtTarget = false;
        if (this._flightDirection.lengthSqr() <= 0) {
            this.captureForwardAsFlightDirection();
        }
        this.register();
    }

    private register(): void {
        BulletManager.Instance?.registerBullet(this);
    }

    protected manualUpdate(deltaTime: number): void {
        this.move(deltaTime);
        this._aliveTime += deltaTime;
        this.checkForCollision();
    }

    public move(deltaTime: number): void {
        if (this._arrivedAtTarget) {
            this.resolveTargetHit(false);
            return;
        }

        const currentPos = this.node.getWorldPosition(this._tmpCurrentPos);
        const canTrackTarget = this.tryGetTrackedTargetPosition(this._tmpTargetPos);

        if (canTrackTarget) {
            Vec3.subtract(this._tmpDirection, this._tmpTargetPos, currentPos);
            const distanceToTarget = this._tmpDirection.length();

            if (distanceToTarget <= Number.EPSILON) {
                this.node.setWorldPosition(this._tmpTargetPos);
                this._arrivedAtTarget = true;
                this.resolveTargetHit(false);
                return;
            }

            this._tmpDirection.multiplyScalar(1 / distanceToTarget);
            this._flightDirection.set(this._tmpDirection.x, this._tmpDirection.y, this._tmpDirection.z);
            this.faceDirection(this._flightDirection);

            const moveDistance = this.speed * deltaTime;
            if (moveDistance >= distanceToTarget) {
                // Clamp to destination to avoid overshoot oscillation.
                this.node.setWorldPosition(this._tmpTargetPos);
                this._arrivedAtTarget = true;
                this.resolveTargetHit(false);
                return;
            }

            this._tmpMovement
                .set(this._flightDirection.x, this._flightDirection.y, this._flightDirection.z)
                .multiplyScalar(moveDistance);
            currentPos.add(this._tmpMovement);
            this.node.setWorldPosition(currentPos);
        } else {
            if (this._flightDirection.lengthSqr() <= 0) {
                this.captureForwardAsFlightDirection();
            }

            this._tmpMovement
                .set(this._flightDirection.x, this._flightDirection.y, this._flightDirection.z)
                .multiplyScalar(this.speed * deltaTime);

            currentPos.add(this._tmpMovement);
            this.node.setWorldPosition(currentPos);
        }

        if (this._hasResolvedHit) {
            return;
        }

        if (!canTrackTarget && this._flightDirection.lengthSqr() <= 0) {
            this.captureForwardAsFlightDirection();
        }

        // Always run range despawn check, including tracking mode.
        const latestPos = this.node.getWorldPosition(this._tmpCurrentPos);
        const distanceSqr = Vec3.squaredDistance(latestPos, this.startPosition);
        if (distanceSqr >= this.maxTravelDistance * this.maxTravelDistance) {
            this.deactivateBullet();
        }
    }

    private checkForCollision(): void {
        if (this._hasResolvedHit) {
            return;
        }

        if (this._aliveTime < this.minArmingTime) {
            return;
        }

        if (!this.tryGetTrackedTargetPosition(this._tmpTargetPos)) {
            return;
        }

        const currentPosition = this.node.getWorldPosition(this._tmpCurrentPos);
        const distanceToTarget = Vec3.squaredDistance(this._tmpTargetPos, currentPosition);
        const collisionRadiusSqr = this.collisionRadius * this.collisionRadius;

        if (distanceToTarget > collisionRadiusSqr) {
            return;
        }

        this.resolveTargetHit(false);
    }

    protected onDisable(): void {
        this.stopAndClearParticleSystems();
        BulletManager.Instance?.unregisterBullet(this);
        this.target = null;
        this.hasTarget = false;
        this._flightDirection.set(0, 0, 0);
        this._aliveTime = 0;
        this._hasResolvedHit = false;
        this._hasFixedTargetPosition = false;
        this._arrivedAtTarget = false;
    }

    /**
     * Set target for homing.
     */
    public setTarget(newTarget: Node | null): void {
        if (newTarget && newTarget.isValid) {
            this.target = newTarget;
            this.hasTarget = true;
            this.captureFixedTargetPosition();
            this.orientTowardsCurrentTarget();
        } else {
            this.target = null;
            this.hasTarget = false;
            this._hasFixedTargetPosition = false;
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
        this._hasResolvedHit = true;
        this._arrivedAtTarget = false;
        this.stopAndClearParticleSystems();
        this.node.destroy();
    }

    private stopAndClearParticleSystems(): void {
        const particleSystems = this.node.getComponentsInChildren(ParticleSystem);
        for (const particleSystem of particleSystems) {
            const particleLike = particleSystem as unknown as {
                stopEmitting?: () => void;
                stop?: () => void;
                clear?: () => void;
            };

            particleLike.stopEmitting?.();
            particleLike.stop?.();
            particleLike.clear?.();
        }
    }

    private tryGetTrackedTargetPosition(outPos: Vec3): boolean {
        if (!this.hasTarget) {
            return false;
        }

        if (this._hasFixedTargetPosition) {
            outPos.set(
                this._fixedTargetPosition.x,
                this._fixedTargetPosition.y,
                this._fixedTargetPosition.z
            );
            return true;
        }

        if (!this.target || !this.target.isValid || !this.target.active) {
            return false;
        }

        const healthSystem = this.target.getComponent(HealthSystem);
        if (healthSystem && !healthSystem.IsAlive) {
            return false;
        }

        this.getTargetWorldPosition(outPos);
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
        if (this.tryGetTrackedTargetPosition(this._tmpTargetPos)) {
            Vec3.subtract(this._tmpDirection, this._tmpTargetPos, currentWorldPos);
            if (this._tmpDirection.lengthSqr() <= Number.EPSILON) {
                return;
            }
            this._tmpDirection.normalize();
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

    private captureFixedTargetPosition(): void {
        if (!this.target || !this.target.isValid || !this.target.active) {
            this._hasFixedTargetPosition = false;
            return;
        }
        this.getTargetWorldPosition(this._fixedTargetPosition);
        this._hasFixedTargetPosition = true;
    }

    private resolveTargetHit(ignoreArmingTime: boolean = false): void {
        if (this._hasResolvedHit) {
            return;
        }

        if (!ignoreArmingTime && this._aliveTime < this.minArmingTime) {
            return;
        }

        if (!this.target || !this.target.isValid || !this.target.active) {
            this.deactivateBullet();
            return;
        }

        let attackPoint = this.target;
        const enemy = this.target.getComponent(EnemyController);
        if (enemy) {
            const shooterTransform = this.shooter ? this.shooter : this.node;
            enemy.beAttack(this.damage, shooterTransform);
            attackPoint = enemy.attackPoint ? enemy.attackPoint : this.target;
        }

        const bulletScene = this.node.scene;
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

            if (bulletScene) {
                bulletScene.addChild(fx);
            }
        }
    }
}
