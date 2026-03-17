import { _decorator, Component, Node, Prefab, instantiate, resources, game } from 'cc';

/**
 * 对象池数据类
 * 用于存储和管理同一类型的对象
 */
class PoolData {
    /** 对象列表 */
    public poolList: Node[] = [];

    constructor(obj: Node) {
        this.poolList = [];
        this.pushObj(obj);
    }

    /**
     * 将对象放入池中
     */
    public pushObj(obj: Node): void {
        // 失活对象
        obj.active = false;
        // 存储到池中
        this.poolList.push(obj);
    }

    /**
     * 从池中取出对象
     */
    public getObj(): Node | null {
        if (this.poolList.length > 0) {
            const obj = this.poolList[0];
            this.poolList.shift(); // 移除第一个元素
            return obj;
        }
        return null;
    }
}

/**
 * 对象池管理器
 *
 * 功能：
 * - 管理游戏对象的复用，减少频繁创建销毁带来的性能开销
 * - 支持异步加载预制体
 * - 自动管理池容量，超出最大值时销毁对象
 */
export class PoolManager {
    private static _instance: PoolManager | null = null;

    /** 对象池字典 */
    private poolDic: Map<string, PoolData> = new Map();

    /** 对象池父节点 */
    private poolNode: Node | null = null;

    /** 池的最大容量 */
    public maxPoolSize: number = 100;

    /**
     * 获取单例
     */
    public static get Instance(): PoolManager {
        if (!PoolManager._instance) {
            PoolManager._instance = new PoolManager();
        }
        return PoolManager._instance;
    }

    private constructor() {
        // 私有构造函数，确保单例
    }

    /**
     * 从对象池获取对象（异步）
     * @param name 预制体路径（相对于resources目录）
     * @param callback 回调函数，参数为获取到的节点（未激活状态）
     */
    public getObj(name: string, callback: (obj: Node) => void): void {
        // 如果池中有对象，直接取出
        if (this.poolDic.has(name)) {
            const poolData = this.poolDic.get(name)!;
            if (poolData.poolList.length > 0) {
                const obj = poolData.getObj();
                if (obj) {
                    callback(obj);
                    return;
                }
            }
        }

        // 池中没有对象，异步加载预制体
        resources.load(name, Prefab, (err, prefab: Prefab) => {
            if (err) {
                console.error(`Failed to load prefab: ${name}`, err);
                return;
            }

            // 实例化预制体
            const obj = instantiate(prefab);
            obj.name = name;

            // 确保对象是未激活状态
            obj.active = false;

            callback(obj);
        });
    }

    /**
     * 将对象放回对象池
     * @param name 对象名称/预制体路径
     * @param obj 要放回的节点
     */
    public pushObj(name: string, obj: Node): void {
        // 确保有池节点
        if (!this.poolNode) {
            this.poolNode = new Node('Pool');
            game.addPersistRootNode(this.poolNode); // 设置为常驻节点
        }

        // 检查是否超过最大容量
        if (this.poolDic.has(name)) {
            const poolData = this.poolDic.get(name)!;
            if (poolData.poolList.length >= this.maxPoolSize) {
                // 超过容量，直接销毁对象
                obj.destroy();
                return;
            }

            // 放入已有的池
            poolData.pushObj(obj);
        } else {
            // 创建新的池
            this.poolDic.set(name, new PoolData(obj));
        }

        // 将对象设置为池节点的子节点
        obj.setParent(this.poolNode);
    }

    /**
     * 清空对象池
     * 主要用于场景切换时
     */
    public clear(): void {
        // 销毁所有池中的对象
        this.poolDic.forEach((poolData, key) => {
            poolData.poolList.forEach(obj => {
                if (obj && obj.isValid) {
                    obj.destroy();
                }
            });
        });

        // 清空字典
        this.poolDic.clear();

        // 销毁池节点
        if (this.poolNode && this.poolNode.isValid) {
            this.poolNode.destroy();
            this.poolNode = null;
        }
    }

    /**
     * 获取指定名称的池中对象数量
     */
    public getPoolSize(name: string): number {
        if (this.poolDic.has(name)) {
            return this.poolDic.get(name)!.poolList.length;
        }
        return 0;
    }

    /**
     * 预加载对象到池中
     * @param name 预制体路径
     * @param count 预加载数量
     */
    public preload(name: string, count: number): void {
        resources.load(name, Prefab, (err, prefab: Prefab) => {
            if (err) {
                console.error(`Failed to preload prefab: ${name}`, err);
                return;
            }

            for (let i = 0; i < count; i++) {
                const obj = instantiate(prefab);
                obj.name = name;
                this.pushObj(name, obj);
            }
        });
    }
}
