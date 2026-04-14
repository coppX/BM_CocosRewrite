import { _decorator, Node, Quat, tween, Vec3 } from 'cc';
import { Building } from './Building';
import { DoorManager } from '../Managers/DoorManager';
import { TeamManager } from '../Managers/TeamManager';
import { EnemyManager } from '../Managers/EnemyManager';
import { EnemyController } from '../Enemy/EnemyController';
import { Teammate } from '../Utils/Teammate';
const { ccclass, property } = _decorator;

/**
 * 门组件
 * 继承自Building，根据玩家和队友的距离自动开关门
 */
@ccclass('Door')
export class Door extends Building {
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
    public checkProximity(playerTransform: Node | null): void {
        // 如果门已永久打开
        if (this._isPermanentlyOpen) {
            if (!this._isDoorOpen) {
                this.openTheDoor();
            }
            return;
        }

        let shouldOpen = false;
        const detectionRadiusSqr = this._detectionRadius * this._detectionRadius;

        // 1. 检测队友
        const teammates = TeamManager.Instance!.getMinions();
        if (this.hasTeammateInRange(teammates[0], detectionRadiusSqr) ||
            this.hasTeammateInRange(teammates[1], detectionRadiusSqr)) {
            shouldOpen = true;
            this._isPermanentlyOpen = true;
        }
        // 2. 如果没有被队友永久打开，再检测玩家
        else if (playerTransform) {
            if (Vec3.squaredDistance(this.node.getWorldPosition(), playerTransform.getWorldPosition()) <= detectionRadiusSqr) {
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
            const enemyRadiusSqr = (this._detectionRadius * 0.5) * (this._detectionRadius * 0.5);
            const enemies = EnemyManager.Instance.getMinions();
            this.tryBeHitByEnemy(enemies[0], enemyRadiusSqr);
            this.tryBeHitByEnemy(enemies[1], enemyRadiusSqr);
        }
    }

    private hasTeammateInRange(teammates: Teammate[], radiusSqr: number): boolean {
        const doorPos = this.node.getWorldPosition();
        for (const teammate of teammates) {
            if (!teammate || !teammate.node.active) continue;
            if (Vec3.squaredDistance(doorPos, teammate.node.getWorldPosition()) <= radiusSqr) {
                return true;
            }
        }
        return false;
    }

    private tryBeHitByEnemy(enemies: EnemyController[], radiusSqr: number): void {
        const doorPos = this.node.getWorldPosition();
        for (const enemy of enemies) {
            if (!enemy || !enemy.node.active) continue;
            if (Vec3.squaredDistance(doorPos, enemy.node.getWorldPosition()) < radiusSqr) {
                this.beHit(enemy.node);
                enemy.releaseToPool();
                return;
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
