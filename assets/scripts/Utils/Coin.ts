import { _decorator, Component, Node, Vec3, tween, Tween } from 'cc';
import { EventCenter } from '../Core/EventCenter';
import { CoinManager } from '../Managers/CoinManager';
import { PoolManager } from '../Managers/PoolManager';
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
    public spawnOwner: Node | null = null;

    // Private state
    private _currentTween: Tween<Node> | null = null;
    private readonly _autoDestroyCallback = () => {
        this.autoDestroy();
    };

    protected onEnable() {
        // Register coin after 1 second
        this.scheduleOnce(() => {
            this.registerCoin();
        }, 1.0);
    }

    protected onDisable() {
        // Clean up when disabled
        this.resetState();
    }

    private registerCoin() {
        CoinManager.Instance?.registerCoin(this);
    }

    /**
     * Drop coin on ground with bounce animation
     * @param pos Target world position to drop to
     */
    public dropOnGround(pos: Vec3) {
        // Stop any existing auto-destroy timer
        this.unschedule(this._autoDestroyCallback);

        // Start new auto-destroy timer
        this.scheduleOnce(this._autoDestroyCallback, this.lifeTime);

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

        // Jump animation with bounce (use world position throughout, matching Unity DOJump)
        const jumpHeight = 3.5;
        const startPos = this.node.getWorldPosition().clone();

        this._currentTween = tween(this.node)
            .to(duration, {}, {
                onUpdate: (target: Node, ratio: number) => {
                    const x = startPos.x + (pos.x - startPos.x) * ratio;
                    const z = startPos.z + (pos.z - startPos.z) * ratio;
                    // Parabolic jump curve
                    const y = pos.y + jumpHeight * (4 * ratio * (1 - ratio));
                    target.setWorldPosition(x, y, z);
                }
            })
            .call(() => {
                // Perform bounce sequence
                this.performBounce(pos);
            })
            .start();
    }

    private performBounce(finalPos: Vec3) {
        const firstBounceHeight = 0.6;
        const secondBounceHeight = 0.3;
        const firstDuration = 0.1;
        const secondDuration = 0.05;
        const totalDuration = (firstDuration + secondDuration) * 2;

        this._currentTween = tween(this.node)
            .to(totalDuration, {}, {
                onUpdate: (target: Node, ratio: number) => {
                    // Calculate which phase of bounce we're in
                    const phase1End = firstDuration / totalDuration;
                    const phase2End = (firstDuration * 2) / totalDuration;
                    const phase3End = (firstDuration * 2 + secondDuration) / totalDuration;

                    let y: number;
                    if (ratio <= phase1End) {
                        // First bounce up
                        const t = ratio / phase1End;
                        y = finalPos.y + firstBounceHeight * Math.sin(t * Math.PI / 2);
                    } else if (ratio <= phase2End) {
                        // First bounce down
                        const t = (ratio - phase1End) / (phase2End - phase1End);
                        y = finalPos.y + firstBounceHeight * Math.cos(t * Math.PI / 2);
                    } else if (ratio <= phase3End) {
                        // Second bounce up
                        const t = (ratio - phase2End) / (phase3End - phase2End);
                        y = finalPos.y + secondBounceHeight * Math.sin(t * Math.PI / 2);
                    } else {
                        // Second bounce down
                        const t = (ratio - phase3End) / (1 - phase3End);
                        y = finalPos.y + secondBounceHeight * Math.cos(t * Math.PI / 2);
                    }

                    target.setWorldPosition(finalPos.x, y, finalPos.z);
                }
            })
            .call(() => {
                this.node.setWorldPosition(finalPos);
                this.isMoving = false;
            })
            .start();
    }

    private autoDestroy() {
        if (Math.random() > this.stayProbability) {
            // Stop all tweens
            if (this._currentTween) {
                this._currentTween.stop();
                this._currentTween = null;
            }

            // Reset state
            this.resetState();

            // Deactivate (will be handled by object pool)
            this.node.active = false;

            PoolManager.Instance?.pushObj('Coin', this.node);
        }
    }

    public startMove() {
        this.isMoving = true;

        // Stop auto-destroy timer
        this.unschedule(this._autoDestroyCallback);
    }

    public stopMove() {
        // Delay stop
        this.scheduleOnce(() => {
            this.isMoving = false;
        }, this.stopMoveDelay);
    }

    public resetState() {
        this.isMoving = false;
        this.isBeingDelivered = false;
        this.isBearByGenerator = false;

        // Stop all tweens
        if (this._currentTween) {
            this._currentTween.stop();
            this._currentTween = null;
        }

        // Stop auto-destroy timer
        this.unschedule(this._autoDestroyCallback);
    }
}
