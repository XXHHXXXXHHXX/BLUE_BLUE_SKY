'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Space } from 'antd';
import { PlusOutlined, CloseOutlined, HolderOutlined } from '@ant-design/icons';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import { useTestReportStore } from '../../stores/testReportStore';
import CustomXYChartPanel from './CustomXYChartPanel';

const ResponsiveGridLayout = WidthProvider(Responsive);

const ROW_HEIGHT = 60;
/** 每张图表占满整行，新增时依次向下排列，避免并排后挤在一起看不清 */
const PANEL_W = 12;
const PANEL_H = 13;
const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

let idCounter = 0;

/** 生成某断点下占满整行的布局项 */
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
function createLayouts(panels: string[]): Layouts {
  const result: Layouts = {};
  for (const [bp, cols] of Object.entries(COLS)) {
    result[bp] = panels.map((id, index) => createLayoutItem(id, index, cols));
  }
  return result;
}

const MultiXYChartPanel: React.FC = () => {
  const { reports, fetchReports } = useTestReportStore();
  const [panels, setPanels] = useState<string[]>(['xy-0']);
  const [layouts, setLayouts] = useState<Layouts>(() => createLayouts(['xy-0']));

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const addPanel = () => {
    idCounter += 1;
    const newId = `xy-${idCounter}`;
    setPanels((prev) => {
      const next = [...prev, newId];
      // 新图表追加到末尾（下方），整行宽度
      setLayouts((prevLayouts) => {
        const updated: Layouts = {};
        for (const [bp, cols] of Object.entries(COLS)) {
          updated[bp] = [
            ...(prevLayouts[bp] || []),
            createLayoutItem(newId, prev.length, cols),
          ];
        }
        return updated;
      });
      return next;
    });
  };

  const removePanel = (id: string) => {
    setPanels((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((p) => p !== id);
      setLayouts((prevLayouts) => {
        const updated: Layouts = {};
        for (const [bp, cols] of Object.entries(COLS)) {
          updated[bp] = (prevLayouts[bp] || [])
            .filter((l) => l.i !== id)
            // 删除后重新纵向排列，避免留下空洞
            .map((l, index) => ({ ...l, x: 0, y: index * PANEL_H, w: Math.min(PANEL_W, cols) }));
        }
        return updated;
      });
      return next;
    });
  };

  const handleLayoutChange = (_currentLayout: Layout[], allLayouts: Layouts) => {
    setLayouts(allLayouts);
  };

  const panelIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    panels.forEach((id, idx) => map.set(id, idx));
    return map;
  }, [panels]);

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
          每张 XY 图表默认占满整行并依次向下排列；可拖拽标题栏调整顺序。
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
        draggableHandle=".xy-drag-handle"
        isResizable={false}
        margin={[16, 16]}
        containerPadding={[0, 0]}
      >
        {panels.map((id) => (
          <div key={id}>
            <Card
              size="small"
              title={
                <Space>
                  <span className="xy-drag-handle" style={{ cursor: 'move' }}>
                    <HolderOutlined />
                  </span>
                  <span>XY 图表 #{panelIndexMap.get(id)! + 1}</span>
                </Space>
              }
              extra={
                panels.length > 1 ? (
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => removePanel(id)}
                  >
                    关闭
                  </Button>
                ) : null
              }
              style={{ height: '100%' }}
              styles={{ body: { height: 'calc(100% - 48px)', overflow: 'auto' } }}
            >
              <CustomXYChartPanel externalReports={reports} disableFetch />
            </Card>
          </div>
        ))}
      </ResponsiveGridLayout>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Button type="dashed" icon={<PlusOutlined />} onClick={addPanel}>
          再新增一个 XY 图表
        </Button>
      </div>
    </div>
  );
};

export default MultiXYChartPanel;
