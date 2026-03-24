import { _decorator, Component, Vec3, Quat, math } from 'cc';
import { BezierCurve } from './BezierCurve';
import { GameManager, GameState } from '../Managers/GameManager';
const { ccclass, property } = _decorator;

/**
 * 贝塞尔曲线跟随器
 */
@ccclass('BezierFollower')
export class BezierFollower extends Component {
    @property(BezierCurve)
    public curve: BezierCurve | null = null;

    @property
    public speed: number = 2;

    @property({ range: [0, 1], slide: true })
    public t: number = 0;

    @property
    public autoStart: boolean = true;

    @property
    public speedMultiplier: number = 1;

    private _moving: boolean = false;

    protected start(): void {
        if (!this.curve) return;

        // 自动找到最近的t
        this.t = this.curve.getClosestT(this.node.getPosition());
        this.node.setPosition(this.curve.getPoint(this.t));

        if (this.autoStart) {
            this._moving = true;
        }
    }

    protected update(dt: number): void {
        if (!this._moving || !this.curve) return;
        if (GameManager.Instance && GameManager.Instance.CurrentState !== GameState.Playing) return;

        // 计算曲线总长度
        const totalLength = this.getCurveLength();
        if (totalLength <= Number.EPSILON) {
            this.t = 1;
            this._moving = false;
            return;
        }

        // 计算本帧要移动的距离
        const distanceToMove = this.speed * this.speedMultiplier * dt;
        let remainingDistance = distanceToMove;

        while (remainingDistance > 0) {
            const stepT = remainingDistance / totalLength;
            const nextT = Math.min(this.t + stepT, 1);
            const currentPos = this.curve.getPoint(this.t);
            const nextPos = this.curve.getPoint(nextT);
            const segmentLength = Vec3.distance(currentPos, nextPos);

            if (segmentLength <= Number.EPSILON) {
                this.t = nextT;
                break;
            }

            if (segmentLength <= remainingDistance) {
                remainingDistance -= segmentLength;
                this.t = nextT;
            } else {
                this.t += (remainingDistance / segmentLength) * (nextT - this.t);
                remainingDistance = 0;
            }

            if (this.t >= 1) {
                this.t = 1;
                this._moving = false;
                break;
            }
        }

        // 更新位置
        const pos = this.curve.getPoint(this.t);
        this.node.setPosition(pos);

        // 设置朝向
        const lookAheadT = Math.min(this.t + 0.01, 1);
        const lookAheadPos = this.curve.getPoint(lookAheadT);
        const dir = Vec3.subtract(new Vec3(), lookAheadPos, pos);

        if (dir.lengthSqr() > 0.0001) {
            dir.normalize();
            const rotation = new Quat();
            Quat.fromViewUp(rotation, dir);
            this.node.setRotation(rotation);
        }
    }

    public startMove(): void {
        this._moving = true;
    }

    public stopMove(): void {
        this._moving = false;
    }

    protected onDisable(): void {
        this._moving = false;
        this.t = 0;
    }

    /**
     * 近似计算曲线长度
     */
    private getCurveLength(steps: number = 50): number {
        if (!this.curve) return 0;
        return this.curve.getLength(steps);
    }

    /**
     * 设置初始位置
     */
    public setInitialPosition(position: Vec3): void {
        if (!this.curve) return;
        this.t = this.curve.getClosestT(position);
        this.node.setPosition(this.curve.getPoint(this.t));
    }
}
