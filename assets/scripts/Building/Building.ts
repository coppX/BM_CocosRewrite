import { _decorator, Component, Prefab, Node, MeshRenderer, Material, Color, Vec3, instantiate, game } from 'cc';
import { HealthBar } from '../UI/HealthBar';
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
    private _originalColors: Color[][] = [];
    private _originalEmissiveColors: Color[][] = [];
    private _isFlashing: boolean = false;
    private _flashElapsed: number = 0;
    private _originalScale: Vec3 = new Vec3();

    protected start(): void {
        this.currentHealth = this.maxHealth;

        // 收集所有MeshRenderer
        this._meshRenderers = this.getComponentsInChildren(MeshRenderer);

        // 缓存原始主颜色和发光颜色
        this._originalColors = [];
        this._originalEmissiveColors = [];
        for (let i = 0; i < this._meshRenderers.length; i++) {
            const renderer = this._meshRenderers[i];
            const matColors: Color[] = [];
            const emissiveColors: Color[] = [];
            for (let j = 0; j < renderer.materials.length; j++) {
                const matInst = renderer.getMaterialInstance(j);
                if (matInst) {
                    // 缓存mainColor
                    try {
                        const color = matInst.getProperty('mainColor') as Color;
                        matColors.push(color ? new Color(color) : Color.WHITE.clone());
                    } catch {
                        matColors.push(Color.WHITE.clone());
                    }
                    // 缓存emissive
                    try {
                        const emissive = matInst.getProperty('emissive') as Color;
                        emissiveColors.push(emissive ? new Color(emissive) : Color.BLACK.clone());
                    } catch {
                        emissiveColors.push(Color.BLACK.clone());
                    }
                } else {
                    matColors.push(Color.WHITE.clone());
                    emissiveColors.push(Color.BLACK.clone());
                }
            }
            this._originalColors[i] = matColors;
            this._originalEmissiveColors[i] = emissiveColors;
        }

        // 延迟初始化血条
        this.scheduleOnce(() => this.initializeHealthBar(), 1);
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
        if (this._meshRenderers.length > 0) {
            this._flashElapsed = 0;

            if (!this._isFlashing) {
                Vec3.copy(this._originalScale, this.node.scale);
            }
            this._isFlashing = true;

            if (this.needScale) {
                this.node.setScale(
                    this._originalScale.x * 1.1,
                    this._originalScale.y * 1.1,
                    this._originalScale.z * 1.1
                );
            }

            this.unschedule(this._updateFlash);
            this.schedule(this._updateFlash, 0);
        }
    }

    private _updateFlash = (dt: number): void => {
        if (!this.node || !this.node.isValid) {
            this._isFlashing = false;
            this.unschedule(this._updateFlash);
            return;
        }

        this._flashElapsed += dt;
        const t = this._flashElapsed / Math.max(0.01, this.flashDuration);

        if (t >= 1) {
            // 恢复原始颜色和缩放
            this._restoreOriginalColors();
            this.node.setScale(this._originalScale);
            this._isFlashing = false;
            this.unschedule(this._updateFlash);
            return;
        }

        const intensity = Math.sin(t * Math.PI) * this.maxIntensity;
        this._applyFlashColor(intensity);
    };

    private _applyFlashColor(intensity: number): void {
        for (let i = 0; i < this._meshRenderers.length; i++) {
            const renderer = this._meshRenderers[i];
            if (!renderer || !renderer.isValid) continue;

            for (let j = 0; j < renderer.materials.length; j++) {
                const matInst = renderer.getMaterialInstance(j);
                if (!matInst) continue;

                // Lerp mainColor
                const origColor = this._originalColors[i]?.[j] ?? Color.WHITE;
                const r = origColor.r + (this.flashColor.r - origColor.r) * intensity;
                const g = origColor.g + (this.flashColor.g - origColor.g) * intensity;
                const b = origColor.b + (this.flashColor.b - origColor.b) * intensity;
                const a = origColor.a + (this.flashColor.a - origColor.a) * intensity;
                try { matInst.setProperty('mainColor', new Color(r, g, b, a)); } catch {}

                // 设置emissive发光
                const origEmissive = this._originalEmissiveColors[i]?.[j] ?? Color.BLACK;
                const er = origEmissive.r + (this.flashColor.r - origEmissive.r) * intensity;
                const eg = origEmissive.g + (this.flashColor.g - origEmissive.g) * intensity;
                const eb = origEmissive.b + (this.flashColor.b - origEmissive.b) * intensity;
                try {
                    matInst.setProperty('emissive', new Color(er, eg, eb, 255));
                    matInst.setProperty('emissiveScale', intensity);
                } catch {}
            }
        }
    }

    private _restoreOriginalColors(): void {
        for (let i = 0; i < this._meshRenderers.length; i++) {
            const renderer = this._meshRenderers[i];
            if (!renderer || !renderer.isValid) continue;

            for (let j = 0; j < renderer.materials.length; j++) {
                const matInst = renderer.getMaterialInstance(j);
                if (!matInst) continue;

                try { matInst.setProperty('mainColor', this._originalColors[i]?.[j] ?? Color.WHITE); } catch {}
                try {
                    matInst.setProperty('emissive', this._originalEmissiveColors[i]?.[j] ?? Color.BLACK);
                    matInst.setProperty('emissiveScale', 0);
                } catch {}
            }
        }
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
            this.scheduleOnce(() => {
                if (this.healthBar) {
                    this.healthBar.node.active = false;
                }
            }, 2);

            if (this.currentHealth <= 0) {
                this.healthBar.node.active = false;
                this.node.destroy();
            }
        }

        this.shine();
    }
}
