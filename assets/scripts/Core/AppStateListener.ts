import { _decorator, Component, director, game } from 'cc';
import { GameManager, GameState } from '../Managers/GameManager';
const { ccclass } = _decorator;

/**
 * 应用程序状态监听器
 * 监听应用的焦点、暂停和退出事件
 */
@ccclass('AppStateListener')
export class AppStateListener extends Component {
    protected onLoad(): void {
        // 监听游戏显示/隐藏事件
        game.on(game.EVENT_SHOW, this.onGameShow, this);
        game.on(game.EVENT_HIDE, this.onGameHide, this);
    }

    protected onDestroy(): void {
        game.off(game.EVENT_SHOW, this.onGameShow, this);
        game.off(game.EVENT_HIDE, this.onGameHide, this);
    }

    private onGameShow(): void {
        if (GameManager.Instance && GameManager.Instance.CurrentState === GameState.Playing) {
            // TODO: 恢复背景音乐
            // AudioManager.Instance?.ResumeBGM();
            director.resume();
        }
    }

    private onGameHide(): void {
        if (GameManager.Instance && GameManager.Instance.CurrentState === GameState.Playing) {
            // TODO: 暂停背景音乐
            // AudioManager.Instance?.PauseBGM();
            director.pause();
        }
    }
}
