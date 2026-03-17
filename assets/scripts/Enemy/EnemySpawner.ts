import { _decorator, Component, Node, Prefab, instantiate, Vec3 } from 'cc';
import { GameManager, GameState } from '../Managers/GameManager';
const { ccclass, property } = _decorator;

/**
 * 敌人生成器
 */
@ccclass('EnemySpawner')
export class EnemySpawner extends Component {
    @property([Prefab])
    public enemyPrefabs: Prefab[] = [];

    @property
    public spawnInterval: number = 2;

    @property
    public maxEnemies: number = 10;

    @property
    public autoStart: boolean = true;

    private _spawnTimer: number = 0;
    private _spawnedEnemies: Node[] = [];

    protected start(): void {
        if (this.autoStart) {
            this.StartSpawning();
        }
    }

    protected update(dt: number): void {
        if (!GameManager.Instance || GameManager.Instance.CurrentState !== GameState.Playing) {
            return;
        }

        if (this._spawnedEnemies.length >= this.maxEnemies) {
            return;
        }

        this._spawnTimer += dt;
        if (this._spawnTimer >= this.spawnInterval) {
            this._spawnTimer = 0;
            this.SpawnEnemy();
        }
    }

    public StartSpawning(): void {
        this._spawnTimer = 0;
    }

    public StopSpawning(): void {
        this._spawnTimer = 0;
    }

    private SpawnEnemy(): void {
        if (this.enemyPrefabs.length === 0) return;

        // 随机选择一个敌人预制体
        const randomIndex = Math.floor(Math.random() * this.enemyPrefabs.length);
        const prefab = this.enemyPrefabs[randomIndex];

        if (!prefab) return;

        // 实例化敌人
        const enemy = instantiate(prefab);
        enemy.setPosition(this.node.getPosition());
        enemy.setParent(this.node.scene);

        this._spawnedEnemies.push(enemy);

        // TODO: 设置敌人的贝塞尔曲线路径
    }

    public ClearAllEnemies(): void {
        this._spawnedEnemies.forEach(enemy => {
            if (enemy && enemy.isValid) {
                enemy.destroy();
            }
        });
        this._spawnedEnemies = [];
    }
}
