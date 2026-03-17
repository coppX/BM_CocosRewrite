import { _decorator, Component, Node } from 'cc';
import { PlayerController } from '../Player/PlayerController';
const { ccclass, property } = _decorator;

/**
 * 门管理器
 * 定期检查玩家与门的距离并触发相应逻辑
 */
@ccclass('DoorManager')
export class DoorManager extends Component {
    private static _instance: DoorManager | null = null;

    public static get Instance(): DoorManager | null {
        return this._instance;
    }

    @property(PlayerController)
    public player: PlayerController | null = null;

    private _doors: Component[] = [];
    private _playerTransform: Node | null = null;
    private _checkInterval: number = 0.2;
    private _checkTimer: number = 0;

    protected onLoad(): void {
        if (DoorManager._instance !== null && DoorManager._instance !== this) {
            this.node.destroy();
            return;
        }
        DoorManager._instance = this;
    }

    protected start(): void {
        if (this.player) {
            this._playerTransform = this.player.node;
        }
    }

    protected update(dt: number): void {
        this._checkTimer += dt;

        if (this._checkTimer >= this._checkInterval) {
            this._checkTimer = 0;
            this.checkDoors();
        }
    }

    /**
     * 注册门
     */
    public registerDoor(door: Component): void {
        if (!this._doors.includes(door)) {
            this._doors.push(door);
        }
    }

    /**
     * 注销门
     */
    public unregisterDoor(door: Component): void {
        const index = this._doors.indexOf(door);
        if (index !== -1) {
            this._doors.splice(index, 1);
        }
    }

    /**
     * 检查所有门的接近情况
     */
    private checkDoors(): void {
        if (!this._playerTransform) return;

        for (const door of this._doors) {
            if (door) {
                // TODO: 调用door的checkProximity方法
                // (door as any).checkProximity(this._playerTransform);
            }
        }
    }

    protected onDestroy(): void {
        if (DoorManager._instance === this) {
            DoorManager._instance = null;
        }
    }
}
