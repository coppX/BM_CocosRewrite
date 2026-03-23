import { _decorator, Component, Vec3, MeshRenderer, utils, Mesh, gfx, Material } from 'cc';
const { ccclass, property, executeInEditMode } = _decorator;

/**
 * 动态矩形网格组件
 * 类似Unity的Dynamic Rectangle Mesh
 */
@ccclass('DynamicRectangleMesh')
@executeInEditMode
export class DynamicRectangleMesh extends Component {
    @property({
        tooltip: '矩形的起点'
    })
    public startPoint: Vec3 = new Vec3(0, 0, 0);

    @property({
        tooltip: '矩形的终点'
    })
    public endPoint: Vec3 = new Vec3(0, 0, 5);

    @property({
        tooltip: '矩形的宽度'
    })
    public width: number = 1.0;

    @property(Material)
    public material: Material | null = null;

    private _meshRenderer: MeshRenderer | null = null;
    private _mesh: Mesh | null = null;

    // 用于性能优化：只在参数变化时才更新mesh
    private _lastStartPoint: Vec3 = new Vec3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    private _lastEndPoint: Vec3 = new Vec3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    private _lastWidth: number = -1;
    private _lastMaterial: Material | null = null;

    protected onLoad(): void {
        // 获取或添加 MeshRenderer 组件
        this._meshRenderer = this.node.getComponent(MeshRenderer);
        if (!this._meshRenderer) {
            this._meshRenderer = this.node.addComponent(MeshRenderer);
        }
    }

    protected start(): void {
        // 第一次更新mesh
        this.updateMesh();
    }

    protected update(dt: number): void {
        // 性能优化：检查参数是否已更改
        const needUpdate = !this.startPoint.equals(this._lastStartPoint) ||
            !this.endPoint.equals(this._lastEndPoint) ||
            this.width !== this._lastWidth;

        const materialChanged = this.material !== this._lastMaterial;

        if (needUpdate) {
            this.updateMesh();

            // 更新 "last" 变量
            this._lastStartPoint.set(this.startPoint);
            this._lastEndPoint.set(this.endPoint);
            this._lastWidth = this.width;
        }

        // 检查材质是否改变（即使mesh没变也要更新材质）
        if (materialChanged) {
            if (this._meshRenderer && this.material) {
                this._meshRenderer.setSharedMaterial(this.material, 0);
            }
            this._lastMaterial = this.material;
        }
    }

    private updateMesh(): void {
        if (!this._meshRenderer) {
            return;
        }

        // 如果起点和终点太近，则清空mesh，避免计算错误
        const distance = Vec3.distance(this.startPoint, this.endPoint);
        if (distance < 0.01) {
            if (this._mesh) {
                this._mesh.destroy();
                this._mesh = null;
            }
            this._meshRenderer.mesh = null;
            return;
        }

        // 计算从起点到终点的方向向量
        const direction = new Vec3();
        Vec3.subtract(direction, this.endPoint, this.startPoint);
        direction.normalize();

        // 计算垂直于方向向量的向量（用于确定宽度）
        const sideDirection = new Vec3();
        Vec3.cross(sideDirection, direction, Vec3.UNIT_Y);
        sideDirection.normalize();

        const halfWidth = this.width / 2;

        // 计算4个顶点
        const temp = new Vec3();

        // v0: 起点左侧
        Vec3.multiplyScalar(temp, sideDirection, -halfWidth);
        const v0 = new Vec3();
        Vec3.add(v0, this.startPoint, temp);

        // v1: 起点右侧
        Vec3.multiplyScalar(temp, sideDirection, halfWidth);
        const v1 = new Vec3();
        Vec3.add(v1, this.startPoint, temp);

        // v2: 终点左侧
        Vec3.multiplyScalar(temp, sideDirection, -halfWidth);
        const v2 = new Vec3();
        Vec3.add(v2, this.endPoint, temp);

        // v3: 终点右侧
        Vec3.multiplyScalar(temp, sideDirection, halfWidth);
        const v3 = new Vec3();
        Vec3.add(v3, this.endPoint, temp);

        // 顶点位置
        const positions = [
            v0.x, v0.y, v0.z,
            v1.x, v1.y, v1.z,
            v2.x, v2.y, v2.z,
            v3.x, v3.y, v3.z
        ];

        // 三角形索引
        const indices = [
            0, 2, 1,  // 第一个三角形
            1, 2, 3   // 第二个三角形
        ];

        // UV 坐标
        const uvs = [
            0, 0,           // v0
            1, 0,           // v1
            0, distance,    // v2
            1, distance     // v3
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
        if (this._mesh) {
            this._mesh.destroy();
        }

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

        // 设置材质
        if (this.material) {
            this._meshRenderer.setSharedMaterial(this.material, 0);
        }
    }

    /**
     * 设置起点和终点
     */
    public setPoints(start: Vec3, end: Vec3): void {
        this.startPoint.set(start);
        this.endPoint.set(end);
    }

    /**
     * 设置宽度
     */
    public setWidth(width: number): void {
        this.width = width;
    }

    /**
     * 手动强制更新mesh
     */
    public forceUpdateMesh(): void {
        this.updateMesh();
    }

    protected onDestroy(): void {
        if (this._mesh) {
            this._mesh.destroy();
            this._mesh = null;
        }
    }
}
