/**
 * 全局变量和枚举
 */
export class GlobalVariables {
    /**
     * 游戏阶段枚举
     */
    public static Stage = {
        Basic: 0,
        TowerDefense1: 1,
        TowerDefense2: 2,
        TowerAndFence1: 3,
        TowerAndFence2: 4,
        Mine1: 5,
        MineCollect: 6,
        Mine2: 7,
        Fence1: 8,
        Cavalry1: 9,
        Cavalry2: 10,
        CavalrySpeedUp: 11
    } as const;

    public static CurrentStage: number = GlobalVariables.Stage.Basic;

    /**
     * 游戏结果类型枚举
     */
    public static GameResultType = {
        Victory: 0,
        Defeat: 1,
        None: 2
    } as const;

    public static GameResult: number = GlobalVariables.GameResultType.None;

    /**
     * 特效类型枚举
     */
    public static EffectType = {
        None: -1,
        HitEffect: 0,
        FireEffect: 1
    } as const;

    // 击中特效计数
    public static activeHitEffectsCount: number = 0;
    public static readonly maxHitEffects: number = 10;

    // 开火特效计数
    public static activeMuzzleEffectsCount: number = 0;
    public static readonly maxMuzzleEffects: number = 10;

    // 小兵碰撞标记
    public static IsLeftMinionCollision: boolean = false;
    public static IsRightMinionCollision: boolean = false;
}

// 为了类型安全，导出类型定义
export type Stage = typeof GlobalVariables.Stage[keyof typeof GlobalVariables.Stage];
export type GameResultType = typeof GlobalVariables.GameResultType[keyof typeof GlobalVariables.GameResultType];
export type EffectType = typeof GlobalVariables.EffectType[keyof typeof GlobalVariables.EffectType];
