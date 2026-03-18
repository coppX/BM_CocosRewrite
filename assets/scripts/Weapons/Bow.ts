import { _decorator, Vec2, Vec3, Quat, instantiate, Prefab } from 'cc';
import { Weapon } from './Weapon';
import { Bullet } from './Bullet';
import { EnemyController } from '../Enemy/EnemyController';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
import { GlobalVariables } from '../Core/GlobalVariables';
import { PoolManager } from '../Managers/PoolManager';
const { ccclass, property } = _decorator;

/**
 * 弓箭武器
 * 支持多发射击和随机间隔
 */
@ccclass('Bow')
export class Bow extends Weapon {
    @property
    public bulletSpawnNum: number = 1;

    @property
    public numIsRandom: boolean = false;

    @property(Vec2)
    public bulletSpawnRange: Vec2 = new Vec2(0, 0);

    @property({
        tooltip: '最小延迟帧数'
    })
    public minDelayFrames: number = 3;

    @property({
        tooltip: '最大延迟帧数'
    })
    public maxDelayFrames: number = 9;

    protected onEnable(): void {
        super.onEnable();
        EventCenter.Instance.AddEventListener(EventName.MapLevelUpgrade, this.onMapLevelUpgrade.bind(this));
    }

    protected onDisable(): void {
        super.onDisable();
        EventCenter.Instance.RemoveEventListener(EventName.MapLevelUpgrade, this.onMapLevelUpgrade.bind(this));
    }

    public onAttackAnimEvent(): void {
        super.onAttackAnimEvent();

        // TODO: 播放音效
        // AudioManager.Instance?.play('发射');

        // 启动协程来随机间隔生成子弹
        this.spawnBulletsWithRandomDelay(this.currentTarget);
    }

    private async spawnBulletsWithRandomDelay(target: any): Promise<void> {
        let spawnNum = this.bulletSpawnNum;
        if (this.numIsRandom) {
            spawnNum = Math.floor(Math.random() * this.bulletSpawnNum) + 1;
        }

        // 随机间隔生成子弹
        for (let i = 0; i < spawnNum; i++) {
            this.spawnSingleBullet(target);

            // 如果不是最后一个子弹，则等待随机帧数
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

    private spawnSingleBullet(target: any): void {
        // 预计算生成位置和方向
        let spawnPosition = this.node.getPosition().clone();
        let shootDir = new Vec3(0, 0, 1);

        if (this.muzzle) {
            // 随机偏移
            const randomOffsetLocal = new Vec3(
                (Math.random() * 2 - 1) * this.bulletSpawnRange.x,
                0,
                (Math.random() * 2 - 1) * this.bulletSpawnRange.y
            );

            const worldOffset = new Vec3();
            Vec3.transformQuat(worldOffset, randomOffsetLocal, this.muzzle.getWorldRotation());
            spawnPosition = this.muzzle.getWorldPosition().add(worldOffset);

            // 更新目标
            this.updateTarget();
            if (this.currentTarget) {
                let targetPos = this.currentTarget.getWorldPosition();

                const enemy = this.currentTarget.getComponent(EnemyController);
                if (enemy && enemy.attackPoint) {
                    targetPos = enemy.attackPoint.getWorldPosition();
                }

                shootDir = targetPos.subtract(spawnPosition).normalize();
            } else {
                this.muzzle.getWorldRotation().getEulerAngles(shootDir);
            }
        }

        // 直接实例化子弹预制体
        if (!this.bulletPrefab) return;

        const bulletObj = instantiate(this.bulletPrefab);
        if (!bulletObj) return;

        // 加入场景，否则 onEnable/onLoad 不会触发
        if (this.node.scene) {
            this.node.scene.addChild(bulletObj);
        }

        // 设置位置和旋转
        bulletObj.setWorldPosition(spawnPosition);
        const rotation = new Quat();
        Quat.fromViewUp(rotation, shootDir);
        bulletObj.setWorldRotation(rotation);

        // 激活子弹
        bulletObj.active = true;

        // 设置子弹属性
        const bullet = bulletObj.getComponent(Bullet);
        if (bullet) {
            bullet.setBulletStartPosition(spawnPosition);
            bullet.shooter = this.ownerPlayer ? this.ownerPlayer.node : this.node;
            bullet.setBulletDamage(this.damage);

            if (this.currentTarget) {
                bullet.setTarget(this.currentTarget);
                const enemy = this.currentTarget.getComponent(EnemyController);
                if (enemy) {
                    enemy.aimer = bulletObj;
                }
            }
        }

        // 生成开火特效
        if (this.muzzlePrefab && this.muzzle) {
            if (GlobalVariables.activeMuzzleEffectsCount < GlobalVariables.maxMuzzleEffects) {
                PoolManager.Instance?.getObj(this.muzzlePrefab.name, (fx) => {
                    if (fx) {
                        fx.setWorldPosition(this.muzzle!.getWorldPosition());
                        fx.setWorldRotation(this.muzzle!.getWorldRotation());
                        fx.active = true;
                        GlobalVariables.activeMuzzleEffectsCount++;
                    }
                });
            }
        }
    }

    private onMapLevelUpgrade(stage: GlobalVariables.Stage): void {
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
