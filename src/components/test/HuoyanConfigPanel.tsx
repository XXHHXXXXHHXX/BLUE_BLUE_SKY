'use client';

/**
 * 火眼自动化平台配置面板
 *
 * 选择蓝天独占队列 → 选择火眼用例包（benchmark/suite）→ 按目录里的参数 schema 填参数
 * → 绑定目标机。所有可选项都来自火眼平台的 catalog / targets / queues 接口。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Input, InputNumber, Select, Space, Switch, Tag, Typography, message } from 'antd';
import {
  HUOYAN_DEFAULT_BASE_URL,
  HUOYAN_DEFAULT_TIMEOUT_HOURS,
  HUOYAN_QUEUE_IDS,
  type HuoyanArgument,
  type HuoyanBinding,
  type HuoyanDefinition,
  type HuoyanJobConfig,
  type HuoyanParameterSchema,
  type HuoyanQueue,
  type HuoyanTarget,
} from '../../types/huoyan';

interface HuoyanConfigPanelProps {
  value?: HuoyanJobConfig;
  onChange: (config: HuoyanJobConfig) => void;
  disabled?: boolean;
}

const { Text } = Typography;

/** 按参数 schema 的 type_name 决定值类型（服务端按类型校验，字符串参数不能传数字） */
function coerceScalar(typeName: string, raw: string): HuoyanArgument['value'] {
  if (typeName === 'int') {
    const num = Number(raw);
    return Number.isFinite(num) ? Math.trunc(num) : raw;
  }
  if (typeName === 'float') {
    const num = Number(raw);
    return Number.isFinite(num) ? num : raw;
  }
  if (typeName === 'bool') {
    return raw === 'true';
  }
  return raw;
}

function coerceValue(schema: HuoyanParameterSchema, raw: string): HuoyanArgument['value'] {
  // 集合类参数（list / ordered_set）：逗号分隔，逐项按标量类型转换
  if (schema.collection_kind === 'list' || schema.collection_kind === 'ordered_set') {
    const items = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
    const scalarType = schema.scalar_types?.[0] || 'str';
    return items.map((item) => coerceScalar(scalarType, item)) as HuoyanArgument['value'];
  }
  return coerceScalar(schema.type_name || '', raw);
}

function defaultValueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const HuoyanConfigPanel: React.FC<HuoyanConfigPanelProps> = ({ value, onChange, disabled }) => {
  const [definitions, setDefinitions] = useState<HuoyanDefinition[]>([]);
  const [targets, setTargets] = useState<HuoyanTarget[]>([]);
  const [queues, setQueues] = useState<HuoyanQueue[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const baseUrl = value?.baseUrl || HUOYAN_DEFAULT_BASE_URL;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const query = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : '';
      const [catalogRes, targetsRes, queuesRes] = await Promise.all([
        fetch(`/api/test/huoyan/catalog${query}`),
        fetch(`/api/test/huoyan/targets${query}`),
        fetch(`/api/test/huoyan/queues${query}`),
      ]);
      const catalogJson = await catalogRes.json();
      const targetsJson = await targetsRes.json();
      const queuesJson = await queuesRes.json();
      if (catalogJson.success) setDefinitions(catalogJson.definitions || []);
      if (targetsJson.success) setTargets(targetsJson.targets || []);
      if (queuesJson.success) setQueues(queuesJson.queues || []);

      const firstError = [catalogJson, targetsJson, queuesJson].find((r) => !r.success);
      if (firstError) setLoadError(firstError.message || '获取火眼平台信息失败');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '获取火眼平台信息失败');
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const queueOptions = useMemo(() => {
    const byId = new Map(queues.map((q) => [q.queue_id, q]));
    return HUOYAN_QUEUE_IDS.map((id) => {
      const q = byId.get(id);
      const running = q?.items.filter((it) => ['queued', 'prechecking', 'waiting_for_targets', 'running'].includes(it.status)).length || 0;
      return {
        value: id,
        label: (
          <Space size={4}>
            <span>{id}</span>
            {q ? (
              <>
                <Tag color={q.status === 'running' ? 'processing' : q.status === 'completed' ? 'default' : 'blue'}>
                  {q.status}
                </Tag>
                {running > 0 && <Tag color="orange">{running} 项排队/运行</Tag>}
              </>
            ) : (
              <Tag color="red">未找到</Tag>
            )}
          </Space>
        ),
      };
    });
  }, [queues]);

  const definitionOptions = useMemo(
    () =>
      definitions
        .filter((d) => d.kind === 'benchmark' || d.kind === 'suite')
        .map((d) => ({
          value: d.definition_id,
          label: `${d.name}（${d.kind === 'suite' ? '套件' : '用例'}）`,
          title: d.description || d.definition_id,
        })),
    [definitions],
  );

  const selectedDefinition = useMemo(
    () => definitions.find((d) => d.definition_id === value?.definitionId) || null,
    [definitions, value?.definitionId],
  );

  const targetOptions = useMemo(
    () =>
      targets.map((t) => ({
        value: t.name,
        label: (
          <Space size={4}>
            <span>{t.name}</span>
            {t.model && <Tag>{t.model}</Tag>}
            <Tag color={t.connectivity === 'available' ? 'green' : 'red'}>{t.connectivity || '未知'}</Tag>
          </Space>
        ),
      })),
    [targets],
  );

  const currentConfig: HuoyanJobConfig = value || {
    baseUrl: HUOYAN_DEFAULT_BASE_URL,
    queueId: HUOYAN_QUEUE_IDS[0],
    definitionId: '',
    arguments: [],
    bindings: [],
    timeoutHours: HUOYAN_DEFAULT_TIMEOUT_HOURS,
  };

  const update = (patch: Partial<HuoyanJobConfig>) => onChange({ ...currentConfig, ...patch });

  /** 切换用例时，按新用例的参数 schema 重置参数与角色绑定 */
  const handleDefinitionChange = (definitionId: string) => {
    const def = definitions.find((d) => d.definition_id === definitionId);
    // 默认值为 null 的可选参数不提交：服务端会把空串当成真实取值
    // （如 _cpu_bind_seq='' 会触发「绑核序列解析出错」）
    const args: HuoyanArgument[] = (def?.parameters || [])
      .filter((p) => p.has_default && p.default !== null && p.default !== undefined)
      .map((p) => ({ name: p.name, value: coerceValue(p, defaultValueToString(p.default)) }));
    const bindings: HuoyanBinding[] = (def?.roles || []).map((role) => ({
      role,
      target_name: currentConfig.bindings.find((b) => b.role === role)?.target_name || '',
    }));
    update({
      definitionId,
      definitionName: def?.name,
      arguments: args,
      bindings,
    });
  };

  const setArgument = (schema: HuoyanParameterSchema, raw: string) => {
    const next = currentConfig.arguments.filter((a) => a.name !== schema.name);
    if (raw !== '') next.push({ name: schema.name, value: coerceValue(schema, raw) });
    update({ arguments: next });
  };

  const getArgument = (name: string) =>
    currentConfig.arguments.find((a) => a.name === name)?.value;

  const setBinding = (role: string, targetName: string) => {
    const next = currentConfig.bindings.filter((b) => b.role !== role);
    if (targetName) next.push({ role, target_name: targetName });
    update({ bindings: next });
  };

  const renderParameter = (schema: HuoyanParameterSchema) => {
    const rawValue = defaultValueToString(getArgument(schema.name));
    const isBool = schema.type_name === 'bool';
    const isNumber = schema.type_name === 'int' || schema.type_name === 'float';
    const hasChoices = Array.isArray(schema.choices) && schema.choices.length > 0;

    let control: React.ReactNode;
    if (isBool) {
      control = (
        <Switch
          size="small"
          checked={rawValue === 'true'}
          onChange={(checked) => setArgument(schema, String(checked))}
          disabled={disabled}
        />
      );
    } else if (hasChoices) {
      control = (
        <Select
          size="small"
          style={{ width: 240 }}
          value={rawValue || undefined}
          placeholder="请选择"
          allowClear
          onChange={(v) => setArgument(schema, v === undefined || v === null ? '' : String(v))}
          options={(schema.choices || []).map((c) => ({ value: String(c), label: String(c) }))}
          disabled={disabled}
        />
      );
    } else if (isNumber) {
      control = (
        <InputNumber
          size="small"
          style={{ width: 160 }}
          value={rawValue === '' ? undefined : Number(rawValue)}
          onChange={(v) => setArgument(schema, v === null || v === undefined ? '' : String(v))}
          disabled={disabled}
        />
      );
    } else {
      control = (
        <Input
          size="small"
          style={{ width: 240 }}
          value={rawValue}
          placeholder={schema.description || ''}
          onChange={(e) => setArgument(schema, e.target.value)}
          disabled={disabled}
        />
      );
    }

    return (
      <div key={schema.name} style={{ marginBottom: 8 }}>
        <Space size="small" align="center">
          <span style={{ width: 150, fontSize: 12, display: 'inline-block' }}>
            {schema.name}
            {schema.required && <Text type="danger"> *</Text>}
          </span>
          {control}
          <Text type="secondary" style={{ fontSize: 11 }}>{schema.type_name}</Text>
        </Space>
      </div>
    );
  };

  return (
    <div data-field-key="huoyan">
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      {loadError && (
        <Alert
          type="warning"
          showIcon
          message="火眼平台连接异常"
          description={loadError}
          action={<a onClick={load}>重试</a>}
        />
      )}

      <div>
        <Space size="small">
          <span style={{ fontSize: 12, color: '#666', width: 90, display: 'inline-block' }}>平台地址</span>
          <Input
            size="small"
            style={{ width: 280 }}
            value={baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
            onBlur={load}
            disabled={disabled}
          />
          <a onClick={load}>{loading ? '加载中...' : '刷新'}</a>
        </Space>
      </div>

      <div>
        <Space size="small">
          <span style={{ fontSize: 12, color: '#666', width: 90, display: 'inline-block' }}>蓝天队列</span>
          <Select
            size="small"
            style={{ width: 320 }}
            value={currentConfig.queueId}
            onChange={(queueId) => update({ queueId })}
            options={queueOptions}
            disabled={disabled}
            placeholder="选择火眼队列"
          />
        </Space>
      </div>

      <div>
        <Space size="small">
          <span style={{ fontSize: 12, color: '#666', width: 90, display: 'inline-block' }}>超时时间</span>
          <InputNumber
            size="small"
            style={{ width: 140 }}
            min={0.1}
            step={1}
            value={currentConfig.timeoutHours ?? HUOYAN_DEFAULT_TIMEOUT_HOURS}
            onChange={(v) =>
              update({ timeoutHours: typeof v === 'number' && v > 0 ? v : undefined })
            }
            disabled={disabled}
            addonAfter="小时"
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            默认 {HUOYAN_DEFAULT_TIMEOUT_HOURS} 小时，超时后按失败处理并尝试取消火眼运行
          </Text>
        </Space>
      </div>

      <div>
        <Space size="small">
          <span style={{ fontSize: 12, color: '#666', width: 90, display: 'inline-block' }}>火眼用例包</span>
          <Select
            size="small"
            style={{ width: 320 }}
            showSearch
            optionFilterProp="label"
            value={currentConfig.definitionId || undefined}
            onChange={handleDefinitionChange}
            options={definitionOptions}
            disabled={disabled}
            placeholder="选择火眼用例/套件"
          />
        </Space>
      </div>

      {selectedDefinition?.description && (
        <Text type="secondary" style={{ fontSize: 12 }}>{selectedDefinition.description}</Text>
      )}

      {selectedDefinition && (
        <div style={{ padding: '8px', background: '#fafafa', borderRadius: 4 }}>
          <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 8 }}>用例参数</div>
          {(selectedDefinition.parameters || []).length === 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>该用例无需参数</Text>
          ) : (
            (selectedDefinition.parameters || []).map(renderParameter)
          )}
        </div>
      )}

      {selectedDefinition && (selectedDefinition.roles || []).length > 0 && (
        <div style={{ padding: '8px', background: '#fafafa', borderRadius: 4 }}>
          <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 8 }}>目标机绑定</div>
          {(selectedDefinition.roles || []).map((role) => (
            <div key={role} style={{ marginBottom: 8 }}>
              <Space size="small">
                <span style={{ width: 150, fontSize: 12, display: 'inline-block' }}>{role}</span>
                <Select
                  size="small"
                  style={{ width: 320 }}
                  value={currentConfig.bindings.find((b) => b.role === role)?.target_name || undefined}
                  onChange={(v) => setBinding(role, v)}
                  options={targetOptions}
                  disabled={disabled}
                  placeholder="选择火眼目标机"
                  showSearch
                  optionFilterProp="value"
                />
              </Space>
            </div>
          ))}
        </div>
      )}
    </Space>
    </div>
  );
};

export default HuoyanConfigPanel;

/** 校验火眼配置是否完整，返回错误信息（null 表示通过） */
export function validateHuoyanConfig(config: HuoyanJobConfig | undefined): string | null {
  if (!config) return '请配置火眼执行参数';
  if (!config.queueId) return '请选择火眼队列';
  if (!config.definitionId) return '请选择火眼用例包';
  if (config.timeoutHours !== undefined && !(config.timeoutHours > 0)) {
    return '超时时间必须大于 0 小时';
  }
  return null;
}

/** 提交前的提示：把火眼返回的错误转成用户可读文案 */
export function showHuoyanError(err: unknown) {
  message.error(err instanceof Error ? err.message : String(err));
}
