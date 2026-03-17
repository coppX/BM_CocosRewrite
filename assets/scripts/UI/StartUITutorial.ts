import { _decorator, Component, Node, UITransform, Vec2, Vec3, tween } from 'cc';
const { ccclass, property } = _decorator;

/**
 * StartUITutorial - 开始界面摇杆教程动画
 *
 * 功能：展示摇杆操作教程，手柄会循环做1/4圆周运动
 * - 0.5秒内从右侧(0度)移动到上方(90度)
 * - 然后回到中心停留0.5秒
 * - 无限循环
 */
@ccclass('StartUITutorial')
export class StartUITutorial extends Component {

    private _joystickBackground: Node | null = null;
    private _joystickHandle: Node | null = null;
    private _isAnimating: boolean = false;

    /**
     * 组件启用时调用
     */
    protected onEnable(): void {
        // 查找子节点：背景节点名为 'Bg'，手柄节点名为 'Image'
        this._joystickBackground = this.node.getChildByName('Bg');
        this._joystickHandle = this._joystickBackground?.getChildByName('Image') || null;

        // 确保摇杆UI是可见的，并且手柄在中心位置
        if (this._joystickBackground) {
            this._joystickBackground.active = true;
        }

        if (this._joystickHandle) {
            this._joystickHandle.setPosition(Vec3.ZERO);
        }

        // 启动动画
        this.startAnimation();
    }

    /**
     * 组件禁用时调用
     */
    protected onDisable(): void {
        // 停止动画并清理
        this.stopAnimation();
        this._joystickBackground = null;
        this._joystickHandle = null;
    }

    /**
     * 启动摇杆动画
     */
    private startAnimation(): void {
        if (!this._joystickBackground || !this._joystickHandle) {
            console.error('Joystick Background or Handle is not assigned in StartUITutorial.');
            return;
        }

        this._isAnimating = true;
        this.playJoystickAnimation();
    }

    /**
     * 停止动画
     */
    private stopAnimation(): void {
        this._isAnimating = false;

        // 停止所有缓动动画
        if (this._joystickHandle) {
            tween(this._joystickHandle).stop();
        }
    }

    /**
     * 播放摇杆动画循环
     */
    private playJoystickAnimation(): void {
        if (!this._isAnimating || !this._joystickBackground || !this._joystickHandle) {
            return;
        }

        // 获取背景的UITransform以计算半径
        const bgTransform = this._joystickBackground.getComponent(UITransform);
        if (!bgTransform) {
            console.error('Joystick Background does not have UITransform component.');
            return;
        }

        // 动画半径设为背景半径的75%，避免碰到边缘
        const radius = bgTransform.width / 2 * 0.75;
        const animationDuration = 0.5; // 动画持续时间（秒）
        const pauseDuration = 0.5; // 暂停时间（秒）

        // 创建动画序列
        tween(this._joystickHandle)
            .call(() => {
                // 动画开始前，确保手柄在起始位置（右侧，0度）
                if (this._joystickHandle) {
                    this._joystickHandle.setPosition(radius, 0, 0);
                }
            })
            .to(animationDuration, {}, {
                onUpdate: (target: Node, ratio: number) => {
                    if (!this._joystickHandle) return;

                    // 角度从0到π/2 (90度)
                    const angle = ratio * Math.PI / 2;

                    // 根据角度和半径计算在圆上的位置
                    const x = Math.cos(angle) * radius;
                    const y = Math.sin(angle) * radius;

                    this._joystickHandle.setPosition(x, y, 0);
                }
            })
            .call(() => {
                // 动画结束后回到中心
                if (this._joystickHandle) {
                    this._joystickHandle.setPosition(Vec3.ZERO);
                }
            })
            .delay(pauseDuration) // 在中心停留
            .union() // 将所有动作组合成一个序列
            .repeatForever() // 无限循环
            .start();
    }
}
