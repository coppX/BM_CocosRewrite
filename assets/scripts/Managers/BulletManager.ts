import { _decorator, Component } from 'cc';
import { Bullet } from '../Weapons/Bullet';
const { ccclass } = _decorator;

/**
 * 子弹管理器
 * 统一管理所有子弹的更新
 */
@ccclass('BulletManager')
export class BulletManager extends Component {
    private static _instance: BulletManager | null = null;

    public static get Instance(): BulletManager | null {
        return this._instance;
    }

    private _activeBullets: Bullet[] = [];

    protected onLoad(): void {
        if (BulletManager._instance !== null && BulletManager._instance !== this) {
            this.node.destroy();
            return;
        }
        BulletManager._instance = this;
    }

    /**
     * 注册子弹
     */
    public registerBullet(bullet: Bullet): void {
        if (!this._activeBullets.includes(bullet)) {
            this._activeBullets.push(bullet);
        }
    }

    /**
     * 注销子弹
     */
    public unregisterBullet(bullet: Bullet): void {
        const index = this._activeBullets.indexOf(bullet);
        if (index !== -1) {
            this._activeBullets.splice(index, 1);
        }
    }

    protected update(dt: number): void {
        // 反向遍历，因为子弹可能在更新过程中被移除
        for (let i = this._activeBullets.length - 1; i >= 0; i--) {
            const bullet = this._activeBullets[i];

            if (bullet && bullet.node.active) {
                bullet.manualUpdate(dt);
            } else {
                // 清理null或非激活的条目
                this._activeBullets.splice(i, 1);
            }
        }
    }

    protected onDestroy(): void {
        if (BulletManager._instance === this) {
            BulletManager._instance = null;
        }
    }
}
