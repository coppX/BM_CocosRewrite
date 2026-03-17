import { _decorator, Component } from 'cc';
import { Coin } from '../Utils/Coin';
const { ccclass } = _decorator;

/**
 * 金币管理器
 */
@ccclass('CoinManager')
export class CoinManager extends Component {
    private static _instance: CoinManager | null = null;

    public static get Instance(): CoinManager | null {
        return this._instance;
    }

    public AvailableCoins: Coin[] = [];

    protected onLoad(): void {
        if (CoinManager._instance !== null && CoinManager._instance !== this) {
            this.node.destroy();
            return;
        }
        CoinManager._instance = this;
    }

    protected onDestroy(): void {
        if (CoinManager._instance === this) {
            CoinManager._instance = null;
        }
    }

    /**
     * 注册金币
     */
    public RegisterCoin(coin: Coin): void {
        if (!this.AvailableCoins.includes(coin)) {
            this.AvailableCoins.push(coin);
        }
    }

    /**
     * 注销金币
     */
    public UnregisterCoin(coin: Coin): void {
        const index = this.AvailableCoins.indexOf(coin);
        if (index !== -1) {
            this.AvailableCoins.splice(index, 1);
        }
    }
}
