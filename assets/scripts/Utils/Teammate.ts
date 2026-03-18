import { _decorator, Component, Material, MeshRenderer, tween, Vec3 } from 'cc';
import { HealthSystem } from '../Core/HealthSystem';
import { PoolManager } from '../Managers/PoolManager';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
import { GlobalVariables } from '../Core/GlobalVariables';
import { EnemyManager } from '../Managers/EnemyManager';
const { ccclass, property } = _decorator;

/**
 * 队友组件
 * 处理队友的战斗逻辑、生命系统和对象池管理
 */
@ccclass('Teammate')
export class Teammate extends Component {
    @property
    public damage: number = 10;

    @property
    public maxHealth: number = 100;

    @property({
        tooltip: '检测范围'
    })
    public detectionRadius: number = 1;

    @property
    public isLeftMinion: boolean = false;

    public damageMultiplier: number = 1;
    public hpMultiplier: number = 1;

    private _healthSystem: HealthSystem | null = null;

    protected onLoad(): void {
        // 获取或添加HealthSystem组件
        this._healthSystem = this.getComponent(HealthSystem);
        if (!this._healthSystem) {
            this._healthSystem = this.addComponent(HealthSystem);
        }

        // 订阅死亡事件
        if (this._healthSystem) {
            this._healthSystem.OnDeath = this.handleDeath.bind(this);
        }
    }

    protected onEnable(): void {
        // 恢复显示效果
        this.setMaterialDissolve(0);

        // 初始化血量
        if (this._healthSystem) {
            this._healthSystem.maxHealth = this.maxHealth;
            this._healthSystem.currentHealth = this.maxHealth;
        }

        this.resetHealthMultiplier();
        this.damageMultiplier = 1;

        // TODO: 注册到TeamManager
        // TeamManager.Instance?.registerTeammate(this);
    }

    protected onDestroy(): void {
        // 取消订阅事件
        if (this._healthSystem) {
            this._healthSystem.OnDeath = null;
        }
    }

    /**
     * 更新碰撞检测
     */
    public updateCollision(): void {
        if (!this._healthSystem || this._healthSystem.CurrentHealth <= 0) return;

        // 使用EnemyManager获取范围内的敌人
        if (EnemyManager.Instance) {
            const enemies = EnemyManager.Instance.getTargetsInRange(
                this.node.getPosition(),
                this.detectionRadius
            );

            // 检查敌人碰撞
            for (const enemy of enemies) {
                if (!enemy || !enemy.node.active || enemy.IsDead()) continue;

                const distance = Vec3.squaredDistance(
                    this.node.getPosition(),
                    enemy.node.getPosition()
                );

                if (distance < this.detectionRadius * this.detectionRadius) {
                    // 互相造成伤害
                    if (this._healthSystem) {
                        this._healthSystem.TakeDamage(enemy.GetDamage(), enemy.node);
                    }
                    enemy.BeAttack(this.getDamage(), this.node);
                    break;
                }
            }
        }

        this.checkMinionsCollision();
    }

    /**
     * 处理死亡
     */
    private handleDeath(): void {
        // TODO: 从TeamManager注销
        // TeamManager.Instance?.unregisterTeammate(this);

        this.dissolveAndDeathSequence();
    }

    /**
     * 溶解和死亡动画序列
     */
    private dissolveAndDeathSequence(): void {
        const dissolveDuration = 0.3;

        tween(this.node)
            .to(dissolveDuration, {}, {
                onUpdate: (target, ratio) => {
                    this.setMaterialDissolve(ratio);
                }
            })
            .delay(0.2)
            .call(() => {
                this.releaseToPool();
            })
            .start();
    }

    /**
     * 返回对象池
     */
    public releaseToPool(): void {
        if (!this.node.active) return;

        this.node.active = false;
        PoolManager.Instance?.pushObj(this.node.name, this.node);
    }

    /**
     * 设置材质溶解值
     */
    private setMaterialDissolve(dissolveValue: number): void {
        const allRenderers = this.getComponentsInChildren(MeshRenderer);

        allRenderers.forEach(renderer => {
            if (renderer) {
                const materials = renderer.materials;
                materials.forEach(mat => {
                    if (mat && mat.getProperty('_Dissolve') !== undefined) {
                        mat.setProperty('_Dissolve', dissolveValue);
                    }
                });
            }
        });
    }

    /**
     * 检查小怪碰撞
     */
    private checkMinionsCollision(): void {
        if (this.isLeftMinion && !GlobalVariables.IsLeftMinionCollision) {
            GlobalVariables.IsLeftMinionCollision = true;
            EventCenter.Instance.eventTrigger(EventName.MinionsCollision, this.isLeftMinion);
        } else if (!this.isLeftMinion && !GlobalVariables.IsRightMinionCollision) {
            GlobalVariables.IsRightMinionCollision = true;
            EventCenter.Instance.eventTrigger(EventName.MinionsCollision, this.isLeftMinion);
        }
    }

    /**
     * 获取伤害值
     */
    public getDamage(): number {
        return this.damage * this.damageMultiplier;
    }

    /**
     * 应用血量倍数
     */
    public applyHealthMultiplier(multiplier: number): void {
        this.hpMultiplier = multiplier;
        if (this._healthSystem) {
            this._healthSystem.healthMultiplier = this.hpMultiplier;
        }
    }

    /**
     * 重置血量倍数
     */
    private resetHealthMultiplier(): void {
        this.hpMultiplier = 1;
        if (this._healthSystem) {
            this._healthSystem.healthMultiplier = this.hpMultiplier;
        }
    }
}
