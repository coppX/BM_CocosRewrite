import { _decorator, Vec2, Vec3, Quat, instantiate } from 'cc';
import { Weapon } from './Weapon';
import { Bullet } from './Bullet';
import { EnemyController } from '../Enemy/EnemyController';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
import { GlobalVariables } from '../Core/GlobalVariables';
import { PoolManager } from '../Managers/PoolManager';
const { ccclass, property } = _decorator;

@ccclass('Bow')
export class Bow extends Weapon {
    @property
    public bulletSpawnNum: number = 1;

    @property
    public numIsRandom: boolean = false;

    @property(Vec2)
    public bulletSpawnRange: Vec2 = new Vec2(0, 0);

    @property({ tooltip: 'Minimum frame delay between multi-shot bullets' })
    public minDelayFrames: number = 3;

    @property({ tooltip: 'Maximum frame delay between multi-shot bullets' })
    public maxDelayFrames: number = 9;

    private readonly _onMapLevelUpgradeHandler = (stage: number) => {
        this.onMapLevelUpgrade(stage);
    };

    protected onEnable(): void {
        super.onEnable();
        EventCenter.Instance.AddEventListener(EventName.MapLevelUpgrade, this._onMapLevelUpgradeHandler);
    }

    protected onDisable(): void {
        super.onDisable();
        EventCenter.Instance.RemoveEventListener(EventName.MapLevelUpgrade, this._onMapLevelUpgradeHandler);
    }

    public onAttackAnimEvent(): void {
        super.onAttackAnimEvent();
        this.spawnBulletsWithRandomDelay(this.currentTarget);
    }

    private async spawnBulletsWithRandomDelay(initialTarget: any): Promise<void> {
        let spawnNum = this.bulletSpawnNum;
        if (this.numIsRandom) {
            spawnNum = Math.floor(Math.random() * this.bulletSpawnNum) + 1;
        }

        for (let i = 0; i < spawnNum; i++) {
            this.spawnSingleBullet(initialTarget);

            if (i < spawnNum - 1) {
                const randomDelayFrames = Math.floor(
                    Math.random() * (this.maxDelayFrames - this.minDelayFrames + 1)
                ) + this.minDelayFrames;

                await this.waitForFrames(randomDelayFrames);
            }
        }
    }

    private waitForFrames(frames: number): Promise<void> {
        return new Promise(resolve => {
            let count = 0;
            const check = () => {
                count++;
                if (count >= frames) {
                    resolve();
                } else {
                    requestAnimationFrame(check);
                }
            };
            requestAnimationFrame(check);
        });
    }

    private spawnSingleBullet(initialTarget: any): void {
        if (!this.bulletPrefab) {
            return;
        }

        const fallbackDir = this.getFallbackShootDirection();
        let shootDir = fallbackDir.clone();
        let spawnPosition = this.node.getWorldPosition().clone();

        if (this.muzzle) {
            const randomOffsetLocal = new Vec3(
                (Math.random() * 2 - 1) * this.bulletSpawnRange.x,
                0,
                (Math.random() * 2 - 1) * this.bulletSpawnRange.y
            );

            const worldOffset = new Vec3();
            Vec3.transformQuat(worldOffset, randomOffsetLocal, this.muzzle.getWorldRotation());
            spawnPosition = this.muzzle.getWorldPosition().clone().add(worldOffset);
        }

        this.updateTarget();
        const targetNode = (this.currentTarget && this.currentTarget.isValid) ? this.currentTarget : initialTarget;
        if (targetNode && targetNode.isValid) {
            const targetPos = this.getTargetPointWorldPosition(targetNode);
            shootDir = targetPos.clone().subtract(spawnPosition);
        }

        if (shootDir.lengthSqr() <= 0) {
            shootDir = fallbackDir;
        } else {
            shootDir.normalize();
        }

        const bulletObj = instantiate(this.bulletPrefab);
        if (!bulletObj) {
            return;
        }

        bulletObj.active = false;

        const parentNode = this.node.scene ?? this.node.parent;
        if (parentNode) {
            parentNode.addChild(bulletObj);
        }

        bulletObj.setWorldPosition(spawnPosition);

        const rotation = new Quat();
        Quat.fromViewUp(rotation, shootDir);
        bulletObj.setWorldRotation(rotation);

        const bullet = bulletObj.getComponent(Bullet);
        if (bullet) {
            bullet.setBulletStartPosition(spawnPosition);
            bullet.setInitialDirection(shootDir);
            bullet.shooter = this.ownerPlayer ? this.ownerPlayer.node : this.node;
            bullet.setBulletDamage(this.damage);

            if (targetNode && targetNode.isValid) {
                bullet.setTarget(targetNode);

                const enemy = targetNode.getComponent(EnemyController);
                if (enemy) {
                    enemy.aimer = bulletObj;
                }
            }
        }

        bulletObj.active = true;

        if (this.muzzlePrefab && this.muzzle) {
            if (GlobalVariables.activeMuzzleEffectsCount < GlobalVariables.maxMuzzleEffects) {
                PoolManager.Instance?.getObj(this.muzzlePrefab.name, (fx) => {
                    if (!fx) {
                        return;
                    }
                    fx.setWorldPosition(this.muzzle!.getWorldPosition());
                    fx.setWorldRotation(this.muzzle!.getWorldRotation());
                    fx.active = true;
                    GlobalVariables.activeMuzzleEffectsCount++;
                });
            }
        }
    }

    private getFallbackShootDirection(): Vec3 {
        const dir = new Vec3(0, 0, -1);
        const rotation = this.muzzle ? this.muzzle.getWorldRotation() : this.node.getWorldRotation();
        Vec3.transformQuat(dir, dir, rotation);

        if (dir.lengthSqr() <= 0) {
            dir.set(this.node.forward.x, this.node.forward.y, this.node.forward.z);
        }

        if (dir.lengthSqr() <= 0) {
            dir.set(0, 0, -1);
        } else {
            dir.normalize();
        }

        return dir;
    }

    private getTargetPointWorldPosition(targetNode: any): Vec3 {
        let targetPos = targetNode.getWorldPosition();
        const enemy = targetNode.getComponent(EnemyController);
        if (enemy && enemy.attackPoint && enemy.attackPoint.isValid) {
            targetPos = enemy.attackPoint.getWorldPosition();
        }
        return targetPos;
    }

    private onMapLevelUpgrade(stage: number): void {
        if (
            stage === GlobalVariables.Stage.TowerAndFence1 ||
            stage === GlobalVariables.Stage.TowerAndFence2 ||
            stage === GlobalVariables.Stage.Cavalry1 ||
            stage === GlobalVariables.Stage.Cavalry2
        ) {
            this.damage *= 1.2;
        }
    }
}
