import { _decorator, Component, Vec3, Quat, math } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 贝塞尔曲线组件
 */
@ccclass('BezierCurve')
export class BezierCurve extends Component {
    @property([Vec3])
    public controlPoints: Vec3[] = [];

    /**
     * 根据t值(0-1)获取曲线上的点
     */
    public getPoint(t: number): Vec3 {
        t = math.clamp01(t);

        if (this.controlPoints.length < 2) {
            return new Vec3();
        }

        if (this.controlPoints.length === 2) {
            // Linear interpolation
            return Vec3.lerp(new Vec3(), this.controlPoints[0], this.controlPoints[1], t);
        }

        if (this.controlPoints.length === 3) {
            // Quadratic Bezier
            const t2 = 1 - t;
            return new Vec3(
                t2 * t2 * this.controlPoints[0].x + 2 * t2 * t * this.controlPoints[1].x + t * t * this.controlPoints[2].x,
                t2 * t2 * this.controlPoints[0].y + 2 * t2 * t * this.controlPoints[1].y + t * t * this.controlPoints[2].y,
                t2 * t2 * this.controlPoints[0].z + 2 * t2 * t * this.controlPoints[1].z + t * t * this.controlPoints[2].z
            );
        }

        // Cubic Bezier or higher order - use De Casteljau's algorithm
        let points = [...this.controlPoints];
        while (points.length > 1) {
            const newPoints: Vec3[] = [];
            for (let i = 0; i < points.length - 1; i++) {
                newPoints.push(Vec3.lerp(new Vec3(), points[i], points[i + 1], t));
            }
            points = newPoints;
        }
        return points[0];
    }

    /**
     * 获取最接近给定位置的t值
     */
    public getClosestT(position: Vec3): number {
        let closestT = 0;
        let minDistance = Infinity;
        const samples = 50;

        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const point = this.getPoint(t);
            const distance = Vec3.distance(point, position);

            if (distance < minDistance) {
                minDistance = distance;
                closestT = t;
            }
        }

        return closestT;
    }

    /**
     * 获取曲线长度(近似值)
     */
    public getLength(steps: number = 50): number {
        let length = 0;
        let prevPoint = this.getPoint(0);

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const point = this.getPoint(t);
            length += Vec3.distance(prevPoint, point);
            prevPoint = point;
        }

        return length;
    }
}
