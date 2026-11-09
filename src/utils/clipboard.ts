/**
 * 剪贴板工具
 *
 * navigator.clipboard 仅在安全上下文（HTTPS 或 localhost）可用，
 * 通过 HTTP + IP 访问（如 http://141.61.5.137:5173）时它是 undefined，
 * 直接调用会抛错。这里统一封装：优先用 Clipboard API，不可用时回退到
 * 隐藏 textarea + document.execCommand('copy')。
 */

/** 回退方案：隐藏 textarea + execCommand */
function fallbackCopy(text: string): boolean {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // 避免页面滚动/闪烁
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.left = '-1000px';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** 复制文本到剪贴板，返回是否成功 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  // 安全上下文才使用 Clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒绝等情况，继续走回退方案
    }
  }

  return fallbackCopy(text);
}

/** 触发浏览器下载文本文件 */
export function downloadTextFile(content: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** 生成带时间戳的导出文件名，如 shell-2026-11-09_12-30-00.log */
export function buildTimestampedFilename(prefix: string, ext: string): string {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace('T', '_')
    .replace(/:/g, '-');
  return `${prefix}-${stamp}.${ext}`;
}
