'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Space } from 'antd';
import { PlusOutlined, CloseOutlined, HolderOutlined } from '@ant-design/icons';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import { useTestReportStore } from '../../stores/testReportStore';
import CustomXYChartPanel from './CustomXYChartPanel';

const ResponsiveGridLayout = WidthProvider(Responsive);

const ROW_HEIGHT = 60;
const PANEL_W = 6;
const PANEL_H = 10;
const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

let idCounter = 0;

function createLayoutItem(id: string, index: number): Layout {
  return {
    i: id,
    x: (index % 2) * PANEL_W,
    y: Math.floor(index / 2) * PANEL_H,
    w: PANEL_W,
    h: PANEL_H,
    minW: 4,
    minH: 6,
  };
}

const MultiXYChartPanel: React.FC = () => {
  const { reports, fetchReports } = useTestReportStore();
  const [panels, setPanels] = useState<string[]>(['xy-0']);
  const [layouts, setLayouts] = useState<Layouts>({
    lg: [createLayoutItem('xy-0', 0)],
  });

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const addPanel = () => {
    idCounter += 1;
    const newId = `xy-${idCounter}`;
    setPanels((prev) => {
      const next = [...prev, newId];
      setLayouts((prevLayouts) => ({
        lg: [
          ...(prevLayouts.lg || []),
          createLayoutItem(newId, prev.length),
        ],
      }));
      return next;
    });
  };

  const removePanel = (id: string) => {
    setPanels((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((p) => p !== id);
      setLayouts((prevLayouts) => ({
        lg: prevLayouts.lg?.filter((l) => l.i !== id) || [],
      }));
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
          可拖拽每个 XY 图表面板自由排列；拖到另一个面板旁边即可自动并排显示。
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
