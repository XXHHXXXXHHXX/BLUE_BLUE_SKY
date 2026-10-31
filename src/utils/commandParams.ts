/** 命令占位符工具 - 供前端（查看配置编辑）与后端（命令渲染）共享使用 */

/**
 * 从命令模板中提取 {name} 占位符参数名列表（按出现顺序、去重）。
 * 例如 "ssh {user}@{ip}:{password} hello" → ['user', 'ip', 'password']
 */
export function extractCommandParams(command: string): string[] {
  if (!command) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  const re = /\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(command)) !== null) {
    const name = match[1].trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/**
 * 用参数值替换命令模板中的 {name} 占位符。
 * 未提供的参数保留原占位符（便于排查）。
 */
export function renderCommand(command: string, paramValues: Record<string, string>): string {
  return command.replace(/\{([^{}]+)\}/g, (raw, name: string) => {
    const value = paramValues[name.trim()];
    return value !== undefined && value !== null ? String(value) : raw;
  });
}
