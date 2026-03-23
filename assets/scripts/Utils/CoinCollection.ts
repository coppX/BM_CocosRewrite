import { _decorator, Component, Node, Vec3, tween, Tween, CCFloat, CCInteger, CCBoolean, game } from 'cc';
import { Coin } from './Coin';
import { CoinManager } from '../Managers/CoinManager';
import { CoinCollectionManager } from '../Managers/CoinCollectionManager';
import { DeliverTargetManager } from '../Managers/DeliverTargetManager';
import { PoolManager } from '../Managers/PoolManager';
import { EventCenter } from '../Core/EventCenter';
import { AudioManager } from '../Managers/AudioManager';
import { CoinTrigger } from '../Core/CoinTrigger';
import { EventName } from '../Core/EventName';
const { ccclass, property } = _decorator;

/**
 * 金币收集系统
 * 负责收集、堆叠、投递和转移金币
 */
@ccclass('CoinCollection')
export class CoinCollection extends Component {
    @property(Node)
    public slot: Node | null = null;

    public coinCount: number = 0;
    public coinCountFinishedMove: number = 0;

    @property(CCFloat)
    private moveDuration: number = 0.3;

    private collectedCoins: Node[] = [];
    private lastDeliverTarget: Node | null = null;
    private deliverTimer: number = 0;

    // Grid Stack Settings
    @property({ group: { name: 'Grid Stack', id: '1' }, tooltip: '每层的行数' })
    public rowsPerLayer: number = 2;

    @property({ group: { name: 'Grid Stack', id: '1' }, tooltip: '每层的列数' })
    public colsPerLayer: number = 2;

    @property({ group: { name: 'Grid Stack', id: '1' }, tooltip: '水平间距' })
    public horizontalSpacing: number = 0.2;

    @property({ group: { name: 'Grid Stack', id: '1' }, tooltip: '深度间距' })
    public depthSpacing: number = 0.2;

    @property({ group: { name: 'Grid Stack', id: '1' }, tooltip: '金币高度' })
    public coinHeight: number = 0.1;

    @property({ group: { name: 'Grid Stack', id: '1' }, tooltip: '堆叠旋转角度' })
    public stackRotationAngle: number = 45;

    // Deliver Settings
    @property({ group: { name: 'Deliver', id: '2' }, tooltip: '投递跳跃高度' })
    public deliverJumpPower: number = 10;

    @property({ group: { name: 'Deliver', id: '2' }, tooltip: '投递检测半径' })
    public deliverCheckRadius: number = 5;

    @property({ group: { name: 'Deliver', id: '2' }, tooltip: '投递飞行时间' })
    public deliverDuration: number = 0.2;

    @property({ group: { name: 'Deliver', id: '2' }, tooltip: '投递间隔时间' })
    public deliverInterval: number = 0.1;

    @property({ group: { name: 'Deliver', id: '2' }, tooltip: '投递位置随机范围' })
    public deliverRandomRange: number = 0.5;

    // Collect Settings
    @property({ group: { name: 'Collect', id: '3' }, tooltip: '收集跳跃高度' })
    public collectJumpPower: number = 10;

    @property({ group: { name: 'Collect', id: '3' }, tooltip: '收集检测半径' })
    public collectDetectRadius: number = 10;

    @property({ group: { name: 'Collect', id: '3' }, tooltip: '最大可视金币数量' })
    public maxVisualCollectCount: number = 100;

    public overflowCollectCount: number = 0;
    private _overflowFinishedCount: number = 0;

    // Transfer Settings
    @property({ group: { name: 'Transfer', id: '4' }, tooltip: '转移跳跃高度' })
    public transferJumpPower: number = 20;

    @property({ group: { name: 'Transfer', id: '4' }, tooltip: '转移触发半径' })
    public transferRadius: number = 5;

    @property({ group: { name: 'Transfer', id: '4' }, tooltip: '转移飞行时间' })
    public transferDuration: number = 0.3;

    @property({ group: { name: 'Transfer', id: '4' }, tooltip: '转移间隔时间' })
    public transferInterval: number = 0.1;

