/** 自定义 XY 图 - 图表组（单图 / 合并图）的纯函数操作
 *
 * 抽成纯函数便于测试：合并、拆出单个、拆分全部、增删。
 */
import { createDefaultXYChartConfig, type XYChartConfig } from './xyChartShared';

/** 一个图表组：单个配置=普通图表，多个配置=合并图表 */
export interface ChartGroup {
  id: string;
  configs: XYChartConfig[];
}

let idCounter = 0;
/** 生成图表组 id（可注入前缀便于测试） */
export function nextGroupId(prefix = 'xy'): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function createChartGroup(): ChartGroup {
  return { id: nextGroupId(), configs: [createDefaultXYChartConfig()] };
}

/** 把 source 组整体合并进 target 组（source 消失，配置追加到 target 末尾） */
export function mergeGroupList(
  groups: ChartGroup[],
  sourceId: string,
  targetId: string,
): ChartGroup[] {
  if (sourceId === targetId) return groups;
  const source = groups.find((g) => g.id === sourceId);
  const target = groups.find((g) => g.id === targetId);
  if (!source || !target) return groups;
  return groups
    .filter((g) => g.id !== sourceId)
    .map((g) => (g.id === targetId ? { ...g, configs: [...g.configs, ...source.configs] } : g));
}

/** 把合并组里的第 index 个成员拆成独立图表，紧跟原组之后 */
export function splitMemberFromList(
  groups: ChartGroup[],
  groupId: string,
  index: number,
): ChartGroup[] {
  const group = groups.find((g) => g.id === groupId);
  if (!group || index < 0 || index >= group.configs.length) return groups;
  const config = group.configs[index];
  const rest = group.configs.filter((_, i) => i !== index);

  const result: ChartGroup[] = [];
  groups.forEach((g) => {
    if (g.id !== groupId) {
      result.push(g);
      return;
    }
    if (rest.length > 0) result.push({ ...g, configs: rest });
    result.push({ id: nextGroupId(), configs: [config] });
  });
  return result;
}

/** 把合并组的全部成员拆成独立图表 */
export function splitAllFromList(groups: ChartGroup[], groupId: string): ChartGroup[] {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return groups;
  const result: ChartGroup[] = [];
  groups.forEach((g) => {
    if (g.id !== groupId) {
      result.push(g);
      return;
    }
    g.configs.forEach((config) => result.push({ id: nextGroupId(), configs: [config] }));
  });
  return result;
}

/** 更新某个组里第 index 个成员的配置 */
export function updateMemberConfig(
  groups: ChartGroup[],
  groupId: string,
  index: number,
  config: XYChartConfig,
): ChartGroup[] {
  return groups.map((g) =>
    g.id === groupId
      ? { ...g, configs: g.configs.map((c, i) => (i === index ? config : c)) }
      : g,
  );
}

/** 删除图表组（至少保留一个） */
export function removeGroupFromList(groups: ChartGroup[], groupId: string): ChartGroup[] {
  if (groups.length <= 1) return groups;
  return groups.filter((g) => g.id !== groupId);
}

/** 追加一个新的单图组 */
export function appendGroup(groups: ChartGroup[]): ChartGroup[] {
  return [...groups, createChartGroup()];
}

export interface GridItemBox {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 按网格坐标找出被拖拽项压住的其它图表组（重叠面积占较小者比例最高者）
 *
 * 用布局坐标而不是 DOM 位置：拖拽过程中其它卡片会被实时挤开，
 * 因此传入的 snapshot 应当是拖拽开始前拍下的布局。
 */
export function findMergeTargetByLayout(
  dragged: GridItemBox,
  snapshot: GridItemBox[],
  hitRatio = 0.35,
): string | null {
  let best: { id: string; ratio: number } | null = null;
  for (const item of snapshot) {
    if (item.i === dragged.i) continue;
    const overlapW = Math.min(dragged.x + dragged.w, item.x + item.w) - Math.max(dragged.x, item.x);
    const overlapH = Math.min(dragged.y + dragged.h, item.y + item.h) - Math.max(dragged.y, item.y);
    if (overlapW <= 0 || overlapH <= 0) continue;
    const overlapArea = overlapW * overlapH;
    const smallerArea = Math.min(dragged.w * dragged.h, item.w * item.h);
    const ratio = smallerArea > 0 ? overlapArea / smallerArea : 0;
    if (ratio >= hitRatio && (!best || ratio > best.ratio)) {
      best = { id: item.i, ratio };
    }
  }
  return best?.id ?? null;
}
