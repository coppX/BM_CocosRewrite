import { _decorator, Component, Node } from 'cc';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
import { GlobalVariables } from '../Core/GlobalVariables';
const { ccclass, property } = _decorator;

/**
 * 金币触发器
 */
@ccclass('CoinTrigger')
export class CoinTrigger extends Component {
    @property
    public StageTag: number = GlobalVariables.Stage.TowerDefense1;

    @property
    public triggerCount: number = 10;

    @property
    public isShowed: boolean = false;

    @property
    public canChangeDirectionalArrowTarget: boolean = false;

    @property
    public changeNumber: number = 3;

    private _movingCount: number = 0;
    private _moveFinishedCount: number = 0;

    protected onEnable(): void {
        this.scheduleOnce(this.register, 1);
        this._movingCount = 0;
        this._moveFinishedCount = 0;
    }

    protected onDisable(): void {
        // TODO: DeliverTargetManager.Instance?.UnregisterTarget(this);
    }

    private register(): void {
        // TODO: DeliverTargetManager.Instance?.RegisterTarget(this);
    }

    public addMovingCoin(): void {
        this._movingCount += 1;
    }

    public finishCoinMove(): void {
        this._moveFinishedCount += 1;
        if (this._moveFinishedCount === this._movingCount) {
            this.checkCount();
        }
    }

    public checkCount(): void {
        if (this._moveFinishedCount >= this.triggerCount) {
            EventCenter.Instance.eventTrigger(EventName.MapLevelUpgrade, this.StageTag);
        }

        if (this.canChangeDirectionalArrowTarget && this._moveFinishedCount >= this.changeNumber) {
            EventCenter.Instance.eventTrigger(EventName.ChangeDirectionalArrowTarget, this.StageTag);
        }
    }

    public setShowed(show: boolean): void {
        this.isShowed = show;
    }

    public getRemainingCount(): number {
        return Math.max(0, this.triggerCount - this._moveFinishedCount);
    }

    public getCanMoveCount(): number {
        return Math.max(0, this.triggerCount - this._movingCount);
    }

    public getCurrentCount(): number {
        return this._moveFinishedCount;
    }
}