    private lastTransferTarget: CoinCollection | null = null;
    private transferTimer: number = 0;

    @property({ group: { name: 'Options', id: '5' }, tooltip: '是否允许飞行到其他CoinCollection实例' })
    public flyToOtherCollection: boolean = false;

    @property({ group: { name: 'Options', id: '5' }, tooltip: '是否允许收集生成器生成的金币' })
    public canCollectBearByGeneratorCoins: boolean = false;

    // Initial Coins
    @property({ group: { name: 'Initial', id: '6' }, tooltip: '启用初始金币' })
    public enableInitialCoins: boolean = false;

    @property({ group: { name: 'Initial', id: '6' }, tooltip: '初始金币数量' })
    public initialCoinCount: number = 3;

    private static hasTriggeredMapLevelUpgradeEvent: boolean = false;
    private readonly _onGameOver = this.resetAndReturnCoinsToPool.bind(this);

    protected onLoad(): void {
        if (!this.slot) {
            this.slot = this.node;
        }
        // 监听GameOver事件
        EventCenter.Instance.AddEventListener(EventName.GameOver, this._onGameOver);
        this.initializeCoin();
    }

    protected onEnable(): void {
        this.scheduleOnce(() => {
            this.register();
        }, 1);
    }

    protected onDisable(): void {
        // 移除事件监听
        EventCenter.Instance.RemoveEventListener(EventName.GameOver, this._onGameOver);
        this.unregister();
    }

    protected update(dt: number): void {
        this.collection();
        this.deliver();
        this.transfer();
    }

    private register(): void {
        CoinCollectionManager.Instance?.registerCollection(this);
    }

    private unregister(): void {
        CoinCollectionManager.Instance?.unregisterCollection(this);
    }

    /**
     * 重置并返还金币到对象池
     */
    public resetAndReturnCoinsToPool(): void {
        this.collectedCoins.forEach(coinNode => {
            if (coinNode && coinNode.isValid) {
                coinNode.active = true;
                PoolManager.Instance.pushObj(coinNode.name, coinNode);
            }
        });

        this.collectedCoins = [];
        this.coinCount = 0;
        this.coinCountFinishedMove = 0;
        this.overflowCollectCount = 0;
        this._overflowFinishedCount = 0;
    }

    private initializeCoin(): void {
        if (!this.enableInitialCoins || this.initialCoinCount <= 0) return;

        for (let i = 0; i < this.initialCoinCount; i++) {
            PoolManager.Instance.getObj("Coin", (coinObj) => {
                if (!coinObj) return;
                coinObj.active = true;
                coinObj.setParent(this.slot);

                const localOffset = this.getNextSlotPosition();
                const rotatedOffset = this.rotateVector(localOffset, this.stackRotationAngle);
                coinObj.setPosition(rotatedOffset);
                coinObj.setRotation(0, 0, 0, 1);

                const coin = coinObj.getComponent(Coin);
                if (coin) {
                    coin.spawnOwner = null;
                    coin.isBearByGenerator = false;
                }

                this.collectedCoins.push(coinObj);
                this.coinCount++;
                this.coinCountFinishedMove++;
            });
        }
    }

    private collection(): void {
        if (!CoinManager.Instance) return;

        const activeCoins = CoinManager.Instance.AvailableCoins;
        activeCoins.forEach(coin => {
            if (!coin || !coin.node.active) return;
            if (coin.spawnOwner !== null) return;

            // 检查是否允许收集生成器生成的金币
            if (this.canCollectBearByGeneratorCoins) {
                if (!coin.isBearByGenerator) return;
            } else {
                if (coin.isBearByGenerator) return;
            }

            const coinNode = coin.node;
            // 检查距离
            const distanceSqr = Vec3.squaredDistance(this.node.getPosition(), coinNode.getPosition());
            if (distanceSqr > this.collectDetectRadius * this.collectDetectRadius) return;

            // 检查是否正在移动
            if (coin.isBeingDelivered || coin.isMoving) return;

            // 确保不会重复收集
            if (this.collectedCoins.indexOf(coinNode) === -1) {
                AudioManager.Instance?.play('金币收集');
                this.collectCoin(coinNode);
            }
        });
    }

