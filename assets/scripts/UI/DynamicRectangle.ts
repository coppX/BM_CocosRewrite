import { _decorator, Component, MeshRenderer, utils, Vec3, Mesh, gfx } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 动态矩形组件
 * 根据起点和终点动态生成矩形网格
 */
@ccclass('DynamicRectangle')
export class DynamicRectangle extends Component {
    @property({
        tooltip: '长方形的起点'
    })
    public startPoint: Vec3 = Vec3.ZERO.clone();

    @property({
        tooltip: '长方形的终点'
    })
    public endPoint: Vec3 = new Vec3(0, 0, 5);

    @property({
        tooltip: '长方形的宽度'
    })
    public width: number = 1;

    private _meshRenderer: MeshRenderer | null = null;
    private _mesh: Mesh | null = null;
    private _lastStartPoint: Vec3 = new Vec3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    private _lastEndPoint: Vec3 = new Vec3();
    private _lastWidth: number = 0;

    protected onLoad(): void {
        this._meshRenderer = this.getComponent(MeshRenderer);
        if (!this._meshRenderer) {
            this._meshRenderer = this.addComponent(MeshRenderer);
        }

        // 创建新的Mesh
        this._mesh = utils.createMesh({
            positions: [],
            indices: [],
            primitiveMode: gfx.PrimitiveMode.TRIANGLE_LIST
        });

        this._meshRenderer.mesh = this._mesh;
    }

    protected update(dt: number): void {
        // 检查参数是否改变
        if (!this.startPoint.equals(this._lastStartPoint) ||
            !this.endPoint.equals(this._lastEndPoint) ||
            this.width !== this._lastWidth) {

            this.updateMesh();

            this._lastStartPoint = this.startPoint.clone();
            this._lastEndPoint = this.endPoint.clone();
            this._lastWidth = this.width;
        }
    }

    private updateMesh(): void {
        if (!this._mesh || !this._meshRenderer) return;

        // 如果起点和终点太近，清空mesh
        const distance = Vec3.distance(this.startPoint, this.endPoint);
        if (distance < 0.01) {
            // 重新创建一个空mesh
            this._mesh.destroy();
            this._mesh = utils.createMesh({
                positions: [],
                indices: [],
                primitiveMode: gfx.PrimitiveMode.TRIANGLE_LIST
            });
            this._meshRenderer.mesh = this._mesh;
            return;
        }

        // 计算方向向量
        const direction = this.endPoint.clone().subtract(this.startPoint).normalize();

        // 计算垂直方向（用于宽度）
        const sideDirection = new Vec3();
        Vec3.cross(sideDirection, direction, new Vec3(0, -1, 0));
        sideDirection.normalize();

        const halfWidth = this.width / 2;

        // 计算4个顶点
        const v0 = this.startPoint.clone().subtract(sideDirection.clone().multiplyScalar(halfWidth));
        const v1 = this.startPoint.clone().add(sideDirection.clone().multiplyScalar(halfWidth));
        const v2 = this.endPoint.clone().subtract(sideDirection.clone().multiplyScalar(halfWidth));
        const v3 = this.endPoint.clone().add(sideDirection.clone().multiplyScalar(halfWidth));

        const positions = [
            v0.x, v0.y, v0.z,
            v1.x, v1.y, v1.z,
            v2.x, v2.y, v2.z,
            v3.x, v3.y, v3.z
        ];

        const indices = [0, 2, 1, 1, 2, 3];

        const uvs = [
            0, 0,
            1, 0,
            0, distance,
            1, distance
        ];

        // 计算法线
        const normal = new Vec3();
        Vec3.cross(normal, sideDirection, direction);
        normal.normalize();

        const normals = [
            normal.x, normal.y, normal.z,
            normal.x, normal.y, normal.z,
            normal.x, normal.y, normal.z,
            normal.x, normal.y, normal.z
        ];

        // 计算包围盒
        const minPos = new Vec3(
            Math.min(v0.x, v1.x, v2.x, v3.x),
            Math.min(v0.y, v1.y, v2.y, v3.y),
            Math.min(v0.z, v1.z, v2.z, v3.z)
        );
        const maxPos = new Vec3(
            Math.max(v0.x, v1.x, v2.x, v3.x),
            Math.max(v0.y, v1.y, v2.y, v3.y),
            Math.max(v0.z, v1.z, v2.z, v3.z)
        );

        // 销毁旧mesh并创建新的
        this._mesh.destroy();
        this._mesh = utils.createMesh({
            positions: positions,
            indices: indices,
            uvs: uvs,
            normals: normals,
            minPos: minPos,
            maxPos: maxPos,
            primitiveMode: gfx.PrimitiveMode.TRIANGLE_LIST
        });

        this._meshRenderer.mesh = this._mesh;
    }

    protected onDestroy(): void {
        if (this._mesh) {
            this._mesh.destroy();
        }
    }
}
