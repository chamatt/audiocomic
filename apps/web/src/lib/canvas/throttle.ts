/** Throttle a function: calls at most once per `wait` ms. Leading + trailing edge. */
export function throttle<T extends (...args: never[]) => void>(
  fn: T,
  wait: number,
): T & { flush: () => void } {
  let lastCall = 0;
  let lastArgs: Parameters<T> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const throttled = ((...args: Parameters<T>) => {
    const now = Date.now();
    lastArgs = args;
    if (now - lastCall >= wait) {
      lastCall = now;
      fn(...args);
      lastArgs = null;
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (lastArgs) {
          lastCall = Date.now();
          fn(...lastArgs);
          lastArgs = null;
        }
      }, wait - (now - lastCall));
    }
  }) as T & { flush: () => void };

  throttled.flush = () => {
    clearTimeout(timer);
    if (lastArgs) {
      fn(...lastArgs);
      lastArgs = null;
    }
  };

  return throttled;
}
