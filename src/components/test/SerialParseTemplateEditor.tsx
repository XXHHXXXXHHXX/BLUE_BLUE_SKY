'use client';

/** 串口解析模板编辑器
 *
 * 两种方式并存，默认「导入 TS 脚本」：
 *   - TS 脚本：粘贴或上传一段 TypeScript（meta + parse + label?），服务端沙箱执行
 *   - 表单配置：结构化字段（采样模式 / 锚点 / 指标 / 校验），不写代码
 * 右侧「试解析」用同一份服务端编译结果展示指标与采样。
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Input,
  Button,
  Space,
  Row,
  Col,
  Table,
  Alert,
  Tag,
  Typography,
  Upload,
  Segmented,
  Select,
  InputNumber,
  Divider,
  message,
} from 'antd';
import {
  UploadOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  PlusOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import useMaximizableModal from '../../hooks/useMaximizableModal';
import { useSerialTemplateStore, type SerialTemplateTestResult } from '../../stores/serialTemplateStore';
import type { SerialTemplateRecord } from '../../utils/serialTemplateContract';
import type {
  SerialAnchor,
  SerialDslTemplate,
  SerialMetricRule,
  SerialSampleMode,
} from '../../utils/serialDsl';
import { SERIAL_UART_PRESETS } from '../../types/serial';

const { Text, Paragraph } = Typography;

export interface SerialParseTemplateEditorProps {
  open: boolean;
  /** 编辑现有用户模板时的 id；为空表示新建 */
  templateId?: string;
  /** 打开时的初始快照 */
  initial: SerialTemplateRecord['template'];
  /** 同一模板的另一种形态（内置模板同时提供 code 与 dsl），切换模式时优先使用 */
  alternative?: SerialTemplateRecord['alt'];
  onCancel: () => void;
  onSaved: (recordId: string) => void;
}

const MODE_OPTIONS = [
  { label: 'TS 脚本', value: 'code' },
  { label: '表单配置', value: 'dsl' },
];

const SAMPLE_MODE_HINTS: Record<SerialSampleMode, string> = {
  raw: '不解析：原始输出按时间戳写入 serial-<id>.log，不产生采样点',
  window: '只读观察：把整个时间窗口的输出当作一次采样，指标取首个/末个匹配',
  line: '单行采样：每命中采样行正则的一行算一次采样，指标在该行内取值（适合「一行多字段」输出）',
  block: '整块快照：整段输出算一次采样；锚点逐行维护上下文变量，指标据此拼出稳定 id（适合多段嵌套输出）',
};

const CONTRACT_HINT = `const meta = { name: '模板名', command: '要下发的命令', uarts: [1], unit: 'mW' };
function parse(output: string): Record<string, number>[] { ... }
function label(metric: string): string { ... }   // 可选
return { meta, parse, label };`;

/** 空表单模板骨架：默认 block 模式（无需采样行正则），命令沿用当前模板声明 */
export function emptySerialDsl(meta?: SerialTemplateRecord['template']['meta']): SerialDslTemplate {
  return {
    name: meta?.name ?? '新表单模板',
    command: meta?.command ?? '',
    uarts: meta?.uarts,
    unit: meta?.unit ?? 'mW',
    sample: { mode: 'block', takeLast: 0, spacingMs: meta?.spacingMs ?? 0 },
    anchors: [],
    metrics: [{ id: 'value', label: '数值', pattern: '(?<value>-?\\d+(?:\\.\\d+)?)' }],
    checks: [],
  };
}

