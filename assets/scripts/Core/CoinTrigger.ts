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
        this.scheduleOnce(this.Register, 1);
        this._movingCount = 0;
        this._moveFinishedCount = 0;
    }

    protected onDisable(): void {
        // TODO: DeliverTargetManager.Instance?.UnregisterTarget(this);
    }

    private Register(): void {
        // TODO: DeliverTargetManager.Instance?.RegisterTarget(this);
    }

    public AddMovingCoin(): void {
        this._movingCount += 1;
    }

    public FinishCoinMove(): void {
        this._moveFinishedCount += 1;
        if (this._moveFinishedCount === this._movingCount) {
            this.CheckCount();
        }
    }

    public CheckCount(): void {
        if (this._moveFinishedCount >= this.triggerCount) {
            EventCenter.Instance.EventTrigger(EventName.MapLevelUpgrade, this.StageTag);
        }

        if (this.canChangeDirectionalArrowTarget && this._moveFinishedCount >= this.changeNumber) {
            EventCenter.Instance.EventTrigger(EventName.ChangeDirectionalArrowTarget, this.StageTag);
        }
    }

    public SetShowed(show: boolean): void {
        this.isShowed = show;
    }

    public GetRemainingCount(): number {
        return Math.max(0, this.triggerCount - this._moveFinishedCount);
    }

    public GetCanMoveCount(): number {
        return Math.max(0, this.triggerCount - this._movingCount);
    }

    public GetCurrentCount(): number {
        return this._moveFinishedCount;
    }
}
