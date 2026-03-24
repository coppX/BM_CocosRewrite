import { _decorator, Component, Vec3, math, Node, MeshRenderer, Mesh, Material, utils, gfx } from 'cc';
const { ccclass, property, executeInEditMode } = _decorator;

/**
 * 贝塞尔曲线组件
 */
@ccclass('BezierCurve')
@executeInEditMode
export class BezierCurve extends Component {
    private static readonly RENDER_NODE_NAME = '__BezierCurve3DRenderer';

    @property([Node])
    public controlPoints: Node[] = [];

    @property
    public showCurve: boolean = true;

    @property
    public segments: number = 40;

    @property
    public lineWidth: number = 0.15;

    @property(Material)
    public lineMaterial: Material | null = null;

    @property
    public upAxis: Vec3 = new Vec3(0, 1, 0);

    private _renderNode: Node | null = null;
    private _meshRenderer: MeshRenderer | null = null;
    private _mesh: Mesh | null = null;

    protected onEnable(): void {
        this.ensureMeshRenderer();
        this.redraw();
    }

    protected onDisable(): void {
        this.clear();
    }

    protected update(): void {
        if (!this.showCurve) {
            this.clear();
            return;
        }
        this.redraw();
    }

    /**
     * 根据t值(0-1)获取曲线上的点
     */
    public getPoint(t: number): Vec3 {
        t = math.clamp01(t);
        const points = this.getLocalControlPoints();

        if (points.length === 0) {
            return new Vec3();
        }

        if (points.length === 1) {
            return points[0].clone();
        }

        return this.evaluateBezier(points, t);
    }

