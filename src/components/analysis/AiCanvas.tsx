'use client';

/** AI 可视化画布
 *
 * AI 在对话中通过 render* 客户端工具把内容画到这里：图表/指标/表格/公式/时间线/文本。
 * 与业务页面无关，全局挂载；同一 block id 更新时重绘（用于公式变幻、图表变形）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, Drawer, Empty, Popconfirm, Space, Table, Tag, Timeline, Tooltip, Typography } from 'antd';
import {
  BarChartOutlined,
  ClearOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FunctionOutlined,
  NumberOutlined,
  TableOutlined,
  FontSizeOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import ReactMarkdown from 'react-markdown';
import { useAiCanvasStore, type CanvasBlock } from '../../stores/aiCanvasStore';
import ErrorBoundary from '../common/ErrorBoundary';
import { downloadDataUrl } from '../../utils/chartExport';

const { Text, Paragraph } = Typography;

const BLOCK_ICON: Record<string, React.ReactNode> = {
  chart: <BarChartOutlined />,
  metrics: <NumberOutlined />,
  table: <TableOutlined />,
  formula: <FunctionOutlined />,
  timeline: <NodeIndexOutlined />,
  markdown: <FontSizeOutlined />,
};

/** 指标卡：数字变化时做一次高亮闪烁 */
const MetricValue: React.FC<{ value: string | number; unit?: string; delta?: number; color?: string }> = ({
  value,
  unit,
  delta,
  color,
}) => {
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 700);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 8,
        background: flash ? 'rgba(24,144,255,0.12)' : 'rgba(0,0,0,0.02)',
        border: '1px solid rgba(0,0,0,0.06)',
        transition: 'background 0.4s',
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 600, color: color || '#1f1f1f', lineHeight: 1.2 }}>
        {value}
        {unit && <span style={{ fontSize: 13, marginLeft: 3, color: '#8c8c8c' }}>{unit}</span>}
      </div>
      {typeof delta === 'number' && (
        <div style={{ fontSize: 12, marginTop: 2, color: delta >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}
        </div>
      )}
    </div>
  );
};

