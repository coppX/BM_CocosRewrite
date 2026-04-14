import { _decorator, Component, Node, Vec3, Enum } from 'cc';
import { PlayerController } from '../Player/PlayerController';
import { CoinCollection } from '../Utils/CoinCollection';
import { CoinTrigger } from '../Core/CoinTrigger';
import { DynamicRectangleMesh } from './DynamicRectangleMesh';
import { ArrowManager } from '../Managers/ArrowManager';
import { EnemyManager } from '../Managers/EnemyManager';
import { EnemyController } from '../Enemy/EnemyController';
import { DeliverTargetManager } from '../Managers/DeliverTargetManager';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
import { GlobalVariables, Stage } from '../Core/GlobalVariables';
const { ccclass, property } = _decorator;
const StageEnum = Enum(GlobalVariables.Stage);

@ccclass('StageTargetPair')
export class StageTargetPair {
    @property({ type: StageEnum })
    public startStage: Stage = GlobalVariables.Stage.Basic;

    @property({ type: StageEnum })
    public endStage: Stage = GlobalVariables.Stage.Basic;

    @property(Node)
    public target: Node | null = null;

    @property
    public allowFindClosestEnemy: boolean = false;

    @property
    public pointToCoinCollection: boolean = false;

    @property(Node)
    public pointTarget: Node | null = null;
}

@ccclass('DirectionalArrow')
export class DirectionalArrow extends Component {
    @property(PlayerController)
    public playerController: PlayerController | null = null;

    @property
    public enemySearchRange: number = 10;

    @property
    public enableArrowDisplay: boolean = true;

    @property({ type: [StageTargetPair] })
    public stageTargetsList: StageTargetPair[] = [];

    private _stageTarget: Node | null = null;
    private _canFindClosestEnemy: boolean = false;
    private _currentTarget: Node | null = null;
    private _dynamicRectangle: DynamicRectangleMesh | null = null;
    private _coinCollection: CoinCollection | null = null;
    private _mapStage: Stage = GlobalVariables.Stage.Basic;
    private _finishedStages: Stage[] = [];

    private _onStageChanged!: (stage: Stage) => void;
    private _onChangeTarget!: (stage: Stage) => void;

    public get currentTarget(): Node | null {
        return this._currentTarget;
    }

    protected onLoad(): void {
        if (!this.playerController) {
            this.playerController = this.node.getComponentInParent(PlayerController)
                ?? PlayerController.Instance;
        }
        if (this.playerController) {
            this._coinCollection = this.playerController.getComponent(CoinCollection);
        }
        if (this.enableArrowDisplay) {
            this._dynamicRectangle = this.node.getComponent(DynamicRectangleMesh);
        }

        this._onStageChanged = (stage: Stage) => {
            this._finishedStages.push(stage);
            this._mapStage = stage;
        };
        this._onChangeTarget = (stage: Stage) => {
            if (this.stageTargetsList.length === 0) return;
            for (const pair of this.stageTargetsList) {
                if (pair.startStage === GlobalVariables.Stage.Basic) {
                    pair.allowFindClosestEnemy = true;
                    break;
                }
            }
        };

        EventCenter.Instance.AddEventListener(EventName.MapLevelUpgrade, this._onStageChanged);
        EventCenter.Instance.AddEventListener(EventName.ChangeDirectionalArrowTarget, this._onChangeTarget);
    }

    protected onDisable(): void {
        EventCenter.Instance.RemoveEventListener(EventName.MapLevelUpgrade, this._onStageChanged);
        EventCenter.Instance.RemoveEventListener(EventName.ChangeDirectionalArrowTarget, this._onChangeTarget);
    }

    protected start(): void {
        this.updateTargetAndCache();
    }

    protected update(dt: number): void {
        this.findStageTarget();
        this._currentTarget = this._canFindClosestEnemy
            ? this.findClosestEnemy()
            : this._stageTarget;

        if (ArrowManager.instance) {
            ArrowManager.instance.updateArrowPosition(this._currentTarget);
        }
        if (this.enableArrowDisplay) {
            this.updateArrowDisplay();
        }
    }

