import { _decorator, Component, Enum } from 'cc';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
import { GlobalVariables, Stage } from '../Core/GlobalVariables';
import { DeliverTargetManager } from '../Managers/DeliverTargetManager';
const { ccclass, property } = _decorator;
const StageEnum = Enum(GlobalVariables.Stage);

/**
 * 金币触发器
 */
@ccclass('CoinTrigger')
export class CoinTrigger extends Component {
    @property({ type: StageEnum, tooltip: '触发后升级到的阶段' })
    public StageTag: Stage = GlobalVariables.Stage.TowerDefense1;

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
        this.unschedule(this.register);
        DeliverTargetManager.Instance?.unregisterTarget(this);
    }

    private register(): void {
        DeliverTargetManager.Instance?.registerTarget(this);
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
