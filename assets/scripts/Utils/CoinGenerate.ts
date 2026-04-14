import { _decorator, Component, Vec3 } from 'cc';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
import { Coin } from './Coin';
import { CoinCollection } from './CoinCollection';
import { PoolManager } from '../Managers/PoolManager';
import { AudioManager } from '../Managers/AudioManager';
const { ccclass, property } = _decorator;

@ccclass('CoinGenerate')
export class CoinGenerate extends Component {
    @property
    public canGenerate: boolean = false;

    @property({ group: { name: 'Spawn Settings', id: '1' }, tooltip: '每隔多少秒生成一批' })
    public spawnInterval: number = 1;

    @property({ group: { name: 'Spawn Settings', id: '1' }, tooltip: '最大生成数量' })
    public maxSpawnCount: number = 800;

    @property({ group: { name: 'Batch Spawn', id: '2' }, tooltip: '每次生成金币数量' })
    public spawnBatchCount: number = 5;

    @property({ group: { name: 'Batch Spawn', id: '2' }, tooltip: '批量生成时的圆形半径' })
    public spawnRadius: number = 1;

    @property({ group: { name: 'Batch Spawn', id: '2' }, tooltip: '每批次内金币随机延迟最小值（秒）' })
    public batchMinDelay: number = 0;

    @property({ group: { name: 'Batch Spawn', id: '2' }, tooltip: '每批次内金币随机延迟最大值（秒）' })
    public batchMaxDelay: number = 0.2;

    @property({ group: { name: 'Throw Settings', id: '3' }, type: CoinCollection, tooltip: '投掷目标' })
    public throwTarget: CoinCollection | null = null;

    @property({ group: { name: 'Throw Settings', id: '3' }, tooltip: '投掷跳跃高度' })
    public throwJumpPower: number = 5;

    @property({ group: { name: 'Throw Settings', id: '3' }, tooltip: '投掷持续时间' })
    public throwDuration: number = 0.5;

    private _spawnTimer: number = 0;
    private _spawnedCount: number = 0;

    private readonly _boundSetGenerate = this._setGenerate.bind(this);
    private readonly _boundStopGenerating = this.stopGenerating.bind(this);

    protected start(): void {
        EventCenter.Instance.AddEventListener(EventName.CoinGenerate, this._boundSetGenerate);
        EventCenter.Instance.AddEventListener(EventName.GameOver, this._boundStopGenerating);
        AudioManager.Instance?.play('金矿出现');
    }

    protected onDestroy(): void {
        EventCenter.Instance.RemoveEventListener(EventName.CoinGenerate, this._boundSetGenerate);
        EventCenter.Instance.RemoveEventListener(EventName.GameOver, this._boundStopGenerating);
    }

    protected update(dt: number): void {
        if (!this.canGenerate) return;

        if (this._spawnedCount >= this.maxSpawnCount) {
            this.canGenerate = false;
            return;
        }

        this._spawnTimer += dt;
        if (this._spawnTimer >= this.spawnInterval) {
            this._spawnTimer -= this.spawnInterval;
            this._spawnBatch();
        }
    }

    private _spawnBatch(): void {
        let i = 0;
        const spawnNext = () => {
            if (i >= this.spawnBatchCount || !this.canGenerate || this._spawnedCount >= this.maxSpawnCount) {
                if (this._spawnedCount >= this.maxSpawnCount) {
                    this.canGenerate = false;
                }
                return;
            }

            const angle = (360 / this.spawnBatchCount) * i;
            const rad = angle * Math.PI / 180;
            const randomRadius = Math.random() * this.spawnRadius;
            const selfPos = this.node.getWorldPosition();
            const spawnPos = new Vec3(
                selfPos.x + Math.cos(rad) * randomRadius,
                selfPos.y + 0.5,
                selfPos.z + Math.sin(rad) * randomRadius
            );

            PoolManager.Instance.getObj('Coin', (coinObj) => {
                if (!coinObj) return;

                const coin = coinObj.getComponent(Coin);
                if (coin) {
                    coin.resetState();
                    coin.isBearByGenerator = true;
                    coin.spawnOwner = null;
                }

                // 先设置父节点，再设置世界坐标，最后激活
                coinObj.setParent(this.node.scene);
                coinObj.setWorldPosition(spawnPos);
                coinObj.active = true;

                if (coin) {
                    if (this.throwTarget) {
                        this.throwTarget.collectCoin(coinObj);
                    } else {
                        coin.dropOnGround(spawnPos);
                    }
                }
                this._spawnedCount++;
            });

            i++;
            const delay = this.batchMinDelay + Math.random() * (this.batchMaxDelay - this.batchMinDelay);
            this.scheduleOnce(spawnNext, delay);
        };

        spawnNext();
    }

    private _setGenerate(): void {
        this.canGenerate = true;
        this._spawnTimer = 0;
        this._spawnedCount = 0;
    }

    public stopGenerating(): void {
        this.canGenerate = false;
        this.unscheduleAllCallbacks();
    }
}
