/** 命令输出解析工具 - 前端解析查看命令 / 电源域命令的 stdout */

/** 去掉 ANSI 转义序列（SOL / 终端输出里常见） */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

/** 把一段文本拆成值序列（支持中英文逗号与空白分隔），非数字项为 null 以保持位置对应 */
function splitValues(text: string): (number | null)[] {
  return text
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => {
      const num = Number(s);
      return Number.isNaN(num) ? null : num;
    });
}

/** 提取文本里所有「逗号分隔的数字序列」 */
function findNumberRuns(text: string): (number | null)[][] {
  const re = /-?\d+(?:\.\d+)?(?:\s*[,，]\s*-?\d+(?:\.\d+)?)+/g;
  const runs: (number | null)[][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    runs.push(splitValues(m[0]));
  }
  return runs;
}

/**
 * 从命令输出中解析值序列。
 *
 * 命令通常会在前面打印执行过程（mdbctl / SOL 会话 / power 读数等），
 * 真正的结果在最后一行，例如 "0.00,3.25,12.00,26.50,60.75,14.88"。
 * 旧实现直接拆分整个 stdout，会把日志里的数字当成前几个结果，
 * 导致前端显示一堆 0 或整体错位。
 *
 * 解析顺序：
 *   1. 若给定 expectedCount，取最后一个「值个数正好等于 expectedCount」的数字序列
 *   2. 否则取最后一个「至少两个值」的数字序列
 *   3. 退化为最后一条整行都是数字的行
 *   4. 再退化为最后一条至少含一个数字的行（单值结果）
 */
export function parseCommandValues(stdout: string, expectedCount?: number): (number | null)[] {
  const text = stripAnsi(stdout || '');
  if (!text.trim()) return [];

  const runs = findNumberRuns(text);

  if (expectedCount && expectedCount > 0) {
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].length === expectedCount) return runs[i];
    }
  }

  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].length >= 2) return runs[i];
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 最后一条整行均为数字、且至少两个值的行
  for (let i = lines.length - 1; i >= 0; i--) {
    const values = splitValues(lines[i]);
    if (values.length >= 2 && values.every((v) => v !== null)) return values;
  }

  // 最后一条至少含一个数字的行
  for (let i = lines.length - 1; i >= 0; i--) {
    const values = splitValues(lines[i]);
    if (values.some((v) => v !== null)) return values;
  }

  return [];
}
