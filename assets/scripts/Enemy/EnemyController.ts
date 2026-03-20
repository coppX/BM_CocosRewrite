import { _decorator, Component, Node, Vec3, Animation, math, Material, MeshRenderer, SkinnedMeshRenderer } from 'cc';
import { HealthSystem } from '../Core/HealthSystem';
import { BezierFollower } from '../Utils/BezierFollower';
import { PlayerController } from '../Player/PlayerController';
import { Coin } from '../Utils/Coin';
import { EnemyManager } from '../Managers/EnemyManager';
import { PoolManager } from '../Managers/PoolManager';
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
        EnemyManager.Instance?.unregisterTarget(this);
    }

    private RegisterToManager(): void {
        EnemyManager.Instance?.registerTarget(this);
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
        // 获取所有渲染器
        const allRenderers = this.node.getComponentsInChildren(MeshRenderer);
        const allSkinnedRenderers = this.node.getComponentsInChildren(SkinnedMeshRenderer);

        // 处理普通渲染器
        for (const renderer of allRenderers) {
            if (renderer) {
                const materials = renderer.materials;
                for (let i = 0; i < materials.length; i++) {
                    const mat = materials[i];
                    // 检查材质是否有 _Saturation 属性
                    if (mat) {
                        try {
                            mat.setProperty('_Saturation', saturationValue);
                        } catch (e) {
                            // 材质可能没有这个属性
                        }
                    }
                }
            }
        }

        // 处理蒙皮渲染器
        for (const renderer of allSkinnedRenderers) {
            if (renderer) {
                const materials = renderer.materials;
                for (let i = 0; i < materials.length; i++) {
                    const mat = materials[i];
                    if (mat) {
                        try {
                            mat.setProperty('_Saturation', saturationValue);
                        } catch (e) {
                            // 材质可能没有这个属性
                        }
                    }
                }
            }
        }
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

        // 触发死亡动画
        if (this._animation) {
            // 播放死亡动画
            const deathClip = this._animation.getState('Death');
            if (deathClip) {
                this._animation.play('Death');
            } else {
                // 如果没有Death动画，尝试设置动画参数
                const animController = this.node.getComponent('cc.animation.AnimationController') as any;
                if (animController) {
                    animController.setValue('Death', true);
                }
            }
        }
    }

    private DropItems(): void {
        const dropOrigin = this.node.getPosition().clone();

        for (let i = 0; i < this.dropAmount; i++) {
            if (Math.random() > this.dropChance * this.dropChanceMultiplier) continue;

            // 计算起始位置：在敌人位置上方0.5米
            const startPos = dropOrigin.clone().add(new Vec3(0, 0.5, 0));

            // 计算目标位置：使用更受控的随机位置，限制范围在敌人周围2米内
            const randomX = (Math.random() * 2 - 1) * 2;
            const randomZ = (Math.random() * 2 - 1) * 2;
            const randomPos = dropOrigin.clone().add(new Vec3(randomX, 0.1, randomZ));

            // 使用对象池获取金币
            PoolManager.Instance?.getObj('Coin', (coinObj) => {
                if (coinObj) {
                    // 获取Coin组件
                    const coin = coinObj.getComponent(Coin);
                    if (coin) {
                        // 重置金币状态
                        coin.ResetState();

                        // 确保移除任何之前的关联
                        coin.spawnOwner = null;
                        coin.isBearByGenerator = false;
                    }

                    // 设置金币初始位置（对象此时是禁用的）
                    coinObj.setPosition(startPos);

                    // 激活金币
                    coinObj.active = true;

                    // 添加到场景
                    if (this.node.scene) {
                        this.node.scene.addChild(coinObj);
                    }

                    // 开始下落动画
                    if (coin) {
                        coin.DropOnGround(randomPos);
                    }
                }
            });
        }
    }

    public ReleaseToPool(): void {
        this.isDead = false;
        this.SetMaterialSaturation(1);
        this.node.active = false;
        // 对象池回收
        PoolManager.Instance?.pushObj(this.node.name, this.node);
    }

    public OnSpawn(): void {
        this.isDead = false;
        this.SetMaterialSaturation(1);

        if (this._animation) {
            // 重置动画
            const deathClip = this._animation.getState('Death');
            if (deathClip) {
                deathClip.stop();
            }

            // 重置动画控制器
            const animController = this.node.getComponent('cc.animation.AnimationController') as any;
            if (animController) {
                animController.setValue('Death', false);
            }
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
