import { _decorator, Component, UITransform, Vec3, view } from 'cc';
const { ccclass, property } = _decorator;

/**
 * UI适配组件
 * 根据屏幕方向自动调整UI缩放
 */
@ccclass('UIAdaptation')
export class UIAdaptation extends Component {
    @property({
        tooltip: '最长边阈值'
    })
    public longestSideThreshold: number = 540;

    @property({
        tooltip: '小屏幕缩放值'
    })
    public smallScale: number = 0.5;

    @property({
        tooltip: '大屏幕缩放值'
    })
    public largeScale: number = 1;

    @property({ type: [UITransform] })
    public targetUITransforms: UITransform[] = [];

    protected start(): void {
        if (!this.targetUITransforms || this.targetUITransforms.length === 0) {
            console.error('UIAdaptation: No UITransforms assigned');
            return;
        }

        this.adaptUI();
    }

    protected update(dt: number): void {
        this.adaptUI();
    }

    private adaptUI(): void {
        const visibleSize = view.getVisibleSize();

        if (visibleSize.width <= visibleSize.height) {
            // 竖屏
            this.applyScale(this.smallScale);
        } else {
            // 横屏
            this.applyScale(this.largeScale);
        }
    }

    private applyScale(scale: number): void {
        for (const uiTransform of this.targetUITransforms) {
            if (uiTransform) {
                uiTransform.node.setScale(new Vec3(scale, scale, 1));
            }
        }
    }
}
