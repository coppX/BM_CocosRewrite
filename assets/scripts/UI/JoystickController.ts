import { _decorator, Component, Node, Vec2, Vec3, UITransform, EventTouch, EventMouse, Input, input, Canvas } from 'cc';
import { PlayerController } from '../Player/PlayerController';
import { GameManager, GameState } from '../Managers/GameManager';
const { ccclass, property } = _decorator;

/**
 * 虚拟摇杆控制器
 */
@ccclass('JoystickController')
export class JoystickController extends Component {
    private static readonly MOUSE_POINTER_ID = -999;

    @property(Node)
    public joystickBackground: Node | null = null;

    @property(Node)
    public joystickHandle: Node | null = null;

    @property(PlayerController)
    public playerController: PlayerController | null = null;

    private _inputVector: Vec2 = new Vec2();
    private _joystickCenter: Vec2 = new Vec2();
    private _isDragging: boolean = false;
    private _activeTouchId: number = -1;
    private _radius: number = 0;
    private _hasBoundInput: boolean = false;
    private _canvasTransform: UITransform | null = null;

    protected onEnable(): void {
        this.BindInputEvents();
    }

    protected start(): void {
        // this.Hide();

        if (!this.playerController) {
            this.playerController = PlayerController.Instance;
        }

        if (this.joystickBackground) {
            const uiTransform = this.joystickBackground.getComponent(UITransform);
            if (uiTransform) {
                this._radius = uiTransform.width * 0.5;
            }
        }
    }

    protected onDisable(): void {
        this.UnbindInputEvents();
        this.ResetJoystickState();
    }

    protected onDestroy(): void {
        this.UnbindInputEvents();
    }

    private BindInputEvents(): void {
        if (this._hasBoundInput) {
            return;
        }

        // 使用全局触摸事件，避免部分浏览器下节点未收到 TOUCH_START 导致拖拽状态丢失
        input.on(Input.EventType.TOUCH_START, this.OnPointerDown, this);
        input.on(Input.EventType.TOUCH_MOVE, this.OnDrag, this);
        input.on(Input.EventType.TOUCH_END, this.OnPointerUp, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.OnPointerUp, this);

        // 桌面端预览通常产生鼠标事件而不是触摸事件
        input.on(Input.EventType.MOUSE_DOWN, this.OnMouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this.OnMouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this.OnMouseUp, this);

        this._hasBoundInput = true;
    }

    private UnbindInputEvents(): void {
        if (!this._hasBoundInput) {
            return;
        }

        input.off(Input.EventType.TOUCH_START, this.OnPointerDown, this);
        input.off(Input.EventType.TOUCH_MOVE, this.OnDrag, this);
        input.off(Input.EventType.TOUCH_END, this.OnPointerUp, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.OnPointerUp, this);

        input.off(Input.EventType.MOUSE_DOWN, this.OnMouseDown, this);
        input.off(Input.EventType.MOUSE_MOVE, this.OnMouseMove, this);
        input.off(Input.EventType.MOUSE_UP, this.OnMouseUp, this);

        this._hasBoundInput = false;
    }

    private OnPointerDown(event: EventTouch): void {
        if (!GameManager.Instance || GameManager.Instance.CurrentState !== GameState.Playing) {
            return;
        }

        const touchId = event.getID();
        if (this._activeTouchId !== -1 && this._activeTouchId !== touchId) {
            return;
        }

        this._activeTouchId = touchId;
        this._isDragging = true;
        const uiLocation = event.getUILocation();
        this.Show(uiLocation);
        this.UpdateDrag(uiLocation);
    }

    private OnDrag(event: EventTouch): void {
        if (!this.joystickBackground || !this.joystickHandle) {
            return;
        }

        const touchId = event.getID();
        if (!this._isDragging) {
            if (!GameManager.Instance || GameManager.Instance.CurrentState !== GameState.Playing) {
                return;
            }

            // 兼容部分浏览器首帧未触发 TOUCH_START 的情况
            this._activeTouchId = touchId;
            this._isDragging = true;
            this.Show(event.getUILocation());
        }

        if (this._activeTouchId !== touchId) {
            return;
        }

        const uiLocation = event.getUILocation();
        this.UpdateDrag(uiLocation);
    }

    private OnPointerUp(event: EventTouch): void {
        if (this._activeTouchId !== -1 && event.getID() !== this._activeTouchId) {
            return;
        }

        this.ResetJoystickState();
    }

