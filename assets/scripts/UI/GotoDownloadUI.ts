import { _decorator, Component, Button } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 下载UI组件
 * 处理游戏下载按钮点击
 */
@ccclass('GotoDownloadUI')
export class GotoDownloadUI extends Component {
    @property(Button)
    public downloadButton: Button | null = null;

    protected start(): void {
        if (this.downloadButton) {
            this.downloadButton.node.on(Button.EventType.CLICK, this.onDownloadClicked, this);
        }
    }

    private onDownloadClicked(): void {
        // TODO: 实现下载逻辑
        // 在Cocos中可以使用 sys.openURL
        // import { sys } from 'cc';
        // sys.openURL('https://play.google.com/store/apps/details?id=com.camelgames.loa');
        console.log('Download button clicked');
    }

    protected onDestroy(): void {
        if (this.downloadButton) {
            this.downloadButton.node.off(Button.EventType.CLICK, this.onDownloadClicked, this);
        }
    }
}
