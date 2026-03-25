import { _decorator, Component, Node, Prefab, instantiate, Vec3, Enum } from 'cc';
import { GameManager, GameState, GameStateValue } from '../Managers/GameManager';
import { BezierCurve } from '../Utils/BezierCurve';
import { BezierFollower } from '../Utils/BezierFollower';
import { GlobalVariables, Stage } from '../Core/GlobalVariables';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
const { ccclass, property } = _decorator;
const StageEnum = Enum(GlobalVariables.Stage);

/**
 * 敌人单位配置
 */
@ccclass('EnemyUnitConfig')
export class EnemyUnitConfig {
    @property(Prefab)
    public prefab: Prefab | null = null;

    @property
    public count: number = 1;
}

/**
 * 敌人生成波次配置
 */
@ccclass('SpawnWave')
export class SpawnWave {
    @property
    public waveName: string = '';

    @property([EnemyUnitConfig])
    public enemyUnits: EnemyUnitConfig[] = [];

    @property({ type: StageEnum, tooltip: '激活此波次的游戏阶段' })
    public activeStage: Stage = GlobalVariables.Stage.Basic;

    @property({ tooltip: '组内生成间隔（秒）' })
    public spawnIntervalInGroup: number = 0.5;

    @property({ tooltip: '组间等待时间（秒）' })
    public intervalBetweenGroups: number = 1.5;
}

/**
 * 敌人生成器
 */
@ccclass('EnemySpawner')
export class EnemySpawner extends Component {
    @property({ tooltip: '所有可用的波次配置' })
    @property([SpawnWave])
    public spawnWaves: SpawnWave[] = [];

    @property({ tooltip: '每组生成的敌人数量' })
    public enemiesPerGroup: number = 5;

    @property({ type: StageEnum, tooltip: '当前游戏阶段' })
    public currentStage: Stage = GlobalVariables.Stage.Basic;

    @property(BezierCurve)
    public bezierCurve: BezierCurve | null = null;

    @property
    public speedMultiplier: number = 1;

    @property
    public autoStart: boolean = true;

    private _isSpawning: boolean = false;
    private _activeWave: SpawnWave | null = null;
    private _currentWaveSpawnQueue: Prefab[] = [];
    private _spawnedInWaveCount: number = 0;
    private _nextSpawnTime: number = 0;

    protected start(): void {
        if (this.autoStart && GameManager.Instance?.CurrentState === GameState.Playing) {
            this.startSpawning();
        }
    }

    protected onEnable(): void {
        // 监听游戏状态变化
        if (GameManager.Instance) {
            GameManager.Instance.addGameStateChangedListener(this.onGameStateChanged);
        }
        // 监听地图升级事件
        EventCenter.Instance?.AddEventListener(EventName.MapLevelUpgrade, this.onMapLevelUpgrade);
    }

    protected onDisable(): void {
        this.stopSpawning();
        if (GameManager.Instance) {
            GameManager.Instance.removeGameStateChangedListener(this.onGameStateChanged);
        }
        // 移除地图升级事件监听
        EventCenter.Instance?.RemoveEventListener(EventName.MapLevelUpgrade, this.onMapLevelUpgrade);
    }

    protected update(dt: number): void {
        if (!this._isSpawning || !GameManager.Instance || GameManager.Instance.CurrentState !== GameState.Playing) {
            return;
        }

        if (!this._activeWave || this._currentWaveSpawnQueue.length === 0) {
            return;
        }

        this._nextSpawnTime -= dt;
        if (this._nextSpawnTime <= 0) {
            this.spawnNextEnemy();
        }
    }

    /**
     * 游戏状态变化回调
     */
    private onGameStateChanged = (newState: GameStateValue): void => {
        if (newState === GameState.Playing) {
            this.startSpawning();
        } else {
            this.stopSpawning();
        }
    };

    /**
     * 地图升级回调
     */
    private onMapLevelUpgrade(stage: Stage): void {
        this.currentStage = stage;
        this.buildCurrentWaveSpawnQueue();
        // TODO: 根据阶段调整其他属性（如掉落率、伤害倍率等）
    }

    /**
     * 开始生成敌人
     */
    public startSpawning(): void {
        this.buildCurrentWaveSpawnQueue();
        this._isSpawning = true;
        this._spawnedInWaveCount = 0;
        this._nextSpawnTime = 0;
    }

    /**
     * 停止生成敌人
     */
    public stopSpawning(): void {
        this._isSpawning = false;
    }

    /**
     * 构建当前波次的生成队列
     */
    private buildCurrentWaveSpawnQueue(): void {
        if (this.spawnWaves.length === 0) {
            console.error('没有配置任何SpawnWaves！');
            return;
        }

        // 根据当前阶段找到对应的波次
        this._activeWave = null;
        for (const wave of this.spawnWaves) {
            if (wave.activeStage === this.currentStage) {
                this._activeWave = wave;
                break;
            }
        }

        if (!this._activeWave) {
            console.error(`没有为当前阶段 ${this.currentStage} 配置激活的波次！`);
            return;
        }

        // 构建生成队列
        this._currentWaveSpawnQueue = [];
        for (const unit of this._activeWave.enemyUnits) {
            if (!unit.prefab) continue;
            for (let i = 0; i < unit.count; i++) {
                this._currentWaveSpawnQueue.push(unit.prefab);
            }
        }

        if (this._currentWaveSpawnQueue.length === 0) {
            console.warn(`当前波次 '${this._activeWave.waveName}' 没有配置任何敌人。`);
        }

        console.log(`切换到波次: ${this._activeWave.waveName}, 队列长度: ${this._currentWaveSpawnQueue.length}`);
    }

    /**
     * 生成下一个敌人
     */
    private spawnNextEnemy(): void {
        if (!this._activeWave || this._currentWaveSpawnQueue.length === 0) {
            return;
        }

        // 获取当前要生成的预制体
        const prefabToSpawn = this._currentWaveSpawnQueue[this._spawnedInWaveCount];
        this.spawnEnemy(prefabToSpawn);

        this._spawnedInWaveCount++;

        // 判断是否到达一组的末尾
        if (this._spawnedInWaveCount % this.enemiesPerGroup === 0) {
            // 组间间隔
            this._nextSpawnTime = this._activeWave.intervalBetweenGroups;
        } else {
            // 组内间隔
            this._nextSpawnTime = this._activeWave.spawnIntervalInGroup;
        }

        // 如果当前波次的所有敌人都已生成一轮，则重置计数器实现循环
        if (this._spawnedInWaveCount >= this._currentWaveSpawnQueue.length) {
            this._spawnedInWaveCount = 0;
        }
    }

    /**
     * 生成单个敌人
     */
    private spawnEnemy(prefab: Prefab): void {
        if (!prefab) return;

        // 实例化敌人
        const enemy = instantiate(prefab);
        enemy.setPosition(this.node.getWorldPosition());
        enemy.setParent(this.node.scene);

        // 设置敌人的贝塞尔曲线路径
        if (this.bezierCurve) {
            const follower = enemy.getComponent(BezierFollower);
            if (follower) {
                follower.curve = this.bezierCurve;
                follower.speedMultiplier = this.speedMultiplier;

                // 设置初始位置为生成点
                follower.setInitialPosition(this.node.getWorldPosition());

                // 开始移动
                follower.startMove();
            }
        }
    }
}
