'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Modal, Space, Tag, Tooltip, Typography } from 'antd';
import {
  PlusOutlined,
  CloseOutlined,
  HolderOutlined,
  MergeCellsOutlined,
  SplitCellsOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import ReactECharts from 'echarts-for-react';
import { useTestReportStore, type TestReport } from '../../stores/testReportStore';
import CustomXYChartPanel from './CustomXYChartPanel';
import {
  buildMergedXYChartOption,
  computeXYChart,
  type XYChartConfig,
} from './xyChartShared';
import {
  appendGroup,
  createChartGroup,
  findMergeTargetByLayout,
  mergeGroupList,
  removeGroupFromList,
  splitAllFromList,
  splitMemberFromList,
  updateMemberConfig,
  type ChartGroup,
} from './xyChartGroups';

const ResponsiveGridLayout = WidthProvider(Responsive);

const ROW_HEIGHT = 60;
/** 每个图表组占满整行，依次向下排列 */
const PANEL_W = 12;
const PANEL_H = 13;
const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };
/** 拖拽释放时，指针落在目标图表组内多少比例才算合并（避免边缘误触） */
const MERGE_HIT_RATIO = 0.35;

function createLayoutItem(id: string, index: number, cols: number): Layout {
  return {
    i: id,
    x: 0,
    y: index * PANEL_H,
    w: Math.min(PANEL_W, cols),
    h: PANEL_H,
    minW: Math.min(4, cols),
    minH: 8,
  };
}

/** 为所有断点生成同一套「整行纵向排列」布局 */
function createLayouts(groups: ChartGroup[]): Layouts {
  const result: Layouts = {};
  for (const [bp, cols] of Object.entries(COLS)) {
    result[bp] = groups.map((g, index) => createLayoutItem(g.id, index, cols));
  }
  return result;
}

const { Text } = Typography;

