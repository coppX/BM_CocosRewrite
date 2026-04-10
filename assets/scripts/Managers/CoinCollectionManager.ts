import { _decorator, Component, Node, Vec3, director } from 'cc';
const { ccclass } = _decorator;

/**
 * 金币收集管理器
 * 管理所有CoinCollection实例
 */
@ccclass('CoinCollectionManager')
export class CoinCollectionManager extends Component {
    private static _instance: CoinCollectionManager | null = null;

    public static get Instance(): CoinCollectionManager | null {
        if (!this._instance) {
            const scene = director.getScene();
            if (scene) {
                const node = new Node('CoinCollectionManager');
                scene.addChild(node);
                this._instance = node.addComponent(CoinCollectionManager);
            }
        }
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
        if (this._collections.indexOf(collection) === -1) {
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
            const disSqr = Vec3.squaredDistance(position, collection.node.getWorldPosition());
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