    private deliver(): void {
        if (this.flyToOtherCollection || this.coinCount <= 0) return;

        // 查找或更新投递目标
        if (!this.lastDeliverTarget ||
            Vec3.squaredDistance(this.node.getPosition(), this.lastDeliverTarget.getPosition()) > this.deliverCheckRadius * this.deliverCheckRadius) {

            this.lastDeliverTarget = DeliverTargetManager.Instance?.getNearestTarget(this.node.getPosition(), this.deliverCheckRadius) || null;
            if (this.lastDeliverTarget) {
                this.deliverTimer = 0;
            }
        }

        if (!this.lastDeliverTarget) return;

        this.deliverTimer += game.deltaTime;
        if (this.deliverTimer < this.deliverInterval) return;
        this.deliverTimer = 0;

        const coinTrigger = this.lastDeliverTarget.getComponent(CoinTrigger);
        if (!coinTrigger || coinTrigger.GetCanMoveCount() <= 0) return;

        AudioManager.Instance?.play('金币投递');

        if (this.overflowCollectCount > 0) {
            PoolManager.Instance.getObj("Coin", (coinObj) => {
                if (!coinObj) return;
                this.overflowCollectCount--;
                coinObj.active = true;
                coinObj.setPosition(this.slot!.getPosition().add(this.getNextSlotPosition()));
                this.executeDeliver(this.lastDeliverTarget!, coinObj, coinTrigger);
            });
        } else {
            const coin = this.collectedCoins[this.collectedCoins.length - 1];
            if (!coin) return;
            this.collectedCoins.pop();
            this.coinCount--;
            this.executeDeliver(this.lastDeliverTarget, coin, coinTrigger);
        }
    }

    private transfer(): void {
        if (!this.flyToOtherCollection || this.coinCount <= 0) return;

        // 检查是否有非移动状态的金币
        const hasStaticCoin = this.collectedCoins.some(coinNode => {
            const coinComp = coinNode.getComponent(Coin);
            return coinComp && !coinComp.isMoving;
        });
        if (!hasStaticCoin) return;

        // 查找或更新转移目标
        if (!this.lastTransferTarget ||
            Vec3.squaredDistance(this.node.getPosition(), this.lastTransferTarget.node.getPosition()) > this.transferRadius * this.transferRadius) {

            this.lastTransferTarget = this.findNewTransferTarget();
            if (this.lastTransferTarget) {
                this.transferTimer = 0;
            }
        }

        if (!this.lastTransferTarget) return;

        // 执行金币转移
        this.processTransfer();
    }

    private findNewTransferTarget(): CoinCollection | null {
        const nearbyCollections = CoinCollectionManager.Instance?.getNearbyCollections(this.node.getPosition(), this.transferRadius);
        if (!nearbyCollections || nearbyCollections.length === 0) return null;

        for (const collection of nearbyCollections) {
            const coinCollection = collection as any as CoinCollection;
            if (coinCollection !== this && !coinCollection.flyToOtherCollection) {
                return coinCollection;
            }
        }
        return null;
    }

    private processTransfer(): void {
        AudioManager.Instance?.play('金币传送');

        this.transferTimer += game.deltaTime;

        if (this.transferTimer >= this.transferInterval) {
            this.transferTimer -= this.transferInterval;

            // 触发地图升级事件（只触发一次）
            if (!CoinCollection.hasTriggeredMapLevelUpgradeEvent) {
                EventCenter.Instance.EventTrigger('MapLevelUpgrade', 'MineCollect');
                CoinCollection.hasTriggeredMapLevelUpgradeEvent = true;
            }

            this.transferCoinToTarget();
        }
    }

