import { _decorator, Component, Node, Vec3, Animation, math } from 'cc';
import { HealthSystem } from '../Core/HealthSystem';
import { BezierFollower } from '../Utils/BezierFollower';
import { PlayerController } from '../Player/PlayerController';
import { Coin } from '../Utils/Coin';
const { ccclass, property } = _decorator;

/**
 * 敌人控制器
 */
@ccclass('EnemyController')
export class EnemyController extends Component {
    @property
    public damage: number = 10;

    @property
    public dropChance: number = 0.5;

    @property
    public dropAmount: number = 2;

    @property
    public knockbackAngleVariance: number = 0;

    @property
    public dropChanceMultiplier: number = 1;

    @property
    public damageMultiplier: number = 1;

    @property
    public hpMultiplier: number = 1;

    @property
    public isLeftMinion: boolean = false;

    @property(Node)
    public attackPoint: Node | null = null;

    public isDead: boolean = false;
    public aimer: Node | null = null;

    private _player: Node | null = null;
    private _healthSystem: HealthSystem | null = null;
    private _animation: Animation | null = null;
    private _bezierSpeed: number = 0;

    protected onLoad(): void {
        this._healthSystem = this.getComponent(HealthSystem);
        this._animation = this.getComponentInChildren(Animation);

        const bezierFollower = this.getComponent(BezierFollower);
        if (bezierFollower) {
            this._bezierSpeed = bezierFollower.speed;
        }

        this.RegisterToManager();
    }

    protected start(): void {
        if (PlayerController.Instance) {
            this._player = PlayerController.Instance.node;
        }

        if (this._healthSystem) {
            this._healthSystem.OnDeath = this.OnDeath.bind(this);
        }

        this.RegisterToManager();
    }

    protected onEnable(): void {
        this.RegisterToManager();
        this.aimer = null;
        this.ResetHealthMultiplier();
        this.damageMultiplier = 1;

        const bezierFollower = this.getComponent(BezierFollower);
        if (bezierFollower) {
            bezierFollower.speed = this._bezierSpeed;
        }
    }

    protected onDisable(): void {
        // TODO: EnemyManager.Instance?.UnregisterTarget(this);
    }

    private RegisterToManager(): void {
        // TODO: EnemyManager.Instance?.RegisterTarget(this);
    }

    private Attack(): void {
        if (!this._player) return;

        const playerHealth = this._player.getComponent(HealthSystem);
        if (playerHealth) {
            playerHealth.TakeDamage(this.GetDamage());
        }

        // TODO: AudioManager.Instance?.Play("enemy_attack");
    }

    public BeAttack(damage: number, damager: Node): void {
        if (this.isDead) return;
        if (this._healthSystem) {
            this._healthSystem.TakeDamage(damage, damager);
        }
    }

    private OnDeath(): void {
        if (this.isDead) return;
        this.isDead = true;

        // 设置材质饱和度为0（死亡效果）
        this.SetMaterialSaturation(0);
        this.ApplyKnockback();
        this.DropItems();
    }

    private SetMaterialSaturation(saturationValue: number): void {
        // TODO: 实现材质饱和度设置
    }

    private ApplyKnockback(): void {
        // 停止移动
        const bezierFollower = this.getComponent(BezierFollower);
        if (bezierFollower) {
            bezierFollower.StopMove();
        }

        // 确定朝向
        let faceDir = new Vec3();
        if (this._healthSystem && this._healthSystem.LastDamager) {
            Vec3.subtract(faceDir, this._healthSystem.LastDamager.getPosition(), this.node.getPosition());
            faceDir.normalize();
        } else if (this._player) {
            Vec3.subtract(faceDir, this._player.getPosition(), this.node.getPosition());
            faceDir.normalize();
        } else {
            faceDir = new Vec3(math.randomRange(-1, 1), 0, math.randomRange(-1, 1));
            faceDir.normalize();
        }

        // 设置朝向
        if (faceDir.lengthSqr() > 0) {
            const angle = Math.atan2(faceDir.x, faceDir.z);
            this.node.setRotationFromEuler(0, angle * 180 / Math.PI, 0);
        }

        // TODO: 触发死亡动画
    }

    private DropItems(): void {
        const dropOrigin = this.node.getPosition().clone();

        for (let i = 0; i < this.dropAmount; i++) {
            if (Math.random() > this.dropChance * this.dropChanceMultiplier) continue;

            // TODO: 从对象池获取金币并设置位置
            // 这里需要对象池系统支持
        }
    }

    public ReleaseToPool(): void {
        this.isDead = false;
        this.SetMaterialSaturation(1);
        this.node.active = false;
        // TODO: PoolMgr.Instance.PushObj(this.node.name, this.node);
    }

    public OnSpawn(): void {
        this.isDead = false;
        this.SetMaterialSaturation(1);

        if (this._animation) {
            // 重置动画
        }

        if (this._healthSystem) {
            this._healthSystem.ResetHealth();
        }
    }

    public IsDead(): boolean {
        if (this.isDead) return true;
        if (this._healthSystem && !this._healthSystem.IsAlive) return true;
        return false;
    }

    public GetDamage(): number {
        return this.damage * this.damageMultiplier;
    }

    public ApplyHealthMultiplier(multiplier: number): void {
        this.hpMultiplier = multiplier;
        if (this._healthSystem) {
            this._healthSystem.healthMultiplier = this.hpMultiplier;
        }
    }

    public ResetHealthMultiplier(): void {
        this.hpMultiplier = 1;
        if (this._healthSystem) {
            this._healthSystem.healthMultiplier = this.hpMultiplier;
        }
    }
}
