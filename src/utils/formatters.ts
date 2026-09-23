/** 数值格式化工具 */

/** 格式化电压 */
export function formatVoltage(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return 'NA';
  return v >= 1 ? `${v.toFixed(1)}V` : `${(v * 1000).toFixed(0)}mV`;
}

/** 格式化电流 */
export function formatCurrent(a: number | null | undefined): string {
  if (a === null || a === undefined || Number.isNaN(a)) return 'NA';
  return a >= 1 ? `${a.toFixed(1)}A` : `${(a * 1000).toFixed(0)}mA`;
}

/** 格式化功率 */
export function formatPower(w: number | null | undefined): string {
  if (w === null || w === undefined || Number.isNaN(w)) return 'NA';
  return w >= 1000 ? `${(w / 1000).toFixed(2)}kW` : `${w.toFixed(1)}W`;
}

/** 格式化效率 */
export function formatEfficiency(e: number | null | undefined): string {
  if (e === null || e === undefined || Number.isNaN(e)) return 'NA';
  return `${e.toFixed(1)}%`;
}

/** 格式化温度 */
export function formatTemperature(t: number | null | undefined): string {
  if (t === null || t === undefined || Number.isNaN(t)) return 'NA';
  return `${t.toFixed(1)}°C`;
}

/** 格式化转速 */
export function formatRPM(rpm: number | null | undefined): string {
  if (rpm === null || rpm === undefined || Number.isNaN(rpm)) return 'NA';
  return `${rpm} RPM`;
}

/** 温度颜色映射 */
export function getTemperatureColor(temp: number): string {
  if (Number.isNaN(temp)) return '#999';
  if (temp < 40) return '#52c41a';
  if (temp < 60) return '#faad14';
  if (temp < 80) return '#ff7a45';
  return '#ff4d4f';
}

/** 效率颜色映射 */
export function getEfficiencyColor(eff: number): string {
  if (Number.isNaN(eff)) return '#999';
  if (eff >= 95) return '#52c41a';
  if (eff >= 90) return '#73d13d';
  if (eff >= 85) return '#faad14';
  return '#ff4d4f';
}

/** 损耗颜色映射 */
export function getLossColor(lossPercent: number): string {
  if (Number.isNaN(lossPercent)) return '#999';
  if (lossPercent < 1) return '#52c41a';
  if (lossPercent < 3) return '#faad14';
  return '#ff4d4f';
}

/** 判断温度是否异常 (>= 80°C 为异常/红色警告) */
export function isTemperatureAbnormal(temp?: number | null): boolean {
  return temp !== undefined && temp !== null && !Number.isNaN(temp) && temp >= 80;
}

/** 判断温度是否为黄色警告 (60-79°C 为黄色警告) */
export function isTemperatureWarning(temp?: number | null): boolean {
  return temp !== undefined && temp !== null && !Number.isNaN(temp) && temp >= 60 && temp < 80;
}

/** 获取温度警告级别: 'normal' | 'warning' | 'critical' */
export function getTemperatureLevel(temp?: number | null): 'normal' | 'warning' | 'critical' {
  if (temp === undefined || temp === null || Number.isNaN(temp)) return 'normal';
  if (temp >= 80) return 'critical';
  if (temp >= 60) return 'warning';
  return 'normal';
}

/** 判断效率是否异常 (< 85% 为异常/红色警告) */
export function isEfficiencyAbnormal(eff?: number): boolean {
  return eff !== undefined && eff !== null && !Number.isNaN(eff) && eff < 85;
}

/** 判断效率是否为黄色警告 (85-89% 为黄色警告) */
export function isEfficiencyWarning(eff?: number): boolean {
  return eff !== undefined && eff !== null && !Number.isNaN(eff) && eff >= 85 && eff < 90;
}

/** 获取效率警告级别: 'normal' | 'warning' | 'critical' */
export function getEfficiencyLevel(eff?: number | null): 'normal' | 'warning' | 'critical' {
  if (eff === undefined || eff === null || Number.isNaN(eff)) return 'normal';
  if (eff < 85) return 'critical';
  if (eff < 90) return 'warning';
  return 'normal';
}

/** 模块类型大写缩写 */
const typeUpperMap: Record<string, string> = {
  ac: 'AC', psu: 'PSU', vr: 'VR', psip: 'PSIP', busbar: 'BUSBAR',
  cpu: 'CPU', memory: 'MEM', fan: 'FAN', disk: 'DISK',
  io: 'IO', card: 'CARD', sensor: 'SENSOR', mgmtBoard: 'MGMT', chassis: 'CHASSIS',
  thermometer: 'THERM', custom: 'CUSTOM',
};

/** 获取节点显示标签：有别名时显示 "别名 (类型)"，否则显示原 label */
export function getNodeDisplayLabel(data: { label?: string; displayAlias?: string; nodeType?: string }): string {
  if (data.displayAlias && data.nodeType) {
    const typeTag = typeUpperMap[data.nodeType] || data.nodeType.toUpperCase();
    return `${data.displayAlias} (${typeTag})`;
  }
  return data.label || data.nodeType || '';
}

/** 字段阈值范围 */
export interface FieldThresholdRange {
  min: number;
  max: number;
  color: string;
  label?: string;
}

/** 字段阈值配置 */
export interface FieldThresholdConfig {
  fieldKey: string;
  ranges: FieldThresholdRange[];
}

/** 根据字段阈值获取颜色 */
export function getFieldThresholdColor(
  value: number | null | undefined,
  thresholds?: FieldThresholdConfig[]
): string | undefined {
  if (value === null || value === undefined || Number.isNaN(value) || !thresholds) return undefined;
  
  for (const threshold of thresholds) {
    for (const range of threshold.ranges) {
      if (value >= range.min && value < range.max) {
        return range.color;
      }
    }
  }
  return undefined;
}

/** 根据字段名和节点类型获取阈值颜色（支持自定义配置或默认配置） */
export function getThresholdColorForField(
  value: number | null | undefined,
  fieldKey: string,
  customThresholds?: FieldThresholdConfig[],
  defaultThresholds?: Record<string, FieldThresholdConfig[]>
): string | undefined {
  // 优先使用自定义阈值
  if (customThresholds) {
    const config = customThresholds.find(t => t.fieldKey === fieldKey);
    if (config) {
      for (const range of config.ranges) {
        if (value !== null && value !== undefined && !Number.isNaN(value) && value >= range.min && value < range.max) {
          return range.color;
        }
      }
    }
  }
  
  // 回退到默认阈值
  if (defaultThresholds) {
    const configs = Object.values(defaultThresholds).flat();
    const config = configs.find(t => t.fieldKey === fieldKey);
    if (config) {
      for (const range of config.ranges) {
        if (value !== null && value !== undefined && !Number.isNaN(value) && value >= range.min && value < range.max) {
          return range.color;
        }
      }
    }
  }
  
  return undefined;
}
