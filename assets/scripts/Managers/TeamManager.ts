import { _decorator, Component, Vec3 } from 'cc';
import { Teammate } from '../Utils/Teammate';
const { ccclass } = _decorator;

/**
 * 队友管理器
 * 管理所有队友实例
 */
@ccclass('TeamManager')
export class TeamManager extends Component {
    private static _instance: TeamManager | null = null;

    public static get Instance(): TeamManager | null {
        return this._instance;
    }

    public teammates: Teammate[] = [];

    protected onLoad(): void {
        if (TeamManager._instance !== null && TeamManager._instance !== this) {
            this.node.destroy();
            return;
        }
        TeamManager._instance = this;
    }

    protected update(dt: number): void {
        const minions = this.getMinions();

        // 更新第一个左侧队友的碰撞
        if (minions[0].length > 0) {
            minions[0][0].updateCollision();
        }

        // 更新第一个右侧队友的碰撞
        if (minions[1].length > 0) {
            minions[1][0].updateCollision();
        }
    }

    /**
     * 注册队友
     */
    public registerTeammate(teammate: Teammate): void {
        if (this.teammates.indexOf(teammate) === -1) {
            this.teammates.push(teammate);
        }
    }

    /**
     * 注销队友
     */
    public unregisterTeammate(teammate: Teammate): void {
        const index = this.teammates.indexOf(teammate);
        if (index !== -1) {
            this.teammates.splice(index, 1);
        }
    }

    /**
     * 获取范围内的队友
     */
    public getTeammatesInRange(center: Vec3, range: number): Teammate[] {
        const teammatesInRange: Teammate[] = [];
        const rangeSqr = range * range;

        for (const target of this.teammates) {
            if (target && target.node.active) {
                const disSqr = Vec3.squaredDistance(center, target.node.getPosition());
                if (disSqr <= rangeSqr) {
                    teammatesInRange.push(target);
                }
            }
        }

        return teammatesInRange;
    }

    /**
     * 获取左右两侧的小兵
     * @returns [左侧队友列表, 右侧队友列表]
     */
    public getMinions(): [Teammate[], Teammate[]] {
        const leftTargets: Teammate[] = [];
        const rightTargets: Teammate[] = [];

        for (const target of this.teammates) {
            if (target.isLeftMinion) {
                leftTargets.push(target);
            } else {
                rightTargets.push(target);
            }
        }

        return [leftTargets, rightTargets];
    }

    protected onDestroy(): void {
        if (TeamManager._instance === this) {
            TeamManager._instance = null;
        }
    }
}
