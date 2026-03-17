import { _decorator, Node, Quat, tween, Vec3 } from 'cc';
import { Building } from './Building';
import { DoorManager } from '../Managers/DoorManager';
import { TeamManager } from '../Managers/TeamManager';
import { EnemyManager } from '../Managers/EnemyManager';
const { ccclass, property } = _decorator;

/**
 * 门组件
 * 继承自Building，根据玩家和队友的距离自动开关门
 */
@ccclass('Door')
export class Door extends Building {
    @property
    public playerTag: string = 'Hero';

    @property
    public teammateTag: string = 'Player';

    @property
    public doorOpenAngle: number = 90;

    @property
    public doorRotationDuration: number = 0.5;

    private _leftDoor: Node | null = null;
    private _rightDoor: Node | null = null;
    private _leftClosedRot: Quat = new Quat();
    private _rightClosedRot: Quat = new Quat();
    private _leftOpenRot: Quat = new Quat();
    private _rightOpenRot: Quat = new Quat();
    private _isPermanentlyOpen: boolean = false;
    private _isDoorOpen: boolean = false;
    private _detectionRadius: number = 2;

    protected onLoad(): void {
        this._leftDoor = this.node.getChildByName('LeftDoor');
        this._rightDoor = this.node.getChildByName('RightDoor');

        if (this._leftDoor && this._rightDoor) {
            this._leftClosedRot = this._leftDoor.getRotation().clone();
            this._rightClosedRot = this._rightDoor.getRotation().clone();

            Quat.fromEuler(this._leftOpenRot, 0, 180 - this.doorOpenAngle, 0);
            Quat.fromEuler(this._rightOpenRot, 0, this.doorOpenAngle, 0);
        }
    }

    protected onEnable(): void {
        DoorManager.Instance?.registerDoor(this);
    }

    protected onDisable(): void {
        DoorManager.Instance?.unregisterDoor(this);
    }

    protected onDestroy(): void {
        DoorManager.Instance?.unregisterDoor(this);
    }

    /**
     * 检查玩家和队友的接近情况
     */
    public checkProximity(playerTransform: Node): void {
        // 如果门已永久打开
        if (this._isPermanentlyOpen) {
            if (!this._isDoorOpen) {
                this.openTheDoor();
            }
            return;
        }

        let shouldOpen = false;

        // 检测队友
        if (TeamManager.Instance) {
            const teammates = TeamManager.Instance.getMinions();
            const radiusSqr = this._detectionRadius * this._detectionRadius;

            if ((teammates[0].length > 0 &&
                Vec3.squaredDistance(this.node.getPosition(), teammates[0][0].node.getPosition()) <= radiusSqr) ||
                (teammates[1].length > 0 &&
                Vec3.squaredDistance(this.node.getPosition(), teammates[1][0].node.getPosition()) <= radiusSqr)) {
                shouldOpen = true;
                this._isPermanentlyOpen = true; // 队友触碰后永久打开
            }
        }

        // 检测玩家
        if (!this._isPermanentlyOpen && playerTransform) {
            const radiusSqr = this._detectionRadius * this._detectionRadius;
            if (Vec3.squaredDistance(this.node.getPosition(), playerTransform.getPosition()) <= radiusSqr) {
                shouldOpen = true;
            }
        }

        // 更新门状态
        if (shouldOpen && !this._isDoorOpen) {
            this.openTheDoor();
        } else if (!shouldOpen && this._isDoorOpen) {
            this.closeTheDoor();
        }

        // 检测敌人
        if (EnemyManager.Instance) {
            const enemyRadius = this._detectionRadius / 2;
            const enemies = EnemyManager.Instance.getMinions();
            const radiusSqr = enemyRadius * enemyRadius;

            if (enemies[0].length > 0 &&
                Vec3.squaredDistance(this.node.getPosition(), enemies[0][0].node.getPosition()) < radiusSqr) {
                this.beHit(enemies[0][0].node);
            }

            if (enemies[1].length > 0 &&
                Vec3.squaredDistance(this.node.getPosition(), enemies[1][0].node.getPosition()) < radiusSqr) {
                this.beHit(enemies[1][0].node);
            }
        }
    }

    private openTheDoor(): void {
        if (!this._leftDoor || !this._rightDoor) return;

        tween(this._leftDoor)
            .to(this.doorRotationDuration,
                { rotation: this._leftOpenRot },
                { easing: 'smooth' })
            .start();

        tween(this._rightDoor)
            .to(this.doorRotationDuration,
                { rotation: this._rightOpenRot },
                { easing: 'smooth' })
            .start();

        this._isDoorOpen = true;
    }

    private closeTheDoor(): void {
        if (!this._leftDoor || !this._rightDoor) return;

        tween(this._leftDoor)
            .to(this.doorRotationDuration,
                { rotation: this._leftClosedRot },
                { easing: 'smooth' })
            .start();

        tween(this._rightDoor)
            .to(this.doorRotationDuration,
                { rotation: this._rightClosedRot },
                { easing: 'smooth' })
            .start();

        this._isDoorOpen = false;
    }
}
