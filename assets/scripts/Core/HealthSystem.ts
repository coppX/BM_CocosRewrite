import { _decorator, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 生命值系统
 */
@ccclass('HealthSystem')
export class HealthSystem extends Component {
    @property
    public maxHealth: number = 100;

    @property
    public healthMultiplier: number = 1;

    private _currentHealth: number = 0;
    private _lastDamager: Node | null = null;

    public OnHealthChanged: ((currentHealth: number, maxHealth: number) => void) | null = null;
    public OnDeath: (() => void) | null = null;

    public get CurrentHealth(): number {
        return this._currentHealth;
    }

    public get IsAlive(): boolean {
        return this._currentHealth > 0;
    }

    public get LastDamager(): Node | null {
        return this._lastDamager;
    }

    protected onLoad(): void {
        this._currentHealth = this.maxHealth * this.healthMultiplier;
    }

    /**
     * 受到伤害
     */
    public TakeDamage(damage: number, damager?: Node): void {
        if (!this.IsAlive) return;

        if (damager) {
            this._lastDamager = damager;
        }

        this._currentHealth -= damage;
        this._currentHealth = Math.max(0, this._currentHealth);

        if (this.OnHealthChanged) {
            this.OnHealthChanged(this._currentHealth, this.maxHealth * this.healthMultiplier);
        }

        if (this._currentHealth <= 0 && this.OnDeath) {
            this.OnDeath();
        }
    }

    /**
     * 恢复生命值
     */
    public Heal(amount: number): void {
        if (!this.IsAlive) return;

        this._currentHealth += amount;
        this._currentHealth = Math.min(this._currentHealth, this.maxHealth * this.healthMultiplier);

        if (this.OnHealthChanged) {
            this.OnHealthChanged(this._currentHealth, this.maxHealth * this.healthMultiplier);
        }
    }

    /**
     * 重置生命值
     */
    public ResetHealth(): void {
        this._currentHealth = this.maxHealth * this.healthMultiplier;
        this._lastDamager = null;

        if (this.OnHealthChanged) {
            this.OnHealthChanged(this._currentHealth, this.maxHealth * this.healthMultiplier);
        }
    }
}
