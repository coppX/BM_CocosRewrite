import { _decorator, Component, Node, resources, Mesh, Texture2D, Material, MeshRenderer, SkinnedMeshRenderer, utils } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 自动预制体配置器
 * 在预制体加载时自动配置mesh和材质
 */
@ccclass('AutoPrefabConfigurator')
export class AutoPrefabConfigurator extends Component {

    /** 预制体类型 */
    @property
    public prefabType: string = '';

    /** 是否在start时自动配置 */
    @property
    public autoConfigureOnStart: boolean = true;

    private _configured: boolean = false;

    protected start() {
        if (this.autoConfigureOnStart && !this._configured) {
            this.configure();
        }
    }

    /**
     * 配置预制体
     */
    public async configure() {
        if (this._configured) {
            console.warn(`[AutoPrefabConfigurator] ${this.node.name} 已经配置过了`);
            return;
        }

        console.log(`[AutoPrefabConfigurator] 开始配置预制体: ${this.prefabType}`);

        switch (this.prefabType) {
            case 'Zombie02':
                await this.configureZombie02();
                break;
            case 'Soldier':
                await this.configureSoldier();
                break;
            case 'MachineGunTower':
                await this.configureMachineGunTower();
                break;
            case 'BowTower':
                await this.configureBowTower();
                break;
            case 'Coin':
                await this.configureCoin();
                break;
            default:
                console.warn(`[AutoPrefabConfigurator] 未知的预制体类型: ${this.prefabType}`);
                return;
        }

        this._configured = true;
        console.log(`[AutoPrefabConfigurator] 配置完成: ${this.prefabType}`);
    }

    /**
     * 配置Zombie02预制体
     */
    private async configureZombie02() {
        // 找到骨骼网格节点
        const meshNode = this.node.getChildByPath('Geometry/SK_BM_Zombie_001');
        if (!meshNode) {
            console.error('[AutoPrefabConfigurator] 找不到Zombie02的网格节点');
            return;
        }

        // 加载资源
        const meshAsset = await this.loadMesh('models/enemy/丧尸男02_skin');
        const texture = await this.loadTexture('textures/T_Zombie_02_D');

        if (!meshAsset || !texture) {
            console.error('[AutoPrefabConfigurator] Zombie02资源加载失败');
            return;
        }

        // 配置渲染器
        const renderer = meshNode.getComponent(SkinnedMeshRenderer);
        if (renderer) {
            // 设置mesh
            renderer.mesh = meshAsset.mesh;

            // 创建材质
            const material = await this.CreateStandardMaterial(texture, {
                metallic: 0,
                roughness: 0.8
            });

            // 设置材质
            renderer.material = material;
        }
    }

    /**
     * 配置Soldier预制体
     */
    private async configureSoldier() {
        const meshNode = this.node.getChildByPath('SoldierModel');
        if (!meshNode) {
            console.error('[AutoPrefabConfigurator] 找不到Soldier的网格节点');
            return;
        }

        const meshAsset = await this.loadMesh('models/props/士兵优化_LOD_跑');
        const texture = await this.loadTexture('textures/T_Shibing_BC');

        if (!meshAsset || !texture) {
            console.error('[AutoPrefabConfigurator] Soldier资源加载失败');
            return;
        }

        const renderer = meshNode.getComponent(SkinnedMeshRenderer);
        if (renderer) {
            renderer.mesh = meshAsset.mesh;
            const material = await this.CreateStandardMaterial(texture, {
                metallic: 0,
                roughness: 0.7
            });
            renderer.material = material;
        }
    }

