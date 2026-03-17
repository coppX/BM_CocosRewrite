import { _decorator, Component, Sprite, Color, Camera } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 血条组件
 * 显示生命值并始终面向摄像机
 */
@ccclass('HealthBar')
export class HealthBar extends Component {
    private _fillSprite: Sprite | null = null;
    private _mainCamera: Camera | null = null;

    protected start(): void {
        // 查找填充图片（Filled类型的Sprite）
        const sprites = this.getComponentsInChildren(Sprite);
        for (const sprite of sprites) {
            if (sprite.type === Sprite.Type.FILLED) {
                this._fillSprite = sprite;
                break;
            }
        }

        // 获取主摄像机
        this._mainCamera = Camera.main;
    }

    /**
     * 设置生命值
     */
    public setHealth(current: number, max: number): void {
        const healthPercentage = current / max;

        if (this._fillSprite) {
            this._fillSprite.fillRange = healthPercentage;

            // 根据血量设置颜色
            if (healthPercentage >= 0.5) {
                this._fillSprite.color = Color.GREEN;
            } else {
                this._fillSprite.color = Color.RED;
            }
        }
    }

    protected lateUpdate(dt: number): void {
        // 保持血条面向摄像机
        if (this._mainCamera) {
            this.node.setWorldRotation(this._mainCamera.node.getWorldRotation());
        }
    }
}
