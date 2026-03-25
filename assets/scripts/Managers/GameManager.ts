import { _decorator, Component, Node, MeshRenderer, utils, primitives, Material } from 'cc';
const { ccclass } = _decorator;

export const GameState = {
    WaitingToStart: 0,
    Playing: 1,
    GameOver: 2
} as const;

export type GameStateValue = typeof GameState[keyof typeof GameState];

/**
 * 游戏管理器
 */
@ccclass('GameManager')
export class GameManager extends Component {
    private static _instance: GameManager | null = null;

    public static get Instance(): GameManager | null {
        return this._instance;
    }

    /**
     * 游戏状态枚举
     */
    public static get GameState() {
        return GameState;
    }

    private _currentState: GameStateValue = GameState.WaitingToStart;
    private _playerHealth: number = 100;
    private _gameStateChangedListeners: Set<(newState: GameStateValue) => void> = new Set();

    public addGameStateChangedListener(listener: (newState: GameStateValue) => void): void {
        this._gameStateChangedListeners.add(listener);
    }

    public removeGameStateChangedListener(listener: (newState: GameStateValue) => void): void {
        this._gameStateChangedListeners.delete(listener);
    }

    public get CurrentState(): GameStateValue {
        return this._currentState;
    }

    public get PlayerHealth(): number {
        return this._playerHealth;
    }

    public set PlayerHealth(value: number) {
        this._playerHealth = value;
        if (this._playerHealth <= 0) {
            this.setGameState(GameState.GameOver);
        }
    }

    protected onLoad(): void {
        if (GameManager._instance !== null && GameManager._instance !== this) {
            this.node.destroy();
            return;
        }
        GameManager._instance = this;
    }

    protected start(): void {
        console.log('✅ GameManager: start开始');
    }

    protected onDestroy(): void {
        if (GameManager._instance === this) {
            GameManager._instance = null;
        }
    }

    private setGameState(newState: GameStateValue): void {
        if (this._currentState !== newState) {
            this._currentState = newState;
            for (const listener of this._gameStateChangedListeners) {
                listener(newState);
            }
        }
    }

    /**
     * 开始游戏
     */
    public startGame(): void {
        this._playerHealth = 100;
        this.setGameState(GameState.Playing);
        // TODO: AudioManager.Instance?.PlayBGM();
    }

    /**
     * 游戏结束
     */
    public gameOver(): void {
        // TODO: AudioManager.Instance?.StopBGM();
        this.setGameState(GameState.GameOver);
    }

    /**
     * 等待开始
     */
    public waitingToStart(): void {
        this.setGameState(GameState.WaitingToStart);
    }
}
