import { _decorator, Component, Node, Vec3, tween, Tween } from 'cc';
import { EventCenter } from '../Core/EventCenter';
const { ccclass, property } = _decorator;

/**
 * Coin Component
 * 金币组件 - 控制金币的掉落、弹跳动画和生命周期
 */
@ccclass('Coin')
export class Coin extends Component {
    // Lifetime before auto-destruction
    @property
    public lifeTime: number = 2.0;

    @property
    public stayProbability: number = 0.2;

    @property
    public stopMoveDelay: number = 0.1;

    // Public state flags
    public isMoving: boolean = false;
    public isBeingDelivered: boolean = false;
    public isBearByGenerator: boolean = false;

    // Private state
    private _destroyTimeout: number | null = null;
    private _currentTween: Tween<Node> | null = null;

    protected onEnable() {
        // Register coin after 1 second
        this.scheduleOnce(() => {
            this.RegisterCoin();
        }, 1.0);
    }

    protected onDisable() {
        // Clean up when disabled
        this.ResetState();
    }

    private RegisterCoin() {
        // Trigger coin registration event
        EventCenter.Instance.EventTrigger('coin_registered', this);
    }

    /**
     * Drop coin on ground with bounce animation
     * @param pos Target position to drop to
     */
    public DropOnGround(pos: Vec3) {
        // Stop any existing auto-destroy timer
        if (this._destroyTimeout !== null) {
            clearTimeout(this._destroyTimeout);
            this._destroyTimeout = null;
        }

        // Start new auto-destroy timer
        this._destroyTimeout = setTimeout(() => {
            this.AutoDestroy();
        }, this.lifeTime * 1000) as any;

        // Mark coin as moving
        this.isMoving = true;

        // Generate random drop duration
        const duration = Math.random() * 0.2 + 0.1; // 0.1 to 0.3 seconds

        // Stop any existing tweens
        if (this._currentTween) {
            this._currentTween.stop();
        }

        // Rotation animation
        const rotationTween = tween(this.node)
            .by(duration, { eulerAngles: new Vec3(0, 360, 0) })
            .start();

        // Jump animation with bounce
        const jumpHeight = 3.5;
        const startPos = this.node.position.clone();

        this._currentTween = tween(this.node)
            .to(duration, { position: pos }, {
                // Custom easing for jump arc
                onUpdate: (target: Node, ratio: number) => {
                    const x = startPos.x + (pos.x - startPos.x) * ratio;
                    const z = startPos.z + (pos.z - startPos.z) * ratio;
                    // Parabolic jump curve
                    const y = pos.y + jumpHeight * (4 * ratio * (1 - ratio));
                    target.setPosition(x, y, z);
                }
            })
            .call(() => {
                // Perform bounce sequence
                this.PerformBounce(pos);
            })
            .start();
    }

    private PerformBounce(finalPos: Vec3) {
        const firstBounceHeight = 0.6;
        const secondBounceHeight = 0.3;
        const firstDuration = 0.1;
        const secondDuration = 0.05;

        this._currentTween = tween(this.node)
            // First bounce up
            .to(firstDuration, { position: new Vec3(finalPos.x, finalPos.y + firstBounceHeight, finalPos.z) })
            // First bounce down
            .to(firstDuration, { position: finalPos })
            // Second bounce up
            .to(secondDuration, { position: new Vec3(finalPos.x, finalPos.y + secondBounceHeight, finalPos.z) })
            // Second bounce down
            .to(secondDuration, { position: finalPos })
            .call(() => {
                this.isMoving = false;
            })
            .start();
    }

    private AutoDestroy() {
        if (Math.random() > this.stayProbability) {
            // Stop all tweens
            if (this._currentTween) {
                this._currentTween.stop();
                this._currentTween = null;
            }

            // Reset state
            this.ResetState();

            // Trigger destroy event
            EventCenter.Instance.EventTrigger('coin_destroyed', this);

            // Deactivate (will be handled by object pool)
            this.node.active = false;
        }
    }

    public StartMove() {
        this.isMoving = true;

        // Stop auto-destroy timer
        if (this._destroyTimeout !== null) {
            clearTimeout(this._destroyTimeout);
            this._destroyTimeout = null;
        }
    }

    public StopMove() {
        // Delay stop
        this.scheduleOnce(() => {
            this.isMoving = false;
        }, this.stopMoveDelay);
    }

    public ResetState() {
        this.isMoving = false;
        this.isBeingDelivered = false;
        this.isBearByGenerator = false;

        // Stop all tweens
        if (this._currentTween) {
            this._currentTween.stop();
            this._currentTween = null;
        }

        // Stop auto-destroy timer
        if (this._destroyTimeout !== null) {
            clearTimeout(this._destroyTimeout);
            this._destroyTimeout = null;
        }

        // Reset parent
        this.node.setParent(null);
    }
}
