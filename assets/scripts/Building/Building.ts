import { _decorator, Component, Prefab, Node, MeshRenderer, Material, Color, tween, instantiate } from 'cc';
import { HealthBar } from '../UI/HealthBar';
import { PoolManager } from '../Managers/PoolManager';
const { ccclass, property } = _decorator;

/**
 * 建筑基类
 * 处理建筑的生命值、受击和闪白效果
 */
@ccclass('Building')
export class Building extends Component {
    @property(Prefab)
    public healthBarPrefab: Prefab | null = null;

    @property
    public maxHealth: number = 100;

    @property
    public enemyTag: string = 'Enemy';

    @property(Node)
    public hpBarTransform: Node | null = null;

    @property
    public healthBarScale: number = 1;

    @property({
        tooltip: '是否在低血量时锁定血量'
    })
    public lockBloodAtLowerHp: boolean = false;

    @property({
        tooltip: '闪白持续时间'
    })
    public flashDuration: number = 0.2;

    @property(Color)
    public flashColor: Color = new Color(81, 81, 81, 60);

    @property
    public maxIntensity: number = 1;

    @property
    public needScale: boolean = true;

    protected currentHealth: number = 0;
    protected healthBar: HealthBar | null = null;

    private _meshRenderers: MeshRenderer[] = [];
    private _originalMaterials: Material[][] = [];
    private _flashMaterials: Material[][] = [];
    private _isFlashing: boolean = false;

    protected start(): void {
        this.currentHealth = this.maxHealth;

        // 收集所有MeshRenderer
        this._meshRenderers = this.getComponentsInChildren(MeshRenderer);

        // 缓存原始材质
        this._originalMaterials = [];
        this._flashMaterials = [];

        for (let i = 0; i < this._meshRenderers.length; i++) {
            const renderer = this._meshRenderers[i];
            const mats = renderer.materials;
            this._originalMaterials[i] = [...mats];
            this._flashMaterials[i] = mats.map(mat => {
                const newMat = new Material();
                newMat.copy(mat);
                return newMat;
            });
        }

        // 延迟初始化血条
        setTimeout(() => this.initializeHealthBar(), 1000);
    }

    protected initializeHealthBar(): void {
        if (!this.healthBarPrefab || !this.hpBarTransform) return;

        const healthBarNode = instantiate(this.healthBarPrefab);
        healthBarNode.setPosition(this.hpBarTransform.getPosition());
        healthBarNode.setScale(healthBarNode.scale.multiplyScalar(this.healthBarScale));

        this.healthBar = healthBarNode.getComponent(HealthBar);
        if (this.healthBar) {
            this.healthBar.setHealth(this.currentHealth, this.maxHealth);
            healthBarNode.active = false;
        }
    }

    /**
     * 闪白效果
     */
    protected shine(): void {
        if (this._meshRenderers.length > 0 && !this._isFlashing) {
            this.shineCoroutine();
        }
    }

    private shineCoroutine(): void {
        this._isFlashing = true;
        const originalScale = this.node.scale.clone();

        // 应用闪白材质
        for (let i = 0; i < this._meshRenderers.length; i++) {
            this._meshRenderers[i].materials = this._flashMaterials[i];
        }

        if (this.needScale) {
            this.node.setScale(originalScale.multiplyScalar(1.1));
        }

        let elapsed = 0;
        const updateFlash = () => {
            elapsed += 0.016; // 约60fps
            const t = elapsed / this.flashDuration;

            if (t >= 1) {
                // 恢复原始材质和缩放
                for (let i = 0; i < this._meshRenderers.length; i++) {
                    this._meshRenderers[i].materials = this._originalMaterials[i];
                }
                this.node.setScale(originalScale);
                this._isFlashing = false;
                return;
            }

            const intensity = Math.sin(t * Math.PI) * this.maxIntensity;

            // 设置发光颜色
            for (let i = 0; i < this._flashMaterials.length; i++) {
                for (let j = 0; j < this._flashMaterials[i].length; j++) {
                    const mat = this._flashMaterials[i][j];
                    mat.setProperty('emissive', this.flashColor);
                    mat.setProperty('emissiveScale', intensity);
                }
            }

            requestAnimationFrame(updateFlash);
        };

        requestAnimationFrame(updateFlash);
    }

    /**
     * 受到攻击
     */
    public beHit(other: Node): void {
        if (!other) return;

        const percent = this.currentHealth / this.maxHealth;
        if (!this.lockBloodAtLowerHp || percent > 0.1) {
            this.currentHealth -= 10;
        }

        if (this.healthBar) {
            this.healthBar.node.active = true;
            this.healthBar.setHealth(this.currentHealth, this.maxHealth);

            // 2秒后隐藏血条
            setTimeout(() => {
                if (this.healthBar) {
                    this.healthBar.node.active = false;
                }
            }, 2000);

            if (this.currentHealth <= 0) {
                this.healthBar.node.active = false;
                this.node.destroy();
            }
        }

        this.shine();

        // 将敌人返回对象池
        PoolManager.Instance?.pushObj(other.name, other);
    }
}