    private transferCoinToTarget(): void {
        if (!this.lastTransferTarget) return;
        if (this.lastTransferTarget === this) {
            this.lastTransferTarget = null;
            return;
        }

        if (this.overflowCollectCount > 0) {
            PoolManager.Instance.getObj("Coin", (coinObj) => {
                if (!coinObj) return;
                coinObj.active = true;
                this.overflowCollectCount--;
                coinObj.setPosition(this.slot!.getPosition().add(this.getNextSlotPosition()));
                this.executeTransfer(coinObj);
            });
        } else {
            const coin = this.collectedCoins[this.collectedCoins.length - 1];
            if (!coin) return;
            this.collectedCoins.pop();
            this.coinCount--;
            this.executeTransfer(coin);
        }
    }

    /**
     * 执行投递
     */
    private executeDeliver(target: Node, coin: Node, coinTrigger: CoinTrigger): void {
        coin.setParent(null);
        const coinComponent = coin.getComponent(Coin);
        if (coinComponent) {
            CoinManager.Instance?.UnregisterCoin(coinComponent);
            coinComponent.isBeingDelivered = true;
        }

        coinTrigger.AddMovingCoin();

        // 添加随机偏移
        const randomOffset = new Vec3(
            (Math.random() * 2 - 1) * this.deliverRandomRange,
            0,
            (Math.random() * 2 - 1) * this.deliverRandomRange
        );
        const randomTargetPosition = target.getPosition().add(randomOffset);

        // 创建跳跃动画
        const jumpTween = this.createJumpTween(coin, randomTargetPosition, this.deliverJumpPower, this.deliverDuration);
        jumpTween.call(() => {
            if (this._overflowFinishedCount > 0) {
                this._overflowFinishedCount--;
            } else if (this.coinCountFinishedMove > 0) {
                this.coinCountFinishedMove--;
            }

            coinTrigger.FinishCoinMove();
            if (coinComponent) {
                coinComponent.ResetState();
            }

            coin.active = false;
            PoolManager.Instance.pushObj(coin.name, coin);
        });
        jumpTween.start();
    }

    /**
     * 执行转移
     */
    private executeTransfer(coin: Node): void {
        const coinComponent = coin.getComponent(Coin);
        if (coinComponent) {
            coinComponent.isBeingDelivered = true;
            coinComponent.StartMove();
        }
        coin.setParent(null);

        const target = this.lastTransferTarget;
        if (!target) {
            PoolManager.Instance.pushObj(coin.name, coin);
            return;
        }

        const startPosition = coin.getPosition();
        let progress = 0;

        tween({ value: 0 })
            .to(this.transferDuration, { value: 1 }, {
                onUpdate: (obj: any, ratio?: number) => {
                    progress = obj.value;
                    if (!coin || !coin.isValid || !target || !target.isValid) return;

                    const currentTargetPosition = target.slot!.getPosition().add(target.getNextSlotPosition());
                    const targetStackHeight = target.coinCount * target.coinHeight;
                    const dynamicJumpPower = Math.max(this.transferJumpPower, targetStackHeight + 2);

                    const currentPosition = new Vec3();
                    Vec3.lerp(currentPosition, startPosition, currentTargetPosition, progress);
                    const arcHeight = dynamicJumpPower * Math.sin(progress * Math.PI);
                    currentPosition.y += arcHeight;

                    coin.setPosition(currentPosition);
                }
            })
            .call(() => {
                if (this._overflowFinishedCount > 0) {
                    this._overflowFinishedCount--;
                } else if (this.coinCountFinishedMove > 0) {
                    this.coinCountFinishedMove--;
                }

                if (target && target.isValid) {
                    target.receiveCoin(coin);
                } else if (coin && coin.isValid) {
                    PoolManager.Instance.pushObj(coin.name, coin);
                }
            })
            .start();
    }

    /**
     * 计算下一个金币的位置
     */
    public getNextSlotPosition(): Vec3 {
        const index = this.coinCount;
        const layerSize = this.rowsPerLayer * this.colsPerLayer;
        const layer = Math.floor(index / layerSize);
        const indexInLayer = index % layerSize;
        const row = Math.floor(indexInLayer / this.colsPerLayer);
        const col = indexInLayer % this.colsPerLayer;

        const xOffset = (col - (this.colsPerLayer - 1) / 2) * this.horizontalSpacing;
        const zOffset = (row - (this.rowsPerLayer - 1) / 2) * this.depthSpacing;
        const yOffset = layer * this.coinHeight;

        return new Vec3(xOffset, yOffset, zOffset);
    }

