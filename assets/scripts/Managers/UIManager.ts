import { _decorator, Component, Node, Button, director, EventTouch, input, Input } from 'cc';
import { GameManager } from './GameManager';
import { PoolManager } from './PoolManager';

const { ccclass, property } = _decorator;

/**
 * UIManager - UI管理器
 *
 * 功能：
 * - 管理开始界面、游戏界面、游戏结束界面的显示切换
 * - 监听游戏状态变化并更新UI
 * - 处理按钮点击事件（重试、下载）
 * - 处理屏幕点击开始游戏
 */
@ccclass('UIManager')
export class UIManager extends Component {
    private static readonly STATE_WAITING_TO_START = 0;
    private static readonly STATE_PLAYING = 1;
    private static readonly STATE_GAME_OVER = 2;


    @property({ type: Node, tooltip: '开始界面面板' })
    public startPanel: Node | null = null;

    @property({ type: Node, tooltip: '游戏界面面板' })
    public gamePanel: Node | null = null;

    @property({ type: Node, tooltip: '游戏结束界面面板' })
    public gameOverPanel: Node | null = null;

    @property({ type: Button, tooltip: '重试按钮' })
    public retryButton: Button | null = null;

    @property({ type: Button, tooltip: '下载按钮' })
    public downloadButton: Button | null = null;

    @property({ type: Node, tooltip: '教程文本' })
    public tutorialText: Node | null = null;

    private static _instance: UIManager | null = null;
    private readonly _onGameStateChangedHandler = (newState: number): void => {
        this.onGameStateChanged(newState);
    };

    /**
     * 获取UIManager单例
     */
    public static get Instance(): UIManager | null {
        return UIManager._instance;
    }

    /**
     * 组件加载时调用
     */
    protected onLoad(): void {
        // 单例模式
        if (UIManager._instance != null) {
            this.node.destroy();
            return;
        }
        UIManager._instance = this;
    }

    /**
     * 组件启动时调用
     */
    protected start(): void {
        // 订阅游戏状态变化事件
        if (GameManager.Instance) {
            GameManager.Instance.OnGameStateChanged = this._onGameStateChangedHandler;
        }

        // 绑定按钮点击事件
        // if (this.retryButton) {
        //     this.retryButton.node.on(Button.EventType.CLICK, this.onRetryClicked, this);
        // }
        //
        // if (this.downloadButton) {
        //     this.downloadButton.node.on(Button.EventType.CLICK, this.onDownloadClicked, this);
        // }

        // 显示开始界面
        this.showStartPanel();
    }

    /**
     * 组件销毁时调用
     */
    protected onDestroy(): void {
        // 取消订阅，防止内存泄漏
        if (GameManager.Instance && GameManager.Instance.OnGameStateChanged === this._onGameStateChangedHandler) {
            GameManager.Instance.OnGameStateChanged = null;
        }

        // 清理单例引用
        if (UIManager._instance === this) {
            UIManager._instance = null;
        }
    }

    /**
     * 游戏状态变化回调
     */
    private onGameStateChanged(newState: number): void {
        switch (newState) {
            case UIManager.STATE_WAITING_TO_START:
                this.showStartPanel();
                break;
            case UIManager.STATE_PLAYING:
                this.showGamePanel();
                break;
            case UIManager.STATE_GAME_OVER:
                this.showGameOverPanel();
                break;
        }
    }

    /**
     * 显示开始界面
     */
    private showStartPanel(): void {
        if (this.startPanel) this.startPanel.active = true;
        if (this.gamePanel) this.gamePanel.active = true;
        if (this.gameOverPanel) this.gameOverPanel.active = false;
        if (this.tutorialText) this.tutorialText.active = true;
    }

    /**
     * 显示游戏界面
     */
    private showGamePanel(): void {
        console.log('Game Started');
        if (this.startPanel) this.startPanel.active = false;
        if (this.gamePanel) this.gamePanel.active = true;
        if (this.gameOverPanel) this.gameOverPanel.active = false;
        if (this.tutorialText) this.tutorialText.active = false;
    }

    /**
     * 显示游戏结束界面
     */
    private showGameOverPanel(): void {
        if (this.startPanel) this.startPanel.active = false;
        if (this.gamePanel) this.gamePanel.active = false;
        if (this.gameOverPanel) this.gameOverPanel.active = true;
    }

    /**
     * 重试按钮点击回调
     */
    private onRetryClicked(): void {
        // 重新加载场景
        director.loadScene('MainScene');

        // 清理对象池
        PoolManager.Instance.clear();

        // 重置游戏状态
        if (GameManager.Instance) {
            GameManager.Instance.WaitingToStart();
        }
    }

    /**
     * 下载按钮点击回调
     */
    private onDownloadClicked(): void {
        // 实现下载逻辑
        // 例如：打开应用商店链接
        // window.open('your_app_store_url', '_blank');

        // Luna Playable 特定API
        // Luna.Unity.Playable.InstallFullGame();
        console.log('Download button clicked');
    }

    /**
     * 屏幕点击回调
     */
    public onScreenClicked(): void {
        const gameManager = GameManager.Instance;
        if (!gameManager) {
            return;
        }

        if (gameManager.CurrentState === UIManager.STATE_WAITING_TO_START) {
            gameManager.StartGame();
        }
    }

    /**
     * 每帧更新
     */
    protected update(_deltaTime: number): void {
        // 输入监听已在 onEnable/onDisable 中处理，这里无需每帧轮询。
    }

    /**
     * 组件启用时调用（可选）
     * 注册输入事件监听
     */
    protected onEnable(): void {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    /**
     * 组件禁用时调用（可选）
     * 取消输入事件监听
     */
    protected onDisable(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    /**
     * 触摸开始事件处理
     */
    private onTouchStart(_event: EventTouch): void {
        this.onScreenClicked();
    }
}