    /**
     * 配置MachineGunTower预制体
     */
    private async configureMachineGunTower() {
        const meshNode = this.node.getChildByPath('Geometry/CB_zhubao04_pao');
        if (!meshNode) {
            console.error('[AutoPrefabConfigurator] 找不到MachineGunTower的网格节点');
            return;
        }

        const meshAsset = await this.loadMesh('models/environment/三铳机炮_skin');

        if (!meshAsset) {
            console.error('[AutoPrefabConfigurator] MachineGunTower资源加载失败');
            return;
        }

        const renderer = meshNode.getComponent(SkinnedMeshRenderer);
        if (renderer) {
            renderer.mesh = meshAsset.mesh;
            const material = await this.CreateStandardMaterial(null, {
                metallic: 0.5,
                roughness: 0.5,
                color: { r: 0.7, g: 0.7, b: 0.7, a: 1 }
            });
            renderer.material = material;
        }
    }

    /**
     * 配置BowTower预制体
     */
    private async configureBowTower() {
        const meshNode = this.node.getChildByPath('Geometry/BowTowerModel');
        if (!meshNode) {
            console.error('[AutoPrefabConfigurator] 找不到BowTower的网格节点');
            return;
        }

        const meshAsset = await this.loadMesh('models/environment/弩箭塔_skin');

        if (!meshAsset) {
            console.error('[AutoPrefabConfigurator] BowTower资源加载失败');
            return;
        }

        const renderer = meshNode.getComponent(SkinnedMeshRenderer);
        if (renderer) {
            renderer.mesh = meshAsset.mesh;
            const material = await this.CreateStandardMaterial(null, {
                metallic: 0.5,
                roughness: 0.5,
                color: { r: 0.6, g: 0.5, b: 0.4, a: 1 }
            });
            renderer.material = material;
        }
    }

    /**
     * 配置Coin预制体
     */
    private async configureCoin() {
        // 金币使用内置球体mesh，只需要配置材质
        const renderer = this.node.getComponent(MeshRenderer);
        if (renderer) {
            // 金色发光材质
            const material = await this.CreateStandardMaterial(null, {
                metallic: 1.0,
                roughness: 0.2,
                color: { r: 1.0, g: 0.843, b: 0.0, a: 1 }
            });
            renderer.material = material;
        }
    }

    /**
     * 加载网格资源
     */
    private loadMesh(path: string): Promise<any> {
        return new Promise((resolve, reject) => {
            resources.load(path, (err, asset) => {
                if (err) {
                    console.error(`[AutoPrefabConfigurator] 加载网格失败: ${path}`, err);
                    resolve(null);
                } else {
                    console.log(`[AutoPrefabConfigurator] 加载网格成功: ${path}`);
                    resolve(asset);
                }
            });
        });
    }

    /**
     * 加载贴图资源
     */
    private loadTexture(path: string): Promise<Texture2D> {
        return new Promise((resolve, reject) => {
            resources.load(path, Texture2D, (err, texture) => {
                if (err) {
                    console.error(`[AutoPrefabConfigurator] 加载贴图失败: ${path}`, err);
                    resolve(null);
                } else {
                    console.log(`[AutoPrefabConfigurator] 加载贴图成功: ${path}`);
                    resolve(texture);
                }
            });
        });
    }

    /**
     * 创建标准PBR材质
     */
    private async CreateStandardMaterial(
        albedoTexture: Texture2D | null,
        options: {
            metallic?: number,
            roughness?: number,
            color?: { r: number, g: number, b: number, a: number }
        } = {}
    ): Promise<Material> {
        const material = new Material();
        material.initialize({
            effectName: 'builtin-standard',
        });

        // 设置颜色
        if (options.color) {
            material.setProperty('albedo', [
                options.color.r,
                options.color.g,
                options.color.b,
                options.color.a
            ]);
        } else {
            material.setProperty('albedo', [1, 1, 1, 1]);
        }

        // 设置贴图
        if (albedoTexture) {
            material.setProperty('albedoMap', albedoTexture);
        }

        // 设置金属度和粗糙度
        if (options.metallic !== undefined) {
            material.setProperty('metallic', options.metallic);
        }
        if (options.roughness !== undefined) {
            material.setProperty('roughness', options.roughness);
        }

        return material;
    }
}
