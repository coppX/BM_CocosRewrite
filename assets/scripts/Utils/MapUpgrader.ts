import { _decorator, Component, Node, Vec3, tween, Tween, Enum } from 'cc';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
import { GlobalVariables, Stage } from '../Core/GlobalVariables';
import { CoinTrigger } from '../Core/CoinTrigger';

const { ccclass, property } = _decorator;
const StageEnum = Enum(GlobalVariables.Stage);

@ccclass('MapUpgradeObject')
export class MapUpgradeObject {
    @property(Node)
    public node: Node = null!;

    @property
    public enableScaling: boolean = false;
}

@ccclass('MapUpgradeData')
export class MapUpgradeData {
    @property({ type: StageEnum })
    public stageTag: Stage = GlobalVariables.Stage.Basic;

    @property([MapUpgradeObject])
    public showObjects: MapUpgradeObject[] = [];

    @property([Node])
    public hideObjects: Node[] = [];

    @property([Node])
    public afterBounceObjects: Node[] = [];
}

@ccclass('ConditionalMapUpgradeData')
export class ConditionalMapUpgradeData {
    @property({ type: [StageEnum] })
    public requiredStages: Stage[] = [];

    @property([MapUpgradeObject])
    public showObjects: MapUpgradeObject[] = [];

    @property([Node])
    public hideObjects: Node[] = [];

    @property([Node])
    public afterBounceObjects: Node[] = [];
}

@ccclass('MapUpgrader')
export class MapUpgrader extends Component {
    public static Instance: MapUpgrader | null = null;

    @property([MapUpgradeData])
    public mapObjects: MapUpgradeData[] = [];

    @property([ConditionalMapUpgradeData])
    public conditionalMapObjects: ConditionalMapUpgradeData[] = [];

    private _completedStages: Set<Stage> = new Set();
    private _executedUpgradeIndices: Set<number> = new Set();

    protected onLoad(): void {
        MapUpgrader.Instance = this;

        EventCenter.Instance.AddEventListener(EventName.MapLevelUpgrade, this._onMapUpgrade.bind(this));
        EventCenter.Instance.AddEventListener(EventName.GameOver, this._onEndGame.bind(this));

        // Apply initial upgrade (first upgrade data)
        if (this.mapObjects.length > 0) {
            for (const obj of this.mapObjects[0].showObjects) {
                obj.node.active = true;
            }
            for (const obj of this.mapObjects[0].hideObjects) {
                obj.active = false;
            }
        }
    }

    private _onMapUpgrade = (stage: Stage): void => {
        for (const mapData of this.mapObjects) {
            if (mapData.stageTag === stage) {
                this._applyUpgrade(mapData);
            }
        }

        this._completedStages.add(stage);
        GlobalVariables.CurrentStage = stage;
    };

    private _applyUpgrade(mapData: MapUpgradeData): void {
        const total = mapData.showObjects.length;
        let completed = 0;

        for (const mapObj of mapData.showObjects) {
            const node = mapObj.node;
            if (node.active) continue;
            node.active = true;

            this._animate(mapObj, () => {
                completed++;
                if (completed >= total) {
                    for (const afterObj of mapData.afterBounceObjects) {
                        afterObj.active = true;
                    }
                }
                this._checkConditionalUpgrades();
            });
        }

        for (const obj of mapData.hideObjects) {
            obj.active = false;
        }
    }

    private _applyConditionalUpgrade(conditionalData: ConditionalMapUpgradeData): void {
        const total = conditionalData.showObjects.length;
        let completed = 0;

        for (const mapObj of conditionalData.showObjects) {
            const node = mapObj.node;
            const coinTrigger = node.getComponent(CoinTrigger);

            if (!coinTrigger || !coinTrigger.isShowed) {
                node.active = true;
                coinTrigger?.setShowed(true);

                this._animate(mapObj, () => {
                    completed++;
                    if (completed >= total) {
                        for (const afterObj of conditionalData.afterBounceObjects) {
                            afterObj.active = true;
                        }
                    }
                });
            }
        }

        for (const obj of conditionalData.hideObjects) {
            obj.active = false;
        }
    }

