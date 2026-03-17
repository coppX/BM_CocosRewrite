import { _decorator, Component, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 绕轴旋转组件
 * 支持可变速度的旋转动画
 */
@ccclass('RotateAroundAxis')
export class RotateAroundAxis extends Component {
    @property
    public rotateX: boolean = false;

    @property
    public rotateY: boolean = false;

    @property
    public rotateZ: boolean = false;

    @property({
        range: [0.1, 10, 0.1],
        tooltip: '完成一个周期(一圈)所需的时间'
    })
    public cycleTime: number = 2;

    @property({
        range: [0, 1, 0.01],
        tooltip: '控制贝塞尔曲线的形状，值越大，变速效果越明显'
    })
    public easingFactor: number = 0.3;

    private _baseAngleX: number = 0;
    private _baseAngleY: number = 0;
    private _baseAngleZ: number = 0;
    private _timeInCycle: number = 0;
    private _initialRotation: Vec3 = new Vec3();

    protected start(): void {
        // 保存物体的初始旋转
        const euler = new Vec3();
        this.node.getRotation().getEulerAngles(euler);
        this._initialRotation = euler;
    }

    protected update(dt: number): void {
        // 更新周期内的时间
        this._timeInCycle += dt;
        if (this._timeInCycle > this.cycleTime) {
            this._timeInCycle -= this.cycleTime;

            // 每完成一个周期，更新基础角度
            if (this.rotateX) this._baseAngleX += 360;
            if (this.rotateY) this._baseAngleY += 360;
            if (this.rotateZ) this._baseAngleZ += 360;
        }

        // 计算当前周期的完成比例 (0 到 1)
        const t = this._timeInCycle / this.cycleTime;

        // 使用缓动函数计算当前时刻应该转过的角度比例
        const angleProgress = this.calculateBezierPosition(t);

        // 计算当前时刻应该达到的角度
        const currentAngleX = this._baseAngleX + (this.rotateX ? angleProgress * 360 : 0);
        const currentAngleY = this._baseAngleY + (this.rotateY ? angleProgress * 360 : 0);
        const currentAngleZ = this._baseAngleZ + (this.rotateZ ? angleProgress * 360 : 0);

        // 设置物体的旋转，并加上初始旋转
        const euler = this.node.eulerAngles;
        this.node.setRotationFromEuler(
            this.rotateX ? this._initialRotation.x + currentAngleX : euler.x,
            this.rotateY ? this._initialRotation.y + currentAngleY : euler.y,
            this.rotateZ ? this._initialRotation.z + currentAngleZ : euler.z
        );
    }

    /**
     * 缓动函数，根据时间比例计算应该转动的角度比例
     */
    private calculateBezierPosition(t: number): number {
        // 使用简单的缓动方程，确保在t=0和t=1时角速度为0
        // 使用正弦函数的变种来创建平滑的S形曲线
        return (1 - Math.cos(t * Math.PI)) / 2;
    }
}
