import { _decorator, Component, Node, Vec3, view } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 相机跟随管理器
 */
@ccclass('CameraFollowManager')
export class CameraFollowManager extends Component {
    private static _instance: CameraFollowManager | null = null;

    public static get Instance(): CameraFollowManager | null {
        return this._instance;
    }

    @property(Node)
    public followTarget: Node | null = null;

    @property
    public followSpeed: number = 5;

    private _horizontalDistance: number = 5;
    private _verticalDistance: number = 3;

    protected onLoad(): void {
        // 单例模式
        if (CameraFollowManager._instance !== null && CameraFollowManager._instance !== this) {
            this.node.destroy();
            return;
        }
        CameraFollowManager._instance = this;
    }

    protected start(): void {
        if (!this.followTarget) {
            console.error('Follow target is not set in CameraFollowManager.');
        } else {
            // 计算初始偏移距离
            const offset = this.node.getPosition().clone().subtract(this.followTarget.getPosition());

            // 水平距离：去掉y分量后长度
            const horizontalOffset = new Vec3(offset.x, 0, offset.z);
            this._horizontalDistance = horizontalOffset.length();

            // 垂直距离：y分量
            this._verticalDistance = offset.y;
        }
    }

    protected lateUpdate(dt: number): void {
        if (!this.followTarget) return;

        // 计算目标位置
        const targetPosition = this.followTarget.getPosition().clone();

        // 根据屏幕方向计算偏移（横屏和竖屏使用相同偏移）
        const visibleSize = view.getVisibleSize();
        let offset: Vec3;

        if (visibleSize.width > visibleSize.height) {
            // 横屏
            offset = new Vec3(0, this._verticalDistance, this._horizontalDistance);
        } else {
            // 竖屏
            offset = new Vec3(0, this._verticalDistance, this._horizontalDistance);
        }

        targetPosition.add(offset);

        // 平滑移动到目标位置
        const currentPos = this.node.getPosition();
        const newPos = new Vec3();
        Vec3.lerp(newPos, currentPos, targetPosition, this.followSpeed * dt);
        this.node.setPosition(newPos);

        // 如果需要相机始终看向目标，可以取消下面的注释
        // this.node.lookAt(this.followTarget.getPosition());
    }

    protected onDestroy(): void {
        if (CameraFollowManager._instance === this) {
            CameraFollowManager._instance = null;
        }
    }
}
