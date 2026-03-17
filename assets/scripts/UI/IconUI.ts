import { _decorator, Component, Label, Color, Vec3, tween } from 'cc';
import { PlayerController } from '../Player/PlayerController';
const { ccclass } = _decorator;

/**
 * 图标UI组件
 * 显示金币数量并播放增减动画
 */
@ccclass('IconUI')
export class IconUI extends Component {
    private _coinText: Label | null = null;
    private _coinCollection: Component | null = null;
    private _lastCoinCount: number = -1;

    private _normalColor: Color = new Color(255, 255, 255);
    private _greenColor: Color = new Color(51, 255, 51);
    private _redColor: Color = new Color(255, 51, 51);
    private _normalScale: Vec3 = new Vec3(1, 1, 1);
    private _scaleUp: number = 1.3;
    private _animTime: number = 0.18;

    protected onLoad(): void {
        // 查找Label组件
        this._coinText = this.getComponentInChildren(Label);
        if (this._coinText) {
            this._normalColor = this._coinText.color.clone();
            this._normalScale = this._coinText.node.scale.clone();
        }
    }

    protected start(): void {
        // 查找PlayerController
        const player = PlayerController.Instance;
        if (player) {
            // TODO: 获取CoinCollection组件
            // this._coinCollection = player.getComponent('CoinCollection');
        } else {
            console.error('IconUI: 场景中未找到PlayerController');
            this.enabled = false;
        }
    }

    protected update(dt: number): void {
        if (this._coinCollection && this._coinText) {
            // TODO: 获取金币数量
            // const coinCount = (this._coinCollection as any).getCoinCount();
            const coinCount = 0;

            this._coinText.string = coinCount.toString();

            if (this._lastCoinCount !== -1 && coinCount !== this._lastCoinCount) {
                if (coinCount > this._lastCoinCount) {
                    this.playIncreaseAnim();
                } else {
                    this.playDecreaseAnim();
                }
            }

            this._lastCoinCount = coinCount;
        }
    }

    /**
     * 播放增加动画
     */
    private playIncreaseAnim(): void {
        if (!this._coinText) return;

        const textNode = this._coinText.node;
        this._coinText.color = this._greenColor;

        const end = this._normalScale.clone().multiplyScalar(this._scaleUp);

        tween(textNode)
            .to(this._animTime, { scale: end })
            .to(this._animTime, { scale: this._normalScale })
            .call(() => {
                if (this._coinText) {
                    this._coinText.color = this._normalColor;
                }
            })
            .start();
    }

    /**
     * 播放减少动画
     */
    private playDecreaseAnim(): void {
        if (!this._coinText) return;

        this._coinText.color = this._redColor;

        setTimeout(() => {
            if (this._coinText) {
                this._coinText.color = this._normalColor;
            }
        }, this._animTime * 1.2 * 1000);
    }
}
