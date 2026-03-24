import { _decorator } from 'cc';

/**
 * 事件中心 - 单例模式的事件管理器
 */
export class EventCenter {
    private static _instance: EventCenter | null = null;
    private eventListeners: Map<string, Array<(...args: any[]) => void>> = new Map();

    private constructor() {}

    public static get Instance(): EventCenter {
        if (!this._instance) {
            this._instance = new EventCenter();
        }
        return this._instance;
    }

    /**
     * 添加事件监听
     */
    public AddEventListener(eventName: string, callback: (...args: any[]) => void): void {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName)!.push(callback);
    }

    /**
     * 移除事件监听
     */
    public RemoveEventListener(eventName: string, callback: (...args: any[]) => void): void {
        if (!this.eventListeners.has(eventName)) return;

        const listeners = this.eventListeners.get(eventName)!;
        const index = listeners.indexOf(callback);
        if (index !== -1) {
            listeners.splice(index, 1);
        }
    }

    /**
     * 触发事件
     */
    public eventTrigger(eventName: string, ...args: any[]): void {
        if (!this.eventListeners.has(eventName)) return;

        const listeners = this.eventListeners.get(eventName)!;
        listeners.forEach(callback => callback(...args));
    }

    /**
     * 清空所有事件监听
     */
    public clear(): void {
        this.eventListeners.clear();
    }
}