const BlockCard: React.FC<{ block: CanvasBlock; onRemove: (id: string) => void }> = ({
  block,
  onRemove,
}) => {
  const chartRef = useRef<ReactECharts | null>(null);

  /** 图表导出 PNG（取 ECharts 实例的 dataURL） */
  const exportChartPng = () => {
    try {
      const inst = chartRef.current?.getEchartsInstance?.();
      if (!inst) return;
      const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
      const name = (block.title || 'chart').replace(/[\\/:*?"<>|]/g, '_');
      downloadDataUrl(url, `${name}.png`);
    } catch (e) {
      console.error('[AiCanvas] 导出图片失败', e);
    }
  };
  const title = (
    <Space size={6}>
      <span style={{ color: '#722ed1' }}>{BLOCK_ICON[block.type]}</span>
      <span>{block.title || '未命名'}</span>
      {block.revision > 1 && (
        <Tag color="purple" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
          v{block.revision}
        </Tag>
      )}
    </Space>
  );

  let body: React.ReactNode = null;
  switch (block.type) {
    case 'chart':
      body = block.echartsOption ? (
        <ErrorBoundary title="图表">
          <ReactECharts
            ref={chartRef}
            option={block.echartsOption}
            style={{ height: block.chartHeight || 320 }}
            notMerge
            lazyUpdate
          />
        </ErrorBoundary>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无图表数据" />
      );
      break;

    case 'metrics':
      body = (
        <Space wrap size={12}>
          {(block.metrics || []).map((m, i) => (
            <div key={i}>
              <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>{m.label}</div>
              <MetricValue value={m.value} unit={m.unit} delta={m.delta} color={m.color} />
            </div>
          ))}
        </Space>
      );
      break;

    case 'table':
      body = (
        <ErrorBoundary title="表格">
          <Table
            size="small"
            pagination={(block.rows?.length || 0) > 20 ? { pageSize: 20, size: 'small' } : false}
            scroll={{ x: 'max-content' }}
            columns={(block.columns || []).map((c) => ({
              title: c.title,
              dataIndex: c.key,
              key: c.key,
              align: c.align,
              render: (v: unknown) =>
                typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''),
            }))}
            dataSource={(block.rows || []).map((r, i) => ({ ...r, __key: i }))}
            rowKey="__key"
          />
        </ErrorBoundary>
      );
      break;

    case 'formula':
      body = (
        <div>
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 8,
              background: 'linear-gradient(135deg, rgba(24,144,255,0.08), rgba(114,46,209,0.08))',
              border: '1px solid rgba(24,144,255,0.25)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 15,
              lineHeight: 1.8,
              color: '#1d39c4',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {block.formula}
          </div>
          {block.description && (
            <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 13 }}>
              {block.description}
            </Paragraph>
          )}
        </div>
      );
      break;

    case 'timeline':
      body = (
        <Timeline
          items={(block.items || []).map((it) => ({
            color:
              it.status === 'done'
                ? 'green'
                : it.status === 'active'
                  ? 'blue'
                  : it.status === 'error'
                    ? 'red'
                    : 'gray',
            children: (
              <div>
                <Space size={6}>
                  <Text strong>{it.title}</Text>
                  {it.extra && <Tag style={{ fontSize: 11 }}>{it.extra}</Tag>}
                </Space>
                {it.description && (
                  <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
                    {it.description}
                  </Paragraph>
                )}
              </div>
            ),
          }))}
        />
      );
      break;

    case 'markdown':
      body = (
        <ErrorBoundary title="文本">
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>
            <ReactMarkdown>{block.content || ''}</ReactMarkdown>
          </div>
        </ErrorBoundary>
      );
      break;
  }

  return (
    <Card
      size="small"
      title={title}
      style={{ marginBottom: 12 }}
      styles={{ body: { padding: block.type === 'markdown' ? 12 : 16 } }}
      extra={
        <Space size={0}>
          {block.type === 'chart' && (
            <Tooltip title="导出 PNG">
              <Button size="small" type="text" icon={<DownloadOutlined />} onClick={exportChartPng} />
            </Tooltip>
          )}
          <Tooltip title="移除该视图">
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined />}
              onClick={() => onRemove(block.id)}
            />
          </Tooltip>
        </Space>
      }
    >
      {body}
      {block.description && block.type !== 'formula' && (
        <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
          {block.description}
        </Paragraph>
      )}
    </Card>
  );
};

const AiCanvas: React.FC = () => {
  const { open, blocks, title, setOpen, clear, removeBlock } = useAiCanvasStore();

  return (
    <Drawer
      title={
        <Space>
          <BarChartOutlined style={{ color: '#722ed1' }} />
          <span>{title}</span>
          {blocks.length > 0 && <Tag color="purple">{blocks.length} 个视图</Tag>}
        </Space>
      }
      placement="left"
      width={720}
      open={open}
      onClose={() => setOpen(false)}
      closeIcon={<CloseOutlined />}
      styles={{ body: { background: '#fafafa', padding: 16 } }}
      extra={
        blocks.length > 0 && (
          <Space>
            <Popconfirm
              title="清空画布？"
              description={`将移除全部 ${blocks.length} 个视图，无法恢复`}
              okText="清空"
              cancelText="取消"
              onConfirm={clear}
            >
              <Button size="small" icon={<ClearOutlined />}>
                清空
              </Button>
            </Popconfirm>
          </Space>
        )
      }
    >
      {blocks.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="AI 还没有画任何东西。试着对它说「把结果画出来」"
          style={{ marginTop: 60 }}
        />
      ) : (
        blocks.map((b) => <BlockCard key={b.id} block={b} onRemove={removeBlock} />)
      )}
    </Drawer>
  );
};

export default AiCanvas;
