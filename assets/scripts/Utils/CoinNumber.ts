import { _decorator, Component, Label, Node, Sprite } from 'cc';
import { CoinTrigger } from '../Core/CoinTrigger';
const { ccclass, property } = _decorator;

/**
 * 金币数量显示组件
 * 显示CoinTrigger的剩余金币数量和进度
 */
@ccclass('CoinNumber')
export class CoinNumber extends Component {
    private coinCountLabel: Label | null = null;
    private coinTrigger: CoinTrigger | null = null;
    private coinSprite: Sprite | null = null;

    protected onLoad(): void {
        // 获取子节点中的Label组件
        this.coinCountLabel = this.getComponentInChildren(Label);

        // 递归查找名为"遮罩"的后代节点获取Sprite组件
        const maskNode = this.findChildByName(this.node, '遮罩');
        if (maskNode) {
            this.coinSprite = maskNode.getComponent(Sprite);
        }

        // 获取同节点上的CoinTrigger组件
        this.coinTrigger = this.getComponent(CoinTrigger);

        if (!this.coinTrigger) {
            console.warn(`CoinNumber: CoinTrigger component not found on node ${this.node.name}`);
        }
    }

    protected update(dt: number): void {
        if (!this.coinTrigger || !this.coinCountLabel) {
            return;
        }

        // 更新文本显示为剩余金币数量
        const remainingCount = this.coinTrigger.getRemainingCount();
        this.coinCountLabel.string = remainingCount.toString();

        // 更新Sprite的显示状态和填充进度
        if (this.coinSprite) {
            // 控制Sprite的显示/隐藏（剩余数量>0时显示）
            this.coinSprite.node.active = remainingCount > 0;

            // 如果Sprite类型是FILLED，更新fillRange来显示进度
            if (this.coinSprite.type === Sprite.Type.FILLED) {
                const currentCount = this.coinTrigger.getCurrentCount();
                const triggerCount = this.coinTrigger.triggerCount;

                if (triggerCount > 0) {
                    // 计算填充比例（当前数量/触发总数）
                    this.coinSprite.fillRange = currentCount / triggerCount;
                } else {
                    this.coinSprite.fillRange = 0;
                }
            }
        }
    }

    private findChildByName(root: Node, name: string): Node | null {
        for (const child of root.children) {
            if (child.name === name) return child;
            const found = this.findChildByName(child, name);
            if (found) return found;
        }
        return null;
    }
}