    private OnMouseDown(event: EventMouse): void {
        if (!GameManager.Instance || GameManager.Instance.CurrentState !== GameState.Playing) {
            return;
        }

        if (this._activeTouchId !== -1 && this._activeTouchId !== JoystickController.MOUSE_POINTER_ID) {
            return;
        }

        this._activeTouchId = JoystickController.MOUSE_POINTER_ID;
        this._isDragging = true;
        const uiLocation = event.getUILocation();
        this.Show(uiLocation);
        this.UpdateDrag(uiLocation);
    }

    private OnMouseMove(event: EventMouse): void {
        if (!this._isDragging || this._activeTouchId !== JoystickController.MOUSE_POINTER_ID) {
            return;
        }

        this.UpdateDrag(event.getUILocation());
    }

    private OnMouseUp(_event: EventMouse): void {
        if (this._activeTouchId !== JoystickController.MOUSE_POINTER_ID) {
            return;
        }

        this.ResetJoystickState();
    }

    private UpdateDrag(uiLocation: Vec2): void {
        if (!this.joystickBackground || !this.joystickHandle) {
            return;
        }

        const bgTransform = this.joystickBackground.getComponent(UITransform);
        if (!bgTransform) return;

        const pointerInParent = this.ConvertToJoystickParentSpace(uiLocation);

        // 计算相对于摇杆背景中心的偏移
        const bgPos = this.joystickBackground.getPosition();
        const localPoint = new Vec2(pointerInParent.x - bgPos.x, pointerInParent.y - bgPos.y);

        // 限制在半径内
        const distance = localPoint.length();
        if (distance > this._radius) {
            localPoint.normalize().multiplyScalar(this._radius);
        }

        // 设置手柄位置
        this.joystickHandle.setPosition(localPoint.x, localPoint.y, 0);

        // 计算输入向量
        this._inputVector.set(localPoint.x / this._radius, localPoint.y / this._radius);

        // 更新玩家移动方向：拖拽方向与角色移动方向保持一致
        const moveDirection = new Vec3(this._inputVector.x, 0, -this._inputVector.y);
        if (this.playerController) {
            this.playerController.SetMoveDirection(moveDirection.normalize());
        }
    }

    private ResetJoystickState(): void {
        this._activeTouchId = -1;
        this._isDragging = false;
        this._inputVector.set(0, 0);

        if (this.joystickHandle) {
            this.joystickHandle.setPosition(0, 0, 0);
        }

        if (this.playerController) {
            this.playerController.SetMoveDirection(Vec3.ZERO);
        }

        this.Hide();
    }

    private Show(position: Vec2): void {
        if (!this.joystickBackground || !this.joystickHandle) return;

        const localPos = this.ConvertToJoystickParentSpace(position);
        this._joystickCenter.set(localPos.x, localPos.y);
        this.joystickBackground.active = true;
        this.joystickBackground.setPosition(localPos.x, localPos.y, 0);
        this.joystickHandle.setPosition(0, 0, 0);
    }

    private ConvertToJoystickParentSpace(uiLocation: Vec2): Vec3 {
        if (!this.joystickBackground || !this.joystickBackground.parent) {
            return new Vec3(uiLocation.x, uiLocation.y, 0);
        }

        const parentTransform = this.joystickBackground.parent.getComponent(UITransform);
        if (!parentTransform) {
            return new Vec3(uiLocation.x, uiLocation.y, 0);
        }

        const canvasTransform = this.GetCanvasTransform();
        if (!canvasTransform) {
            return parentTransform.convertToNodeSpaceAR(new Vec3(uiLocation.x, uiLocation.y, 0));
        }

        const canvasSize = canvasTransform.contentSize;
        const canvasAnchor = canvasTransform.anchorPoint;
        const canvasLocalPoint = new Vec3(
            uiLocation.x - canvasSize.width * canvasAnchor.x,
            uiLocation.y - canvasSize.height * canvasAnchor.y,
            0
        );

        const worldPoint = canvasTransform.convertToWorldSpaceAR(canvasLocalPoint);
        return parentTransform.convertToNodeSpaceAR(worldPoint);
    }

    private GetCanvasTransform(): UITransform | null {
        if (this._canvasTransform && this._canvasTransform.isValid) {
            return this._canvasTransform;
        }

        let current: Node | null = this.joystickBackground;
        while (current) {
            if (current.getComponent(Canvas)) {
                this._canvasTransform = current.getComponent(UITransform);
                break;
            }
            current = current.parent;
        }

        return this._canvasTransform;
    }

    private Hide(): void {
        if (this.joystickBackground) {
            this.joystickBackground.active = false;
        }
    }
}