    public getWorldPoint(t: number): Vec3 {
        const localPoint = this.getPoint(t);
        return Vec3.transformMat4(new Vec3(), localPoint, this.node.worldMatrix);
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

    protected onDestroy(): void {
        if (this._mesh) {
            this._mesh.destroy();
            this._mesh = null;
        }

        if (this._renderNode && this._renderNode.isValid) {
            this._renderNode.destroy();
            this._renderNode = null;
        }
    }

    private ensureMeshRenderer(): MeshRenderer {
        if (this._meshRenderer && this._meshRenderer.isValid) {
            return this._meshRenderer;
        }

        this._renderNode = this.node.getChildByName(BezierCurve.RENDER_NODE_NAME);
        if (!this._renderNode || !this._renderNode.isValid) {
            this._renderNode = new Node(BezierCurve.RENDER_NODE_NAME);
            this._renderNode.parent = this.node;
        }

        this._renderNode.setPosition(0, 0, 0);
        this._renderNode.setRotationFromEuler(0, 0, 0);
        this._renderNode.setScale(1, 1, 1);
        this._renderNode.layer = this.node.layer;

        this._meshRenderer = this._renderNode.getComponent(MeshRenderer) ?? this._renderNode.addComponent(MeshRenderer);
        return this._meshRenderer;
    }

    private clear(): void {
        const renderer = this.ensureMeshRenderer();
        renderer.mesh = null;

        if (this._mesh) {
            this._mesh.destroy();
            this._mesh = null;
        }
    }

    private redraw(): void {
        const points = this.getLocalControlPoints();
        if (points.length < 2) {
            this.clear();
            return;
        }

        const sampledPoints: Vec3[] = [];
        const segmentCount = Math.max(2, Math.floor(this.segments));
        for (let i = 0; i <= segmentCount; i++) {
            const t = i / segmentCount;
            sampledPoints.push(this.evaluateBezier(points, t));
        }

        this.rebuildMesh(sampledPoints, Math.max(0.001, this.lineWidth));
    }

    private rebuildMesh(pathPoints: ReadonlyArray<Vec3>, width: number): void {
        const renderer = this.ensureMeshRenderer();
        if (pathPoints.length < 2) {
            renderer.mesh = null;
            return;
        }

        const halfWidth = width * 0.5;
        const up = this.upAxis.clone();
        if (up.lengthSqr() < 1e-6) {
            up.set(Vec3.UNIT_Y);
        }
        up.normalize();

        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];

        const minPos = new Vec3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        const maxPos = new Vec3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

        const dir = new Vec3();
        const side = new Vec3();
        const normal = new Vec3();
        const offset = new Vec3();
        const fallbackAxis = new Vec3(1, 0, 0);

        let uvY = 0;
        for (let i = 0; i < pathPoints.length - 1; i++) {
            const p0 = pathPoints[i];
            const p1 = pathPoints[i + 1];
            Vec3.subtract(dir, p1, p0);
            const len = dir.length();
            if (len < 1e-6) {
                continue;
            }
            dir.multiplyScalar(1 / len);

            Vec3.cross(side, dir, up);
            if (side.lengthSqr() < 1e-6) {
                Vec3.cross(side, dir, fallbackAxis);
            }
            side.normalize();
            side.multiplyScalar(halfWidth);

            Vec3.cross(normal, side, dir);
            if (normal.lengthSqr() < 1e-6) {
                normal.set(up);
            } else {
                normal.normalize();
            }

            Vec3.copy(offset, side);

            const v0 = new Vec3(p0.x - offset.x, p0.y - offset.y, p0.z - offset.z);
            const v1 = new Vec3(p0.x + offset.x, p0.y + offset.y, p0.z + offset.z);
            const v2 = new Vec3(p1.x - offset.x, p1.y - offset.y, p1.z - offset.z);
            const v3 = new Vec3(p1.x + offset.x, p1.y + offset.y, p1.z + offset.z);

            const base = positions.length / 3;

            positions.push(
                v0.x, v0.y, v0.z,
                v1.x, v1.y, v1.z,
                v2.x, v2.y, v2.z,
                v3.x, v3.y, v3.z
            );

            for (let n = 0; n < 4; n++) {
                normals.push(normal.x, normal.y, normal.z);
            }

            const nextUvY = uvY + len;
            uvs.push(
                0, uvY,
                1, uvY,
                0, nextUvY,
                1, nextUvY
            );
            uvY = nextUvY;

            indices.push(
                base + 0, base + 2, base + 1,
                base + 1, base + 2, base + 3,
                base + 1, base + 2, base + 0,
                base + 3, base + 2, base + 1
            );

            this.expandBounds(minPos, maxPos, v0);
            this.expandBounds(minPos, maxPos, v1);
            this.expandBounds(minPos, maxPos, v2);
            this.expandBounds(minPos, maxPos, v3);
        }

        if (indices.length === 0) {
            renderer.mesh = null;
            return;
        }

        if (this._mesh) {
            this._mesh.destroy();
            this._mesh = null;
        }

        this._mesh = utils.createMesh({
            positions,
            normals,
            uvs,
            indices,
            minPos,
            maxPos,
            primitiveMode: gfx.PrimitiveMode.TRIANGLE_LIST,
        });

        renderer.mesh = this._mesh;
        if (this.lineMaterial) {
            renderer.setSharedMaterial(this.lineMaterial, 0);
        }
    }

    private expandBounds(minPos: Vec3, maxPos: Vec3, point: Vec3): void {
        minPos.x = Math.min(minPos.x, point.x);
        minPos.y = Math.min(minPos.y, point.y);
        minPos.z = Math.min(minPos.z, point.z);

        maxPos.x = Math.max(maxPos.x, point.x);
        maxPos.y = Math.max(maxPos.y, point.y);
        maxPos.z = Math.max(maxPos.z, point.z);
    }

    private getLocalControlPoints(): Vec3[] {
        const points: Vec3[] = [];
        for (const controlPoint of this.controlPoints) {
            if (!controlPoint || !controlPoint.isValid) {
                continue;
            }
            const localPoint = this.node.inverseTransformPoint(new Vec3(), controlPoint.worldPosition);
            points.push(localPoint);
        }
        return points;
    }

    private evaluateBezier(sourcePoints: ReadonlyArray<Vec3>, t: number): Vec3 {
        const workPoints = sourcePoints.map((p) => p.clone());
        while (workPoints.length > 1) {
            for (let i = 0; i < workPoints.length - 1; i++) {
                Vec3.lerp(workPoints[i], workPoints[i], workPoints[i + 1], t);
            }
            workPoints.pop();
        }
        return workPoints[0];
    }
}