const MultiXYChartPanel: React.FC = () => {
  const { reports, fetchReports } = useTestReportStore();
  const [groups, setGroups] = useState<ChartGroup[]>(() => [createChartGroup()]);
  // 初始布局必须用同一批图表组 id，否则首帧的布局项对不上
  const [layouts, setLayouts] = useState<Layouts>(() => createLayouts(groups));
  const [editing, setEditing] = useState<{ groupId: string; index: number } | null>(null);
  /** 拖拽中的图表组 id（用于高亮可合并的目标） */
  const draggingIdRef = useRef<string | null>(null);
  /** 拖拽过程中最后一次命中的目标图表组（松手时据此合并） */
  const hoverTargetRef = useRef<string | null>(null);
  /** 拖拽开始时的布局快照（用于按网格坐标判定重叠） */
  const layoutSnapshotRef = useRef<Layout[] | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // 图表组变化时重建纵向布局
  useEffect(() => {
    setLayouts(createLayouts(groups));
  }, [groups]);

  const reportMap = useMemo(() => new Map(reports.map((r) => [r.id, r])), [reports]);

  const groupTitle = useCallback(
    (group: ChartGroup, groupIndex: number) => {
      if (group.configs.length === 1) {
        const cfg = group.configs[0];
        const report = cfg.reportId ? reportMap.get(cfg.reportId) : undefined;
        return report ? `XY 图表 #${groupIndex + 1} · ${report.name}` : `XY 图表 #${groupIndex + 1}`;
      }
      return `合并图表 #${groupIndex + 1}（${group.configs.length} 张）`;
    },
    [reportMap],
  );

  const addPanel = () => setGroups(appendGroup);

  const removeGroup = (groupId: string) => setGroups((prev) => removeGroupFromList(prev, groupId));

  const updateGroupConfig = (groupId: string, index: number, config: XYChartConfig) =>
    setGroups((prev) => updateMemberConfig(prev, groupId, index, config));

  /** 把某个成员从合并组里拆出来，单独成为一个图表 */
  const splitMember = (groupId: string, index: number) =>
    setGroups((prev) => splitMemberFromList(prev, groupId, index));

  /** 把合并组全部拆开，每个成员各成一张图 */
  const splitAll = (groupId: string) => setGroups((prev) => splitAllFromList(prev, groupId));

  /** 把 sourceGroupId 合并进 targetGroupId */
  const mergeGroups = useCallback((sourceGroupId: string, targetGroupId: string) => {
    setGroups((prev) => mergeGroupList(prev, sourceGroupId, targetGroupId));
  }, []);

  /** 找到被拖拽图表压住的其它图表组（拖拽合并的判定依据）
   *
   * 用网格布局坐标判定，而不是 DOM 位置：react-grid-layout 在拖拽过程中会实时
   * 把其它卡片挤开，按 DOM 位置找目标会一直落空。
   * 拖拽开始时记录一份布局快照，之后用被拖拽项的实时坐标与快照里的目标项求重叠。
   */
  const findMergeTarget = (dragged: Layout): string | null => {
    const snapshot = layoutSnapshotRef.current;
    if (!snapshot) return null;
    return findMergeTargetByLayout(dragged, snapshot, MERGE_HIT_RATIO);
  };

  const handleDragStart = (layout: Layout[], _oldItem: Layout, newItem: Layout) => {
    draggingIdRef.current = newItem.i;
    // 快照必须在 RGL 重排之前拍下，否则目标卡片已经被挤走
    layoutSnapshotRef.current = layout.map((l) => ({ ...l }));
    hoverTargetRef.current = null;
    setHoverTargetId(null);
  };

  const handleDrag = (_layout: Layout[], _oldItem: Layout, newItem: Layout) => {
    const target = findMergeTarget(newItem);
    hoverTargetRef.current = target;
    setHoverTargetId(target);
  };

  const handleDragStop = (_layout: Layout[], _oldItem: Layout, newItem: Layout) => {
    const sourceId = newItem.i;
    const target = hoverTargetRef.current;
    draggingIdRef.current = null;
    hoverTargetRef.current = null;
    layoutSnapshotRef.current = null;
    setHoverTargetId(null);
    if (target && target !== sourceId) {
      mergeGroups(sourceId, target);
    }
  };

  const handleLayoutChange = (_currentLayout: Layout[], allLayouts: Layouts) => {
    setLayouts(allLayouts);
  };

  const editingGroup = editing ? groups.find((g) => g.id === editing.groupId) : undefined;
  const editingConfig = editingGroup?.configs[editing?.index ?? -1];

  return (
    <div>
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ color: '#595959' }}>
          拖拽标题栏可调整顺序；把一张图表拖到另一张图表中间松手即可合并，合并后趋势线会画在同一坐标系里对比。
        </span>
        <Button type="primary" icon={<PlusOutlined />} onClick={addPanel}>
          新增 XY 图表
        </Button>
      </div>

      <ResponsiveGridLayout
        className="xy-grid-layout"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        onLayoutChange={handleLayoutChange}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragStop={handleDragStop}
        draggableHandle=".xy-drag-handle"
        isResizable={false}
        margin={[16, 16]}
        containerPadding={[0, 0]}
      >
        {groups.map((group, groupIndex) => {
          const isMerged = group.configs.length > 1;
          const isDropTarget = hoverTargetId === group.id;
          return (
            <div key={group.id} data-chart-group-id={group.id}>
              <Card
                size="small"
                title={
                  <Space>
                    <span className="xy-drag-handle" style={{ cursor: 'move' }}>
                      <HolderOutlined />
                    </span>
                    <span>{groupTitle(group, groupIndex)}</span>
                    {isMerged && <Tag color="blue">已合并</Tag>}
                  </Space>
                }
                extra={
                  <Space size={4}>
                    {isMerged && (
                      <Button
                        type="text"
                        size="small"
                        icon={<SplitCellsOutlined />}
                        onClick={() => splitAll(group.id)}
                      >
                        拆分全部
                      </Button>
                    )}
                    {groups.length > 1 && (
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<CloseOutlined />}
                        onClick={() => removeGroup(group.id)}
                      >
                        关闭
                      </Button>
                    )}
                  </Space>
                }
                style={{
                  height: '100%',
                  boxShadow: isDropTarget ? '0 0 0 2px #1677ff' : undefined,
                  transition: 'box-shadow 0.15s',
                }}
                styles={{ body: { height: 'calc(100% - 48px)', overflow: 'auto' } }}
              >
                {isMerged ? (
                  <MergedChartView
                    group={group}
                    groupIndex={groupIndex}
                    reportMap={reportMap}
                    onSplit={(index) => splitMember(group.id, index)}
                    onEdit={(index) => setEditing({ groupId: group.id, index })}
                  />
                ) : (
                  <CustomXYChartPanel
                    externalReports={reports}
                    disableFetch
                    config={group.configs[0]}
                    onConfigChange={(cfg) => updateGroupConfig(group.id, 0, cfg)}
                  />
                )}
              </Card>
            </div>
          );
        })}
      </ResponsiveGridLayout>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Button type="dashed" icon={<PlusOutlined />} onClick={addPanel}>
          再新增一个 XY 图表
        </Button>
      </div>

      <Modal
        open={!!editing}
        title={`编辑成员图表配置${editing ? `（第 ${editing.index + 1} 张）` : ''}`}
        onCancel={() => setEditing(null)}
        footer={null}
        width={1200}
        destroyOnHidden
      >
        {editing && editingConfig && (
          <CustomXYChartPanel
            externalReports={reports}
            disableFetch
            config={editingConfig}
            onConfigChange={(cfg) => updateGroupConfig(editing.groupId, editing.index, cfg)}
          />
        )}
      </Modal>
    </div>
  );
};