const SerialParseTemplateEditor: React.FC<SerialParseTemplateEditorProps> = ({
  open,
  templateId,
  initial,
  alternative,
  onCancel,
  onSaved,
}) => {
  const { saveTemplate, testTemplate } = useSerialTemplateStore();
  const modal = useMaximizableModal({ minWidth: 1300 });

  const [mode, setMode] = useState<'code' | 'dsl'>(initial.kind === 'dsl' ? 'dsl' : 'code');
  const [name, setName] = useState(initial.name);
  const [code, setCode] = useState(initial.code ?? '');
  const [dsl, setDsl] = useState<SerialDslTemplate>(
    initial.dsl ?? alternative?.dsl ?? emptySerialDsl(initial.meta)
  );
  const [sample, setSample] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SerialTemplateTestResult | { error: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(initial.kind === 'dsl' ? 'dsl' : 'code');
    setName(initial.name);
    setCode(initial.code ?? '');
    setDsl(initial.dsl ?? alternative?.dsl ?? emptySerialDsl(initial.meta));
    setSample('');
    setResult(null);
    // 每次打开都以父组件传入的快照为准
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templateId]);

  const payload = mode === 'code'
    ? { kind: 'code' as const, code }
    : { kind: 'dsl' as const, dsl };

  const preview = useMemo(() => {
    if (!result || 'error' in result) return null;
    const columns = [
      { title: '指标 id', dataIndex: 'metric', key: 'metric', width: 220 },
      { title: '显示名', dataIndex: 'label', key: 'label', width: 200 },
      ...result.samples.map((_, i) => ({
        title: `采样 ${i + 1}`,
        dataIndex: `s${i}`,
        key: `s${i}`,
        width: 120,
      })),
    ];
    const rows = result.metrics.map(({ id, label }) => {
      const row: Record<string, string | number> = { metric: id, label };
      result.samples.forEach((s, i) => {
        row[`s${i}`] = s[id] ?? '';
      });
      return row;
    });
    return { columns, rows };
  }, [result]);

  const handleTest = async () => {
    setTesting(true);
    try {
      setResult(await testTemplate(payload, sample));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await saveTemplate(payload, templateId, name.trim() || undefined);
      if (!saved) {
        message.error('保存失败：模板未通过校验，可先点「试解析」查看具体错误');
        return;
      }
      message.success(`模板「${saved.template.name}」已保存`);
      onSaved(saved.id);
    } finally {
      setSaving(false);
    }
  };

  const patchDsl = (next: Partial<SerialDslTemplate>) => setDsl((cur) => ({ ...cur, ...next }));
  const patchSample = (next: Partial<SerialDslTemplate['sample']>) =>
    setDsl((cur) => ({ ...cur, sample: { ...cur.sample, ...next } }));
  const updateAnchor = (index: number, next: Partial<SerialAnchor>) =>
    setDsl((cur) => ({
      ...cur,
      anchors: (cur.anchors ?? []).map((a, i) => (i === index ? { ...a, ...next } : a)),
    }));
  const updateMetric = (index: number, next: Partial<SerialMetricRule>) =>
    setDsl((cur) => ({
      ...cur,
      metrics: (cur.metrics ?? []).map((m, i) => (i === index ? { ...m, ...next } : m)),
    }));

  const renderCodePane = () => (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Row gutter={8}>
        <Col span={16}>
          <Text type="secondary" style={{ fontSize: 12 }}>上传 .ts 文件</Text>
          <Upload
            accept=".ts,.txt,.js"
            showUploadList={false}
            beforeUpload={(file) => {
              file.text().then((text) => setCode(text));
              return false;
            }}
          >
            <Button size="small" icon={<UploadOutlined />} block>选择文件并载入</Button>
          </Upload>
        </Col>
      </Row>
      <Input.TextArea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoSize={{ minRows: 18, maxRows: 30 }}
        spellCheck={false}
        placeholder={CONTRACT_HINT}
        style={{ fontFamily: 'monospace', fontSize: 12 }}
      />
      <Alert
        type="info"
        showIcon
        style={{ fontSize: 12 }}
        message="模板契约"
        description={
          <>
            <Paragraph style={{ margin: '4px 0', fontSize: 12 }}>
              代码作为函数体执行，必须 <Text code>return {`{ meta, parse }`}</Text>；
              <Text code>label</Text> 可选。沙箱内无 require / process / fs，只能做字符串与数学运算。
            </Paragraph>
            <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap' }}>{CONTRACT_HINT}</pre>
          </>
        }
      />
    </Space>
  );

  const renderDslPane = () => (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Row gutter={8}>
        <Col span={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>下发命令</Text>
          <Input
            size="small"
            value={dsl.command ?? ''}
            onChange={(e) => patchDsl({ command: e.target.value })}
            placeholder="power 0（只读观察可留空）"
          />
        </Col>
        <Col span={5}>
          <Text type="secondary" style={{ fontSize: 12 }}>单位</Text>
          <Input size="small" value={dsl.unit ?? ''} onChange={(e) => patchDsl({ unit: e.target.value })} placeholder="mW" />
        </Col>
        <Col span={11}>
          <Text type="secondary" style={{ fontSize: 12 }}>可用 UART（留空不限）</Text>
          <Select
            size="small"
            mode="multiple"
            allowClear
            style={{ width: '100%' }}
            value={dsl.uarts ?? []}
            onChange={(value) => patchDsl({ uarts: value.length > 0 ? value : undefined })}
            placeholder="不限"
          >
            {SERIAL_UART_PRESETS.map((preset) => (
              <Select.Option key={preset.id} value={preset.id}>
                {preset.label}（{preset.hex}）
              </Select.Option>
            ))}
          </Select>
        </Col>
      </Row>

      <Row gutter={8}>
        <Col span={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>采样模式</Text>
          <Select
            size="small"
            style={{ width: '100%' }}
            value={dsl.sample.mode}
            onChange={(value) => patchSample({ mode: value as SerialSampleMode })}
          >
            <Select.Option value="raw">raw 仅记录日志</Select.Option>
            <Select.Option value="window">window 只读观察</Select.Option>
            <Select.Option value="line">line 每行一次采样</Select.Option>
            <Select.Option value="block">block 整块快照</Select.Option>
          </Select>
        </Col>
        {dsl.sample.mode === 'line' && (
          <>
            <Col span={10}>
              <Text type="secondary" style={{ fontSize: 12 }}>采样行正则</Text>
              <Input
                size="small"
                value={dsl.sample.pattern ?? ''}
                onChange={(e) => patchSample({ pattern: e.target.value })}
                placeholder="^power\s*:"
              />
            </Col>
            <Col span={3}>
              <Text type="secondary" style={{ fontSize: 12 }}>只留最后</Text>
              <InputNumber
                size="small"
                min={0}
                style={{ width: '100%' }}
                value={dsl.sample.takeLast ?? 0}
                onChange={(value) => patchSample({ takeLast: value ?? 0 })}
              />
            </Col>
            <Col span={3}>
              <Text type="secondary" style={{ fontSize: 12 }}>间隔 ms</Text>
              <InputNumber
                size="small"
                min={0}
                style={{ width: '100%' }}
                value={dsl.sample.spacingMs ?? 0}
                onChange={(value) => patchSample({ spacingMs: value ?? 0 })}
              />
            </Col>
          </>
        )}
      </Row>
      <Text type="secondary" style={{ fontSize: 12 }}>{SAMPLE_MODE_HINTS[dsl.sample.mode]}</Text>

      {dsl.sample.mode === 'block' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>上下文锚点（level 越小范围越大）</Text>
            <Button
              size="small"
              type="link"
              icon={<PlusOutlined />}
              onClick={() => patchDsl({ anchors: [...(dsl.anchors ?? []), { level: 1, pattern: '' }] })}
            >
              添加锚点
            </Button>
          </div>
          {(dsl.anchors ?? []).map((anchor, index) => (
            <Row gutter={4} key={`anchor-${index}`} style={{ marginBottom: 4 }}>
              <Col span={3}>
                <InputNumber
                  size="small"
                  min={1}
                  max={9}
                  style={{ width: '100%' }}
                  value={anchor.level}
                  onChange={(value) => updateAnchor(index, { level: value ?? 1 })}
                />
              </Col>
              <Col span={18}>
                <Input
                  size="small"
                  value={anchor.pattern}
                  onChange={(e) => updateAnchor(index, { pattern: e.target.value })}
                  placeholder="^-+Psocket\s*:\s*(?<psocket>\d+)-*$"
                />
              </Col>
              <Col span={3}>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<MinusCircleOutlined />}
                  onClick={() => patchDsl({ anchors: (dsl.anchors ?? []).filter((_, i) => i !== index) })}
                />
              </Col>
            </Row>
          ))}
        </div>
      )}

      {dsl.sample.mode !== 'raw' && (
        <>
          <Divider style={{ margin: '4px 0' }}>
            指标规则（正则必须含命名组 (?:&lt;value&gt;)；id/label 可用 {'{变量}'} 插值）
          </Divider>
          {(dsl.metrics ?? []).map((metric, index) => (
            <Row gutter={4} key={`metric-${index}`} style={{ marginBottom: 4 }}>
              <Col span={7}>
                <Input
                  size="small"
                  value={metric.id}
                  onChange={(e) => updateMetric(index, { id: e.target.value })}
                  placeholder="id 模板，如 s{psocket}.total"
                />
              </Col>
              <Col span={6}>
                <Input
                  size="small"
                  value={metric.label ?? ''}
                  onChange={(e) => updateMetric(index, { label: e.target.value })}
                  placeholder="显示名，如 PS{psocket} 合计"
                />
              </Col>
              <Col span={8}>
                <Input
                  size="small"
                  value={metric.pattern}
                  onChange={(e) => updateMetric(index, { pattern: e.target.value })}
                  placeholder="取值正则，如 ^power\s*=\s*(?<value>-?\d+)"
                />
              </Col>
              <Col span={3}>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<MinusCircleOutlined />}
                  onClick={() => patchDsl({ metrics: (dsl.metrics ?? []).filter((_, i) => i !== index) })}
                />
              </Col>
            </Row>
          ))}
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => patchDsl({
              metrics: [...(dsl.metrics ?? []), { id: '', label: '', pattern: '(?<value>-?\\d+(?:\\.\\d+)?)' }],
            })}
          >
            添加指标
          </Button>
        </>
      )}
    </Space>
  );

  return (
    <Modal
      title={templateId ? '编辑串口解析模板' : '新建串口解析模板'}
      open={open}
      onCancel={onCancel}
      width={modal.width}
      style={modal.style}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button
          key="test"
          icon={<PlayCircleOutlined />}
          loading={testing}
          onClick={handleTest}
          disabled={!sample.trim()}
        >
          试解析
        </Button>,
        <Button
          key="save"
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSave}
          disabled={mode === 'code' ? !code.trim() : !dsl.metrics?.length && dsl.sample.mode !== 'raw'}
        >
          保存到模板库
        </Button>,
      ]}
    >
      <Row gutter={16}>
        <Col span={14}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Row gutter={8} align="middle">
              <Col span={14}>
                <Text type="secondary" style={{ fontSize: 12 }}>模板名称（留空则用模板内声明的名称）</Text>
                <Input
                  size="small"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={mode === 'code' ? '用代码里的 meta.name' : dsl.name}
                />
              </Col>
              <Col span={10}>
                <Text type="secondary" style={{ fontSize: 12 }}>解析方式</Text>
                <Segmented
                  size="small"
                  block
                  options={MODE_OPTIONS}
                  value={mode}
                  onChange={(value) => {
                    const next = value as 'code' | 'dsl';
                    setMode(next);
                    setResult(null);
                  }}
                />
              </Col>
            </Row>

            {mode === 'code' ? renderCodePane() : renderDslPane()}
          </Space>
        </Col>

        <Col span={10}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              试解析样张：粘贴一次真实命令输出，点「试解析」查看结果
            </Text>
            <Input.TextArea
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              rows={10}
              spellCheck={false}
              placeholder={'power: 436928, threshold: 440000, delta: 6, core: 2439, uncore: 2350'}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />

            {result && 'error' in result && (
              <Alert type="error" showIcon message={result.error} />
            )}

            {result && !('error' in result) && (
              <>
                <Space wrap>
                  <Tag color="blue">{result.snapshot.name}</Tag>
                  <Tag>{result.snapshot.meta.command ? `命令 ${result.snapshot.meta.command}` : '只读/无命令'}</Tag>
                  <Tag color={result.hasData ? 'green' : 'orange'}>
                    {result.hasData ? `${result.samples.length} 个采样` : '未解析到数据'}
                  </Tag>
                  <Tag>{result.metrics.length} 个指标</Tag>
                </Space>
                {result.warnings.map((warning, i) => (
                  <Alert key={`w-${i}`} type="warning" showIcon message={warning} />
                ))}
                {result.checkFailures.map((failure, i) => (
                  <Alert key={`c-${i}`} type="error" showIcon message={failure} />
                ))}
                {preview && (
                  <Table
                    size="small"
                    pagination={false}
                    scroll={{ x: 'max-content', y: 300 }}
                    columns={preview.columns}
                    dataSource={preview.rows.map((row, i) => ({ ...row, key: String(i) }))}
                  />
                )}
              </>
            )}
          </Space>
        </Col>
      </Row>
    </Modal>
  );
};

export default SerialParseTemplateEditor;
