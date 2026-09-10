'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Form, Input, InputNumber, Button, Popconfirm, message } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { bindYAxisWheelZoom } from '../../utils/chartWheelZoom';
import type { ColumnsType } from 'antd/es/table';
import type { ThermalCase } from '../../types/power';

/* ── Mock efficiency stage data ── */
interface StageRow {
  key: string;
  stage: string;
  inputPower: number;
  outputPower: number;
  efficiency: number;
  loss: number;
}

const STAGE_DATA: StageRow[] = [
  { key: '1', stage: 'AC → PSU', inputPower: 850, outputPower: 803, efficiency: 94.5, loss: 47 },
  { key: '2', stage: 'PSU → VR-CPU0', inputPower: 320, outputPower: 305, efficiency: 95.3, loss: 15 },
  { key: '3', stage: 'PSU → VR-CPU1', inputPower: 310, outputPower: 296, efficiency: 95.5, loss: 14 },
  { key: '4', stage: 'PSU → VR-MEM', inputPower: 80, outputPower: 74, efficiency: 92.5, loss: 6 },
  { key: '5', stage: 'PSU → VR-IO', inputPower: 45, outputPower: 42, efficiency: 93.3, loss: 3 },
  { key: '6', stage: 'PSU → FAN', inputPower: 48, outputPower: 46, efficiency: 95.8, loss: 2 },
];

const stageColumns: ColumnsType<StageRow> = [
  { title: '转换阶段', dataIndex: 'stage', key: 'stage' },
  { title: '输入功率(W)', dataIndex: 'inputPower', key: 'inputPower' },
  { title: '输出功率(W)', dataIndex: 'outputPower', key: 'outputPower' },
  {
    title: '效率(%)',
    dataIndex: 'efficiency',
    key: 'efficiency',
    render: (v: number) => (
      <span style={{ color: v >= 95 ? '#52c41a' : v >= 90 ? '#faad14' : '#ff4d4f' }}>
        {v.toFixed(1)}%
      </span>
    ),
  },
  { title: '损耗(W)', dataIndex: 'loss', key: 'loss' },
];

/* ── 链路损耗柱状图：所有柱体以 Y 轴 0 为基准线 ── */
function getLossChartOption() {
  const stages = STAGE_DATA.map((s) => s.stage);
  const losses = STAGE_DATA.map((s) => s.loss);

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params as { name?: string; value?: number } | undefined;
        if (!p) return '';
        return `${p.name ?? ''}<br/>损耗: ${p.value ?? 0}W`;
      },
    },
    grid: { left: 60, right: 20, top: 30, bottom: 60 },
    xAxis: { type: 'category', data: stages, axisLabel: { rotate: 20 } },
    yAxis: {
      type: 'value',
      name: '损耗(W)',
      min: 0,
      minInterval: 1,
    },
    series: [
      {
        name: '损耗',
        type: 'bar',
        data: losses,
        barWidth: '50%',
        itemStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#ff7a45' },
              { offset: 1, color: '#ffa940' },
            ],
          },
          borderRadius: [4, 4, 0, 0],
        },
        label: { show: true, position: 'top', formatter: '{c}W', fontSize: 12, color: '#595959' },
      },
    ],
  };
}

/* ── Thermal cases storage key ── */
const STORAGE_KEY = 'thermal_cases';

function loadCases(): ThermalCase[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCases(cases: ThermalCase[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
}

/* ── Component ── */
const PowerEfficiency: React.FC = () => {
  const [cases, setCases] = useState<ThermalCase[]>(loadCases);
  const [form] = Form.useForm();

  useEffect(() => {
    saveCases(cases);
  }, [cases]);

  const handleAdd = useCallback(() => {
    form.validateFields().then((values) => {
      const newCase: ThermalCase = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        location: values.location,
        temperature: values.temperature,
        threshold: values.threshold,
        description: values.description,
        solution: values.solution,
      };
      setCases((prev) => [...prev, newCase]);
      form.resetFields();
      message.success('案例已添加');
    });
  }, [form]);

  const handleDelete = useCallback((id: string) => {
    setCases((prev) => prev.filter((c) => c.id !== id));
    message.success('案例已删除');
  }, []);

  const caseColumns: ColumnsType<ThermalCase> = [
    { title: '位置', dataIndex: 'location', key: 'location', width: 100 },
    { title: '温度(°C)', dataIndex: 'temperature', key: 'temperature', width: 90 },
    { title: '阈值(°C)', dataIndex: 'threshold', key: 'threshold', width: 90 },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '解决方案', dataIndex: 'solution', key: 'solution', ellipsis: true },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, record) => (
        <Popconfirm title="确认删除?" onConfirm={() => handleDelete(record.id)}>
          <Button type="link" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top: efficiency table */}
      <Card title="供电链路效率分析">
        <Table<StageRow>
          columns={stageColumns}
          dataSource={STAGE_DATA}
          pagination={false}
          size="small"
        />
      </Card>

      {/* Middle: waterfall bar chart */}
      <Card title="链路损耗分析">
        <ReactECharts option={getLossChartOption()} style={{ height: 300 }} onChartReady={bindYAxisWheelZoom} />
      </Card>

      {/* Bottom: thermal cases */}
      <Card title="散热瓶颈案例">
        <Form form={form} layout="inline" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <Form.Item name="location" rules={[{ required: true, message: '请输入位置' }]}>
            <Input placeholder="位置" style={{ width: 100 }} />
          </Form.Item>
          <Form.Item name="temperature" rules={[{ required: true, message: '请输入温度' }]}>
            <InputNumber placeholder="温度°C" style={{ width: 100 }} />
          </Form.Item>
          <Form.Item name="threshold" rules={[{ required: true, message: '请输入阈值' }]}>
            <InputNumber placeholder="阈值°C" style={{ width: 100 }} />
          </Form.Item>
          <Form.Item name="description" rules={[{ required: true, message: '请输入描述' }]}>
            <Input placeholder="描述" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="solution" rules={[{ required: true, message: '请输入解决方案' }]}>
            <Input placeholder="解决方案" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加</Button>
          </Form.Item>
        </Form>
        <Table<ThermalCase>
          columns={caseColumns}
          dataSource={cases}
          rowKey="id"
          pagination={false}
          size="small"
        />
      </Card>
    </div>
  );
};

export default PowerEfficiency;
