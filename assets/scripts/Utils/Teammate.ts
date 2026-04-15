import { _decorator, Component, Material, MeshRenderer, Color, tween, Vec3 } from 'cc';
import { HealthSystem } from '../Core/HealthSystem';
import { PoolManager } from '../Managers/PoolManager';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
import { GlobalVariables } from '../Core/GlobalVariables';
import { EnemyManager } from '../Managers/EnemyManager';
import { TeamManager } from '../Managers/TeamManager';
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
            this._healthSystem.resetHealth();
        }

        this.resetHealthMultiplier();
        this.damageMultiplier = 1;

        TeamManager.Instance?.registerTeammate(this);
    }

    protected onDisable(): void {
        TeamManager.Instance?.unregisterTeammate(this);
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
                this.node.getWorldPosition(),
                this.detectionRadius
            );

            // 检查敌人碰撞
            for (const enemy of enemies) {
                if (!enemy || !enemy.node.active || enemy.isDeadState()) continue;

                const distance = Vec3.squaredDistance(
                    this.node.getWorldPosition(),
                    enemy.node.getWorldPosition()
                );

                if (distance < this.detectionRadius * this.detectionRadius) {
                    // 互相造成伤害
                    if (this._healthSystem) {
                        this._healthSystem.takeDamage(enemy.getDamage(), enemy.node);
                    }
                    enemy.beAttack(this.getDamage(), this.node);
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
        TeamManager.Instance?.unregisterTeammate(this);
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
     * 设置材质溶解值（通过 mainColor alpha 模拟）
     * @param dissolveValue 0=正常显示, 1=完全消失
     */
    private setMaterialDissolve(dissolveValue: number): void {
        const allRenderers = this.getComponentsInChildren(MeshRenderer);
        const alpha = Math.round((1 - dissolveValue) * 255);

        allRenderers.forEach(renderer => {
            if (!renderer) return;
            for (let i = 0; i < renderer.materials.length; i++) {
                const matInst = renderer.getMaterialInstance(i);
                if (!matInst) continue;
                try {
                    const color = matInst.getProperty('mainColor') as Color;
                    if (color) {
                        matInst.setProperty('mainColor', new Color(color.r, color.g, color.b, alpha));
                    } else {
                        matInst.setProperty('mainColor', new Color(255, 255, 255, alpha));
                    }
                } catch {}
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