    private _checkConditionalUpgrades(): void {
        for (let i = 0; i < this.conditionalMapObjects.length; i++) {
            if (this._executedUpgradeIndices.has(i)) continue;

            const conditionalData = this.conditionalMapObjects[i];
            let canUpgrade = true;

            for (const requiredStage of conditionalData.requiredStages) {
                if (!this._completedStages.has(requiredStage)) {
                    canUpgrade = false;
                    break;
                }
            }

            if (canUpgrade) {
                this._applyConditionalUpgrade(conditionalData);
                this._executedUpgradeIndices.add(i);
            }
        }
    }

    private _onEndGame = (): void => {
        // Reserved for end game logic
    };

    protected onDestroy(): void {
        EventCenter.Instance.RemoveEventListener(EventName.MapLevelUpgrade, this._onMapUpgrade);
        EventCenter.Instance.RemoveEventListener(EventName.GameOver, this._onEndGame);
        if (MapUpgrader.Instance === this) {
            MapUpgrader.Instance = null;
        }
    }

    private _animate(mapObj: MapUpgradeObject, onComplete: () => void): void {
        const node = mapObj.node;
        const originalPos = node.position.clone();
        const originalScale = node.scale.clone();

        if (mapObj.enableScaling) {
            node.setPosition(originalPos.x, originalPos.y - 2, originalPos.z);
            node.setScale(originalScale.x * 1.2, originalScale.y * 0.8, originalScale.z * 1.2);

            tween(node)
                .to(0.25, { position: new Vec3(originalPos.x, originalPos.y, originalPos.z) }, {
                    easing: 'quadOut',
                    onUpdate: () => {
                        const progress = (node.position.y - (originalPos.y - 2)) / 2;
                        node.setScale(
                            lerp(originalScale.x * 1.1, originalScale.x * 0.9, progress),
                            lerp(originalScale.y * 0.9, originalScale.y * 1.1, progress),
                            lerp(originalScale.z * 1.1, originalScale.z * 0.9, progress)
                        );
                    }
                })
                .to(0.2, { scale: new Vec3(originalScale.x * 1.05, originalScale.y * 0.95, originalScale.z * 1.05) }, {
                    easing: 'quadInOut'
                })
                .to(0.2, { scale: new Vec3(originalScale.x, originalScale.y, originalScale.z) }, {
                    easing: 'quadInOut'
                })
                .call(onComplete)
                .start();
        } else {
            node.setPosition(originalPos.x, originalPos.y - 2, originalPos.z);
            node.setScale(originalScale.x, originalScale.y * 0.9, originalScale.z);

            tween(node)
                .to(0.1, { position: new Vec3(originalPos.x, originalPos.y + 0.5, originalPos.z) }, {
                    easing: 'quadOut',
                    onUpdate: () => {
                        const progress = (node.position.y - (originalPos.y - 2)) / 2.5;
                        node.setScale(
                            originalScale.x,
                            lerp(originalScale.y * 0.9, originalScale.y * 1.1, progress),
                            originalScale.z
                        );
                    }
                })
                .to(0.1, { position: new Vec3(originalPos.x, originalPos.y - 0.25, originalPos.z) }, {
                    easing: 'quadIn',
                    onUpdate: () => {
                        const progress = ((originalPos.y + 0.5) - node.position.y) / 0.75;
                        node.setScale(
                            originalScale.x,
                            lerp(originalScale.y * 1.1, originalScale.y * 0.9, progress),
                            originalScale.z
                        );
                    }
                })
                .to(0.1, {
                    position: new Vec3(originalPos.x, originalPos.y, originalPos.z),
                    scale: new Vec3(originalScale.x, originalScale.y, originalScale.z)
                }, {
                    easing: 'bounceOut'
                })
                .call(onComplete)
                .start();
        }
    }
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * Math.min(Math.max(t, 0), 1);
}