    /**
     * 收集金币
     */
    public collectCoin(coin: Node): void {
        const coinComponent = coin.getComponent(Coin);
        if (coinComponent) {
            CoinManager.Instance?.UnregisterCoin(coinComponent);
            coinComponent.StartMove();
            coinComponent.spawnOwner = this.node;
        }

        const targetLocalPos = this.getNextSlotPosition();
        const rotatedPos = this.rotateVector(targetLocalPos, this.stackRotationAngle);
        coin.setParent(this.slot);

        // 使用Cocos Tween替代DoTween
        const jumpTween = this.createJumpTween(coin, rotatedPos, this.collectJumpPower, this.moveDuration);
        jumpTween.call(() => {
            if (coinComponent && coinComponent.node.active) {
                coinComponent.StopMove();
                coinComponent.isBearByGenerator = false;
            }
            coin.setRotation(0, 0, 0, 1);

            if (this.coinCountFinishedMove >= this.maxVisualCollectCount) {
                coin.setPosition(this.getNextSlotPosition());
                coin.active = false;
                PoolManager.Instance.pushObj(coin.name, coin);
                this._overflowFinishedCount++;
            } else {
                this.coinCountFinishedMove++;
                coin.setPosition(rotatedPos);
            }
        });
        jumpTween.start();

        if (this.coinCount < this.maxVisualCollectCount) {
            this.collectedCoins.push(coin);
            this.coinCount++;
        } else {
            this.overflowCollectCount++;
        }
    }

    /**
     * 接收金币（来自转移）
     */
    public receiveCoin(coin: Node): void {
        if (!coin || !coin.isValid || this.collectedCoins.indexOf(coin) !== -1) return;

        const coinComponent = coin.getComponent(Coin);
        if (coinComponent && coinComponent.node.active) {
            coin.setParent(this.slot);
            coin.setPosition(Vec3.ZERO);
            const localPos = this.getNextSlotPosition();
            coin.setPosition(localPos);
            coin.setRotation(0, 0, 0, 1);
            coinComponent.spawnOwner = this.node;
            coinComponent.isBearByGenerator = false;
            coinComponent.isBeingDelivered = false;
            coinComponent.StopMove();
        }

        if (this.coinCount >= this.maxVisualCollectCount) {
            coin.active = false;
            PoolManager.Instance.pushObj(coin.name, coin);
            this._overflowFinishedCount++;
            this.overflowCollectCount++;
        } else {
            this.collectedCoins.push(coin);
            this.coinCount++;
            this.coinCountFinishedMove++;
        }
    }

    /**
     * 获取当前金币数量
     */
    public getCoinCount(): number {
        return this.coinCountFinishedMove + this._overflowFinishedCount;
    }

    /**
     * 创建跳跃Tween（替代DoTween的DOJump）
     */
    private createJumpTween(target: Node, endPos: Vec3, jumpPower: number, duration: number): Tween<Node> {
        const startPos = target.getPosition();
        const distance = Vec3.distance(startPos, endPos);

        return tween(target)
            .to(duration, {}, {
                onUpdate: (target: Node, ratio: number) => {
                    const currentPos = new Vec3();
                    Vec3.lerp(currentPos, startPos, endPos, ratio);

                    // 计算抛物线高度
                    const arcHeight = jumpPower * Math.sin(ratio * Math.PI);
                    currentPos.y += arcHeight;

                    target.setPosition(currentPos);
                }
            });
    }

    /**
     * 旋转向量
     */
    private rotateVector(vec: Vec3, angleY: number): Vec3 {
        const rad = angleY * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        return new Vec3(
            vec.x * cos - vec.z * sin,
            vec.y,
            vec.x * sin + vec.z * cos
        );
    }

    protected onDestroy(): void {
        // 清理所有tween
        this.collectedCoins.forEach(coin => {
            if (coin && coin.isValid) {
                Tween.stopAllByTarget(coin);
            }
        });
    }
}
