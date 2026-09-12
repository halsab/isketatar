export function assertStructure(value: unknown, code: string) {
  type Frame = { value: Record<string, unknown> | unknown[]; keys: string[] | null; index: number; depth: number };
  const stack: Frame[] = [];
  function enter(item: unknown, depth: number, key?: string | number) {
    if (depth > 32 || typeof item === 'string' && (item.length > 16384 || key === 'text' && item.length > 4096)) throw new Error(code);
    if (!item || typeof item !== 'object') return;
    const array = Array.isArray(item);
    const keys = array ? null : Object.keys(item);
    if (array ? item.length > 200000 : keys!.length > 64) throw new Error(code);
    stack.push({ value: item as Frame['value'], keys, index: 0, depth });
  }
  enter(value, 0);
  // Один кадр на уровень: широкий недоверенный массив не раздувает стек обхода.
  while (stack.length) {
    const frame = stack[stack.length - 1]!;
    const length = frame.keys?.length ?? (frame.value as unknown[]).length;
    if (frame.index === length) { stack.pop(); continue; }
    const key = frame.keys ? frame.keys[frame.index++]! : frame.index++;
    if (typeof key === 'string' && ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(code);
    enter(Reflect.get(frame.value, key), frame.depth + 1, key);
  }
}