interface MergedChartViewProps {
  group: ChartGroup;
  groupIndex: number;
  reportMap: Map<string, TestReport>;
  onSplit: (index: number) => void;
  onEdit: (index: number) => void;
}

/** 合并图表视图：把组内多张图表的序列叠加到同一坐标系 */
const MergedChartView: React.FC<MergedChartViewProps> = ({
  group,
  groupIndex,
  reportMap,
  onSplit,
  onEdit,
}) => {
  const members = useMemo(
    () =>
      group.configs.map((config, index) => {
        const report = config.reportId ? reportMap.get(config.reportId) : undefined;
        const computed = computeXYChart(config, report);
        const title =
          (report?.name ? `${report.name} · ` : '') +
          (computed.ready ? `${computed.yLabel} vs ${computed.xLabel}` : `图表 ${index + 1}`);
        return { title, computed, config, index };
      }),
    [group.configs, reportMap],
  );

  const option = useMemo(() => buildMergedXYChartOption(members), [members]);
  const hasData = members.some((m) => m.computed.points.length > 0);

  return (
    <div>
      <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
        {members.map((m) => (
          <Tag
            key={m.index}
            closable
            closeIcon={
              <Tooltip title="拆出为独立图表">
                <SplitCellsOutlined />
              </Tooltip>
            }
            onClose={(e) => {
              e.preventDefault();
              onSplit(m.index);
            }}
            icon={<MergeCellsOutlined />}
            color={m.computed.points.length > 0 ? 'blue' : 'default'}
            style={{ paddingInline: 8 }}
          >
            <Space size={4}>
              <span>{m.title}</span>
              <Button
                type="text"
                size="small"
                icon={<SettingOutlined />}
                onClick={() => onEdit(m.index)}
              />
            </Space>
          </Tag>
        ))}
        <Text type="secondary" style={{ fontSize: 12 }}>
          合并图表 #{groupIndex + 1}：点击标签上的 × 可把该图表拆出去
        </Text>
      </Space>

      {option ? (
        <ReactECharts option={option} style={{ height: 620 }} notMerge />
      ) : (
        <div style={{ color: '#999', textAlign: 'center', paddingTop: 80 }}>
          {hasData ? '合并图表暂无可绘制数据' : '组内图表尚未配置 X/Y 轴数据'}
        </div>
      )}
    </div>
  );
};

export default MultiXYChartPanel;
