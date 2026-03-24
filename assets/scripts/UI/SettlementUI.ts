import { _decorator, Component, Node, Button, director } from 'cc';
import { GlobalVariables } from '../Core/GlobalVariables';
import { PoolManager } from '../Managers/PoolManager';
import { GameManager } from '../Managers/GameManager';
const { ccclass } = _decorator;

/**
 * 结算UI组件
 * 显示游戏结束画面并处理重试/下载按钮
 */
@ccclass('SettlementUI')
export class SettlementUI extends Component {
    private _victoryPanel: Node | null = null;
    private _settlementRetryButton: Button | null = null;
    private _settlementDownloadButton: Button | null = null;

    protected onEnable(): void {
        // 查找胜利Panel
        this._victoryPanel = this.node.getChildByName('Victory');

        // 根据游戏结果显示对应Panel
        if (this._victoryPanel) {
            this._victoryPanel.active = GlobalVariables.GameResult === GlobalVariables.GameResultType.Victory;
        } else {
            console.warn('SettlementUI: 未能找到 Victory');
        }

        // 查找重试和下载按钮
        this._settlementRetryButton = this.findButton('RetryBtn');
        this._settlementDownloadButton = this.findButton('DownloadBtn');

        // 绑定按钮事件
        if (this._settlementRetryButton) {
            this._settlementRetryButton.node.on(Button.EventType.CLICK, this.onSettlementRetryClicked, this);
        }

        if (this._settlementDownloadButton) {
            this._settlementDownloadButton.node.on(Button.EventType.CLICK, this.onSettlementDownloadClicked, this);
        }
    }

    protected onDisable(): void {
        if (this._settlementRetryButton) {
            this._settlementRetryButton.node.off(Button.EventType.CLICK, this.onSettlementRetryClicked, this);
        }

        if (this._settlementDownloadButton) {
            this._settlementDownloadButton.node.off(Button.EventType.CLICK, this.onSettlementDownloadClicked, this);
        }
    }

    private findButton(name: string): Button | null {
        // 先尝试直接查找
        let node = this.node.getChildByName(name);
        if (node) {
            return node.getComponent(Button);
        }

        // 递归查找所有子节点
        const buttons = this.getComponentsInChildren(Button);
        for (const btn of buttons) {
            if (btn.node.name === name) {
                return btn;
            }
        }

        return null;
    }

    private onSettlementRetryClicked(): void {
        // 重新加载主场景
        director.loadScene('MainScene');

        // 清理对象池
        PoolManager.Instance?.clear();

        // 重置游戏状态
        if (GameManager.Instance) {
            GameManager.Instance.waitingToStart();
        }

        GlobalVariables.GameResult = GlobalVariables.GameResultType.None;
    }

    private onSettlementDownloadClicked(): void {
        // TODO: 实现下载逻辑
        // import { sys } from 'cc';
        // sys.openURL('https://play.google.com/store/apps/details?id=com.camelgames.loa');
        console.log('Download button clicked');
    }
}
