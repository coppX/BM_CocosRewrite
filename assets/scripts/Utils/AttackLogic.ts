import { _decorator, Component, Node, Vec3 } from 'cc';
import { Weapon } from '../Weapons/Weapon';
const { ccclass, property } = _decorator;

/**
 * 攻击逻辑组件
 * 处理目标查找和攻击触发
 */
@ccclass('AttackLogic')
export class AttackLogic extends Component {
    @property
    public attackRange: number = 10;

    @property
    public targetTag: string = 'Enemy';

    @property
    public canAttack: boolean = true;

    private _weapon: Weapon | null = null;

    protected onLoad(): void {
        this._weapon = this.getComponent(Weapon);
    }

    protected update(dt: number): void {
        if (this.canAttack && this._weapon) {
            this._weapon.tryAttack();
        }
    }

    /**
     * 查找最近的目标
     */
    public findNearestTarget(useY: boolean): Node | null {
        const searchCenter = this.node.getPosition().clone();
        if (!useY) {
            searchCenter.y = 0;
        }

        return this.getClosestTarget(searchCenter);
    }

    /**
     * 触发一次攻击（由动画事件调用）
     */
    public tryAttackOnce(): void {
        if (this._weapon) {
            this._weapon.onAttackAnimEvent();
        }
    }

    private getClosestTarget(searchCenter: Vec3): Node | null {
        // TODO: 实现目标收集和查找逻辑
        // 需要EnemyManager来获取范围内的敌人
        return null;
    }
}
