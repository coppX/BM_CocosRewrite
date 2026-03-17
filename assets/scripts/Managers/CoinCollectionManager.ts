import { _decorator, Component, Vec3 } from 'cc';
const { ccclass } = _decorator;

/**
 * 金币收集管理器
 * 管理所有CoinCollection实例
 */
@ccclass('CoinCollectionManager')
export class CoinCollectionManager extends Component {
    private static _instance: CoinCollectionManager | null = null;

    public static get Instance(): CoinCollectionManager | null {
        return this._instance;
    }

    private _collections: Component[] = [];

    protected onLoad(): void {
        if (CoinCollectionManager._instance !== null && CoinCollectionManager._instance !== this) {
            this.node.destroy();
            return;
        }
        CoinCollectionManager._instance = this;
    }

    /**
     * 注册金币收集器
     */
    public registerCollection(collection: Component): void {
        if (!this._collections.includes(collection)) {
            this._collections.push(collection);
        }
    }

    /**
     * 注销金币收集器
     */
    public unregisterCollection(collection: Component): void {
        const index = this._collections.indexOf(collection);
        if (index !== -1) {
            this._collections.splice(index, 1);
        }
    }

    /**
     * 获取附近的收集器
     */
    public getNearbyCollections(position: Vec3, radius: number): Component[] {
        const nearbyCollections: Component[] = [];
        const radiusSqr = radius * radius;

        for (const collection of this._collections) {
            const disSqr = Vec3.squaredDistance(position, collection.node.getPosition());
            if (disSqr <= radiusSqr) {
                nearbyCollections.push(collection);
            }
        }

        return nearbyCollections;
    }

    protected onDestroy(): void {
        if (CoinCollectionManager._instance === this) {
            CoinCollectionManager._instance = null;
        }
    }
}
