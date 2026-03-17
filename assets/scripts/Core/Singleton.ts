/**
 * 单例模式基类
 * 泛型T必须有无参构造函数
 */
export class Singleton<T> {
    private static _instances: Map<any, any> = new Map();

    public static getInstance<T>(this: new () => T): T {
        const constructor = this as any;

        if (!Singleton._instances.has(constructor)) {
            Singleton._instances.set(constructor, new constructor());
        }

        return Singleton._instances.get(constructor);
    }

    protected constructor() {}
}
