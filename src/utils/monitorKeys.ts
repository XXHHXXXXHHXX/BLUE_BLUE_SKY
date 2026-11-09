/** 监控结果 key 的工具函数
 *
 * 一条监控命令可能展开成多条序列，key 由「命令 id + 序列后缀」组成：
 *   - list 模式：`${cmdId}__col__${i}`
 *   - 串口模式：`${cmdId}__serial__${metric}`
 * 分组展示时需要剥离后缀，还原到原始命令 id。
 */

const SERIES_SUFFIX_RE = /__(?:col__\d+|serial__.+)$/;

/** 剥离序列后缀，返回原始监控命令 id */
export function stripMonitorSeriesSuffix(key: string): string {
  return key.replace(SERIES_SUFFIX_RE, '');
}

/** 取序列后缀部分（用于展示列名），无后缀时返回空串 */
export function monitorSeriesLabel(key: string): string {
  const match = key.match(SERIES_SUFFIX_RE);
  return match ? match[0].replace(/^__/, '') : '';
}
