import { lazy, type ComponentType } from 'react';

export function lazyNamed<T, K extends keyof T>(
  loader: () => Promise<T>,
  name: K,
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[name] as ComponentType<any> };
  });
}
