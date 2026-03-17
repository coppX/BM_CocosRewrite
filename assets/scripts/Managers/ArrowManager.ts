import { _decorator, Component, Node, Prefab, instantiate, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 箭头管理器
 * 管理场景中指向目标的箭头显示
 */
@ccclass('ArrowManager')
export class ArrowManager extends Component {
    private static _instance: ArrowManager | null = null;

    public static get instance(): ArrowManager | null {
        return this._instance;
    }

    @property(Prefab)
    public arrowPrefab: Prefab | null = null;

    @property(Vec3)
    public arrowOffset: Vec3 = new Vec3(0, 2, 0);

    private _arrow: Node | null = null;

    protected onLoad(): void {
        if (ArrowManager._instance !== null && ArrowManager._instance !== this) {
            this.node.destroy();
            return;
        }
        ArrowManager._instance = this;

        // 实例化箭头
        if (this.arrowPrefab) {
            this._arrow = instantiate(this.arrowPrefab);
            this._arrow.setParent(this.node.scene);
        }
    }

    /**
     * 更新箭头位置
     */
    public updateArrowPosition(target: Node | null): void {
        if (!this._arrow) return;

        if (!target) {
            this._arrow.active = false;
            return;
        }

        this._arrow.active = true;
        const targetPos = target.getPosition().add(this.arrowOffset);
        this._arrow.setPosition(targetPos);
    }

    protected onDestroy(): void {
        if (ArrowManager._instance === this) {
            ArrowManager._instance = null;
        }
    }
}
