import { useState } from 'react'
import type { InjectionToken } from 'tsyringe'
import { container } from 'tsyringe'
import { appStore, AppStore as AppStoreClass } from '@/store/app'

/**
 * hooks：创建一个使用依赖注入的对象
 * @param ctor - 类构造函数或 InjectionToken
 * @returns 实例
 */
export function useInjectable<T>(ctor: InjectionToken<T> | (new (...args: never[]) => T)): T {
  // AppStore 直接使用单例，绕过 tsyringe 的 @singleton 装饰器问题
  if (ctor === AppStoreClass) {
    return appStore as unknown as T
  }
  const [instance] = useState(() => container.resolve(ctor as InjectionToken<T>))
  return instance
}
