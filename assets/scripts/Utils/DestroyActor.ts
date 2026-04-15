import { _decorator, Component, Enum } from 'cc';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
import { GlobalVariables, Stage } from '../Core/GlobalVariables';
import { GameManager } from '../Managers/GameManager';
import { TeamManager } from '../Managers/TeamManager';
const { ccclass, property } = _decorator;
const StageEnum = Enum(GlobalVariables.Stage);

/**
 * 摧毁角色组件
 * 检测队友与此物体的碰撞，触发胜利条件
 */
@ccclass('DestroyActor')
export class DestroyActor extends Component {

    @property
    public detectionRadius: number = 1;

    @property({ type: StageEnum, tooltip: '触发阶段' })
    public triggerStage: Stage = GlobalVariables.Stage.Basic;

    @property
    public checkInterval: number = 0.5;

    private _enableCheckCollision: boolean = false;
    private _checkTimer: number = 0;
    private _boundOnMapLevelUpgrade: ((stage: Stage) => void) | null = null;

    protected start(): void {
        this._boundOnMapLevelUpgrade = this.onMapLevelUpgrade.bind(this);
        EventCenter.Instance.AddEventListener(EventName.MapLevelUpgrade, this._boundOnMapLevelUpgrade);
    }

    protected onDisable(): void {
        if (this._boundOnMapLevelUpgrade) {
            EventCenter.Instance.RemoveEventListener(EventName.MapLevelUpgrade, this._boundOnMapLevelUpgrade);
        }
    }

    protected update(dt: number): void {
        if (!this._enableCheckCollision) return;

        this._checkTimer -= dt;
        if (this._checkTimer <= 0) {
            this._checkTimer = this.checkInterval;
            this.checkCollision();
        }
    }

    private checkCollision(): void {
        if (!TeamManager.Instance) return;

        const teammates = TeamManager.Instance.getTeammatesInRange(
            this.node.getWorldPosition(),
            this.detectionRadius
        );

        if (teammates.length > 0) {
            GlobalVariables.GameResult = GlobalVariables.GameResultType.Victory;
            GameManager.Instance?.gameOver();
            EventCenter.Instance.eventTrigger(EventName.GameOver);
            this._enableCheckCollision = false;
        }
    }

    private onMapLevelUpgrade(stage: Stage): void {
        if (stage === this.triggerStage) {
            this._enableCheckCollision = true;
        }
    }
}
