import { _decorator, Component } from 'cc';
import { EventCenter } from '../Core/EventCenter';
import { EventName } from '../Core/EventName';
import { GlobalVariables } from '../Core/GlobalVariables';
import { GameManager } from '../Managers/GameManager';
const { ccclass, property } = _decorator;

/**
 * 摧毁角色组件
 * 检测队友与此物体的碰撞，触发胜利条件
 */
@ccclass('DestroyActor')
export class DestroyActor extends Component {
    @property
    public actorTag: string = 'Player';

    @property
    public detectionRadius: number = 1;

    @property({ type: GlobalVariables.Stage })
    public triggerStage: GlobalVariables.Stage = GlobalVariables.Stage.Basic;

    @property
    public checkInterval: number = 0.5;

    private _enableCheckCollision: boolean = false;
    private _checkTimer: number = 0;

    protected start(): void {
        EventCenter.Instance.addListener(EventName.MapLevelUpgrade, this.onMapLevelUpgrade, this);
    }

    protected onDisable(): void {
        EventCenter.Instance.removeListener(EventName.MapLevelUpgrade, this.onMapLevelUpgrade, this);
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
        // TODO: 使用TeamManager获取队友并检测碰撞
        // const teammates = TeamManager.Instance.getMinions();
        // 检测碰撞后触发胜利
        // GlobalVariables.GameResult = GlobalVariables.GameResultType.Victory;
        // GameManager.Instance.GameOver();
        // EventCenter.Instance.eventTrigger(EventName.GameOver);
    }

    private onMapLevelUpgrade(stage: GlobalVariables.Stage): void {
        if (stage === this.triggerStage) {
            this._enableCheckCollision = true;
        }
    }
}
