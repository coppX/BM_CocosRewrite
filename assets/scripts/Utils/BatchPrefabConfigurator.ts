import { _decorator, Component, Node, resources, Prefab, instantiate } from 'cc';
import { AutoPrefabConfigurator } from './AutoPrefabConfigurator';
const { ccclass, property } = _decorator;

/**
 * 批量预制体配置工具
 * 用于自动配置所有预制体
 */
@ccclass('BatchPrefabConfigurator')
export class BatchPrefabConfigurator extends Component {

    /** 配置结果 */
    private _results: Map<string, boolean> = new Map();

    /**
     * 配置所有预制体
     */
    public async configureAllPrefabs() {
        console.log('==========================================');
        console.log('[BatchPrefabConfigurator] 开始批量配置预制体');
        console.log('==========================================');

        // 定义所有需要配置的预制体
        const prefabConfigs = [
            { path: 'prefabs/Zombie02', type: 'Zombie02' },
            { path: 'prefabs/Soldier', type: 'Soldier' },
            { path: 'prefabs/MachineGunTower', type: 'MachineGunTower' },
        ];

        for (const config of prefabConfigs) {
            await this.configurePrefab(config.path, config.type);
        }

        // 打印结果
        console.log('==========================================');
        console.log('[BatchPrefabConfigurator] 配置完成！结果汇总:');
        this._results.forEach((success, name) => {
            console.log(`  ${name}: ${success ? '✅成功' : '❌失败'}`);
        });
        console.log('==========================================');
    }

    /**
     * 配置单个预制体
     */
    private async configurePrefab(prefabPath: string, prefabType: string): Promise<void> {
        console.log(`\n--- 配置预制体: ${prefabType} ---`);

        return new Promise((resolve) => {
            resources.load(prefabPath, Prefab, async (err, prefab) => {
                if (err) {
                    console.error(`[BatchPrefabConfigurator] 加载预制体失败: ${prefabPath}`, err);
                    this._results.set(prefabType, false);
                    resolve();
                    return;
                }

                try {
                    // 实例化预制体
                    const instance = instantiate(prefab);

                    // 检查是否已有AutoPrefabConfigurator组件
                    let configurator = instance.getComponent(AutoPrefabConfigurator);
                    if (!configurator) {
                        // 添加配置组件
                        configurator = instance.addComponent(AutoPrefabConfigurator);
                        configurator.prefabType = prefabType;
                        configurator.autoConfigureOnStart = false; // 手动配置
                    }

                    // 执行配置
                    await configurator.configure();

                    console.log(`✅ ${prefabType} 配置成功`);
                    this._results.set(prefabType, true);

                    // 清理实例
                    instance.destroy();
                } catch (error) {
                    console.error(`[BatchPrefabConfigurator] 配置失败: ${prefabType}`, error);
                    this._results.set(prefabType, false);
                }

                resolve();
            });
        });
    }

    /**
     * 测试配置是否成功
     */
    public async testPrefabs() {
        console.log('\n==========================================');
        console.log('[BatchPrefabConfigurator] 开始测试预制体');
        console.log('==========================================\n');

        const prefabPaths = [
            'prefabs/Zombie02',
            'prefabs/Soldier',
            'prefabs/MachineGunTower',
        ];

        for (const path of prefabPaths) {
            await this.testPrefab(path);
        }
    }

    /**
     * 测试单个预制体
     */
    private async testPrefab(prefabPath: string): Promise<void> {
        return new Promise((resolve) => {
            resources.load(prefabPath, Prefab, (err, prefab) => {
                if (err) {
                    console.error(`❌ 测试失败 [${prefabPath}]: 加载失败`, err);
                    resolve();
                    return;
                }

                const instance = instantiate(prefab);

                // 检查网格渲染器
                const renderers = instance.getComponentsInChildren('cc.SkinnedMeshRenderer');
                if (renderers.length === 0) {
                    console.warn(`⚠️ 警告 [${prefabPath}]: 没有找到SkinnedMeshRenderer组件`);
                } else {
                    let hasConfig = false;
                    for (const renderer of renderers) {
                        if ((renderer as any).mesh && (renderer as any).material) {
                            hasConfig = true;
                            break;
                        }
                    }
                    if (hasConfig) {
                        console.log(`✅ 测试通过 [${prefabPath}]: 有配置的渲染器`);
                    } else {
                        console.log(`ℹ️ 提示 [${prefabPath}]: 渲染器未配置，需要运行时加载`);
                    }
                }

                // 检查AutoPrefabConfigurator组件
                const configurator = instance.getComponent(AutoPrefabConfigurator);
                if (configurator) {
                    console.log(`✅ 已添加 AutoPrefabConfigurator 组件`);
                } else {
                    console.log(`ℹ️ 未添加 AutoPrefabConfigurator 组件`);
                }

                instance.destroy();
                resolve();
            });
        });
    }
}