    private findStageTarget(): void {
        for (const pair of this.stageTargetsList) {
            if (pair.startStage <= this._mapStage
                && this._mapStage < pair.endStage
                && pair.target
                && pair.target.active) {

                this._stageTarget = pair.target;
                this._canFindClosestEnemy = pair.allowFindClosestEnemy;

                if (pair.pointToCoinCollection
                    && this._coinCollection
                    && pair.target.getComponent(CoinTrigger)
                    && this._coinCollection.getCoinCount() < pair.target.getComponent(CoinTrigger)!.getRemainingCount()) {
                    this._stageTarget = pair.pointTarget;
                } else {
                    this._canFindClosestEnemy = false;
                }
                return;
            }
        }
        this._stageTarget = null;
    }

    private updateTargetAndCache(): void {
        this.updateCurrentTarget();
    }

    private updateCurrentTarget(): void {
        if (!this.playerController) return;
        const newTarget = this.findBestTarget();
        if (this._currentTarget !== newTarget) {
            this._currentTarget = newTarget;
        }
    }

    private findBestTarget(): Node | null {
        const coin = this.findClosestCoinTrigger();
        return coin ?? this.findClosestEnemy();
    }

    private findClosestCoinTrigger(): Node | null {
        if (!this._coinCollection) return null;
        const manager = DeliverTargetManager.Instance;
        if (!manager) return null;

        const triggers = manager.getTargets();
        const playerPos = this.playerController!.node.getWorldPosition();
        let closest: Node | null = null;
        let minDist = Number.MAX_VALUE;
        const coins = this._coinCollection.getCoinCount();

        for (const t of triggers) {
            if (!t || !t.node.active) continue;
            if (coins < t.getRemainingCount()) continue;
            const d = Vec3.squaredDistance(t.node.getWorldPosition(), playerPos);
            if (d < minDist) {
                minDist = d;
                closest = t.node;
            }
        }
        return closest;
    }

    private findClosestEnemy(): Node | null {
        if (!this.playerController) return null;
        if (!EnemyManager.Instance) return null;

        const playerPos = this.playerController.node.getWorldPosition();
        let closestEnemy: EnemyController | null = null;
        let minDistanceSqr = Number.MAX_VALUE;

        const enemies = EnemyManager.Instance.getTargetsInRange(playerPos, this.enemySearchRange);
        for (const enemy of enemies) {
            if (!this.isValidEnemy(enemy)) continue;
            const distanceSqr = Vec3.squaredDistance(enemy.node.getWorldPosition(), playerPos);
            if (distanceSqr < minDistanceSqr) {
                minDistanceSqr = distanceSqr;
                closestEnemy = enemy;
            }
        }

        return closestEnemy ? closestEnemy.node : null;
    }

    private isValidEnemy(enemy: EnemyController): boolean {
        if (!enemy || !enemy.node.active || enemy.isDeadState()) return false;
        return true;
    }

    private updateArrowDisplay(): void {
        if (!this._dynamicRectangle || !this.playerController) return;
        const playerPos = this.playerController.node.getWorldPosition();
        const offset = new Vec3(0, 0.1, 0);
        const startPoint = Vec3.add(new Vec3(), playerPos, offset);
        this._dynamicRectangle.startPoint.set(startPoint);

        if (this._currentTarget) {
            const dir = Vec3.subtract(new Vec3(), this._currentTarget.getWorldPosition(), playerPos);
            dir.y = 0;
            const mag = dir.length();
            if (mag > 0.01) {
                dir.normalize().multiplyScalar(mag);
                Vec3.add(dir, playerPos, dir);
                Vec3.add(dir, dir, offset);
                this._dynamicRectangle.endPoint.set(dir);
            } else {
                this._dynamicRectangle.endPoint.set(startPoint);
            }
        } else {
            this._dynamicRectangle.endPoint.set(startPoint);
        }
    }

    public getClosestAttackableTarget(): Node | null {
        return this.findClosestEnemy();
    }
}
