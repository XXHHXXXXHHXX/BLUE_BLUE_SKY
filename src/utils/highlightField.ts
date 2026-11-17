/** 校验失败定位：滚动到并高亮闪烁需要补充的配置区域
 *
 * 用法：给配置容器加 `data-field-key="xxx"`，校验失败时调用
 *   highlightField('monitor')
 * 会把该区域滚动到可视区并闪烁描边，帮助用户在长配置页里找到提示的位置。
 */

/** 高亮动画类名（定义在 src/styles/global.css） */
const FLASH_CLASS = 'field-highlight-flash';
/** 动画时长（与 CSS 中 0.9s × 4 次保持一致，略多一点余量） */
const FLASH_DURATION_MS = 3800;

/** 高亮并滚动到指定配置区域；找不到时静默忽略 */
export function highlightField(fieldKey: string | null | undefined): void {
  if (!fieldKey || typeof document === 'undefined') return;

  const selector = `[data-field-key="${fieldKey.replace(/"/g, '\\"')}"]`;
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) return;

  // 先滚动到可视区中央，避免被固定在顶部/底部的区域挡住
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // 重新触发动画：移除类 → 强制回流 → 再加回
  target.classList.remove(FLASH_CLASS);
  void target.offsetWidth;
  target.classList.add(FLASH_CLASS);

  window.setTimeout(() => {
    target.classList.remove(FLASH_CLASS);
  }, FLASH_DURATION_MS);
}

/** 同时高亮多个区域（例如多个流水线阶段） */
export function highlightFields(fieldKeys: Array<string | null | undefined>): void {
  const keys = fieldKeys.filter((k): k is string => !!k);
  if (keys.length === 0) return;
  keys.forEach((key, index) => {
    // 轻微错开，避免多个区域同时闪烁时视觉上分不清先后
    if (index === 0) highlightField(key);
    else window.setTimeout(() => highlightField(key), index * 120);
  });
}
