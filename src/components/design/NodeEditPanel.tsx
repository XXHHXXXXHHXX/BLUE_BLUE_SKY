'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Drawer, Input, InputNumber, Button, message, Tabs, Select, Typography, Divider, Tag, Space } from 'antd';
import {
  EditOutlined,
  UploadOutlined,
  ApiOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  ControlOutlined,
  LinkOutlined,
  PlusOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import { useDesignTopologyStore } from '../../stores/designTopologyStore';
import { defaultFieldMappings } from '../../services/mockData';
import type { TopologyNode, HardwareNodeType, ApiConfig, FieldMapping, FieldThreshold } from '../../types/topology';
import { FIXED_FIELD_DEFS, DEFAULT_FIELD_THRESHOLDS } from '../../types/topology';

const { Text, Title } = Typography;

/** 模块类型大写缩写 */
const typeTagMap: Record<HardwareNodeType, string> = {
  ac: 'AC', psu: 'PSU', vr: 'VR', psip: 'PSIP',
  cpu: 'CPU', memory: 'MEM', fan: 'FAN', disk: 'DISK',
  io: 'IO', card: 'CARD', sensor: 'SENSOR', mgmtBoard: 'MGMT', chassis: 'CHASSIS',
  thermometer: 'THERM', custom: 'CUSTOM',
};

interface NodeEditPanelProps {
  open: boolean;
  onClose: () => void;
  node: TopologyNode | null;
}

/** 可控模块类型（支持调速/调压） */
const controllableTypes: HardwareNodeType[] = ['fan', 'vr', 'psip'];

/** 各可控类型的默认范围 */
const defaultRanges: Record<string, { min: number; max: number; step: number; unit: string; label: string }> = {
  fan:  { min: 0, max: 100, step: 1, unit: '%', label: '调速范围' },
  vr:   { min: 0.5, max: 1.5, step: 0.01, unit: 'V', label: '调压范围' },
  psip: { min: 0.5, max: 1.5, step: 0.01, unit: 'V', label: '调压范围' },
};

const NodeEditPanel: React.FC<NodeEditPanelProps> = ({ open, onClose, node }) => {
  const { updateNodeAlias, updateNodeCustomIconUrl, updateNodeApiConfig, updateNodeFieldMappings } = useDesignTopologyStore();

  const [alias, setAlias] = useState('');
  const [controlShell, setControlShell] = useState('');
  const [rangeMin, setRangeMin] = useState<number | null>(null);
  const [rangeMax, setRangeMax] = useState<number | null>(null);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [customFieldDefs, setCustomFieldDefs] = useState<{ fieldKey: string; label: string }[]>([]);
  const [fieldThresholds, setFieldThresholds] = useState<FieldThreshold[]>([]);
  const [activeThresholdField, setActiveThresholdField] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 同步外部 node 数据到本地状态 - 只在节点切换时同步，避免编辑时被重置
  useEffect(() => {
    if (node?.data) {
      setAlias(node.data.displayAlias || '');
      setControlShell(node.data.apiConfig?.controlShell || '');
      // 使用节点已有的字段映射，或该类型的默认映射
      const existingMappings = node.data.apiConfig?.fieldMappings;
      setFieldMappings(existingMappings || []);
      // 使用节点已有的自定义字段定义
      setCustomFieldDefs(node.data.apiConfig?.customFieldDefs || []);
      // 使用节点已有的阈值配置，或该类型的默认阈值
      const existingThresholds = node.data.apiConfig?.fieldThresholds;
      setFieldThresholds(existingThresholds || []);
      const nt = node.data.nodeType as HardwareNodeType;
      const defaults = defaultRanges[nt];
      if (defaults) {
        setRangeMin(node.data.controlRange?.min ?? defaults.min);
        setRangeMax(node.data.controlRange?.max ?? defaults.max);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);  // 只在节点 ID 变化时同步，避免 node 对象引用变化导致重置

  const nodeType = node?.data?.nodeType as HardwareNodeType | undefined;
  const typeTag = nodeType ? typeTagMap[nodeType] || nodeType.toUpperCase() : '';

  // 保存别名
  const handleSaveAlias = useCallback(() => {
    if (!node) return;
    updateNodeAlias(node.id, alias);
    message.success('别名已保存');
  }, [node, alias, updateNodeAlias]);

  // 图标上传
  const handleIconUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!node) return;
    const file = e.target.files?.[0];
    if (!file) return;

    // 校验格式
    const validTypes = ['image/png', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      message.error('仅支持 PNG 和 SVG 格式图标');
      return;
    }

    // 校验大小 (<500KB)
    if (file.size > 500 * 1024) {
      message.error('图标文件大小不能超过 500KB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      updateNodeCustomIconUrl(node.id, dataUrl);
      message.success('图标已更新');
    };
    reader.readAsDataURL(file);

    // 重置 input 以支持重复上传同一文件
    e.target.value = '';
  }, [node, updateNodeCustomIconUrl]);

  // 清除自定义图标
  const handleClearIcon = useCallback(() => {
    if (!node) return;
    updateNodeCustomIconUrl(node.id, undefined);
    message.success('已恢复默认图标');
  }, [node, updateNodeCustomIconUrl]);

  // 保存控制范围（设计界面只保存在本地状态，不发送后端命令）
  const handleSaveControlRange = useCallback(() => {
    if (!node || !nodeType) return;
    const defaults = defaultRanges[nodeType];
    if (!defaults) return;
    const min = rangeMin ?? defaults.min;
    const max = rangeMax ?? defaults.max;
    if (min >= max) {
      message.error('最小值必须小于最大值');
      return;
    }
    // 更新节点数据中的 controlRange
    const store = useDesignTopologyStore.getState();
    const { nodes } = store;
    const updatedNodes = nodes.map(n =>
      n.id === node.id
        ? { ...n, data: { ...n.data, controlRange: { min, max } } }
        : n
    );
    store.updateNodes(updatedNodes);
    message.success('控制范围已保存');
  }, [node, nodeType, rangeMin, rangeMax]);

  // 保存 API 配置
  const handleSaveApiConfig = useCallback(() => {
    if (!node) return;
    const config: ApiConfig = {};
    config.controlShell = controlShell.trim();
    // 保存字段映射（只要 fieldKey 存在即可，BMC 字段名可为空）
    config.fieldMappings = fieldMappings.filter(m => m.fieldKey);
    // 保存自定义字段定义
    config.customFieldDefs = customFieldDefs.filter(d => d.fieldKey && d.label);
    // 保存阈值配置（过滤掉空范围）
    config.fieldThresholds = fieldThresholds.filter(t => t.fieldKey && t.ranges.length > 0);
    updateNodeApiConfig(node.id, config);
    message.success('字段映射配置已保存');
  }, [node, controlShell, fieldMappings, customFieldDefs, fieldThresholds, updateNodeApiConfig]);

  // 添加字段映射（选择指定字段）
  const [fieldToAdd, setFieldToAdd] = useState<string | null>(null);

  const handleAddFieldMapping = useCallback(() => {
    if (!nodeType || !fieldToAdd) return;
    const fixedDefs = FIXED_FIELD_DEFS[nodeType] || [];
    const usedKeys = new Set(fieldMappings.map(m => m.fieldKey));
    if (usedKeys.has(fieldToAdd)) {
      message.info('该字段已存在');
      return;
    }
    const def = fixedDefs.find(d => d.fieldKey === fieldToAdd);
    if (def) {
      const next = [...fieldMappings, { fieldKey: def.fieldKey, bmcField: '' }];
      setFieldMappings(next);
      setFieldToAdd(null);
      if (node) {
        updateNodeFieldMappings(node.id, next);
      }
    }
  }, [nodeType, fieldToAdd, fieldMappings, node, updateNodeFieldMappings]);

  // 删除字段映射
  const handleRemoveFieldMapping = useCallback((index: number) => {
    const removed = fieldMappings[index];
    const next = fieldMappings.filter((_, i) => i !== index);
    setFieldMappings(next);
    // 实时同步到 store
    if (node) {
      updateNodeFieldMappings(node.id, next);
    }
    // 如果删除的是自定义字段，同时从 customFieldDefs 中移除
    if (removed) {
      const fixedKeys = new Set((FIXED_FIELD_DEFS[nodeType || ''] || []).map(d => d.fieldKey));
      if (!fixedKeys.has(removed.fieldKey)) {
        setCustomFieldDefs(prev => prev.filter(d => d.fieldKey !== removed.fieldKey));
      }
    }
  }, [fieldMappings, nodeType, node, updateNodeFieldMappings]);

  // 更新字段映射（实时同步到 store，前端即时渲染字段名变化）
  const handleUpdateFieldMapping = useCallback((index: number, updates: Partial<FieldMapping>) => {
    setFieldMappings(prev => {
      const next = prev.map((m, i) => i === index ? { ...m, ...updates } : m);
      if (node) {
        updateNodeFieldMappings(node.id, next.filter(m => m.fieldKey));
      }
      return next;
    });
  }, [node, updateNodeFieldMappings]);

  // 移动字段映射位置
  const handleMoveFieldMapping = useCallback((index: number, direction: -1 | 1) => {
    setFieldMappings(prev => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      if (node) {
        updateNodeFieldMappings(node.id, next.filter(m => m.fieldKey));
      }
      return next;
    });
  }, [node, updateNodeFieldMappings]);

  // 恢复默认字段映射
  const handleRestoreDefaults = useCallback(() => {
    if (!nodeType) return;
    const defaults = defaultFieldMappings[nodeType];
    const fixedDefs = FIXED_FIELD_DEFS[nodeType] || [];
    if (fixedDefs.length > 0) {
      // 根据固定字段定义创建映射，优先使用已有默认值
      const newMappings: FieldMapping[] = fixedDefs.map(def => {
        const defaultMapping = defaults?.find(m => m.fieldKey === def.fieldKey);
        return {
          fieldKey: def.fieldKey,
          bmcField: defaultMapping?.bmcField || '',
        };
      });
      setFieldMappings(newMappings);
      setCustomFieldDefs([]);
      if (node) {
        updateNodeFieldMappings(node.id, newMappings);
      }
      message.success('已恢复默认字段映射');
    } else if (defaults && defaults.length > 0) {
      // 对于自定义模块等无固定字段但有默认映射的类型
      const newMappings: FieldMapping[] = defaults.map(m => ({
        fieldKey: m.fieldKey,
        bmcField: m.bmcField || '',
      }));
      setFieldMappings(newMappings);
      setCustomFieldDefs([]);
      if (node) {
        updateNodeFieldMappings(node.id, newMappings);
      }
      message.success('已恢复默认字段映射');
    } else {
      message.info('该模块类型没有默认字段映射');
    }
  }, [nodeType, node, updateNodeFieldMappings]);

  // 清空所有字段映射
  const handleClearAllFieldMappings = useCallback(() => {
    setFieldMappings([]);
    setCustomFieldDefs([]);
    if (node) {
      updateNodeFieldMappings(node.id, []);
    }
    message.success('已清空所有字段');
  }, [node, updateNodeFieldMappings]);

  const renderBasicTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 别名配置 */}
      <div>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          <EditOutlined /> 显示别名
        </Text>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder="输入自定义别名"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            suffix={<Tag color="blue">{typeTag}</Tag>}
            onPressEnter={handleSaveAlias}
          />
          <Button type="primary" onClick={handleSaveAlias}>保存</Button>
        </div>
        <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
          保存后显示格式：{alias ? `${alias} (${typeTag})` : node?.data?.label || ''}
        </Text>
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {/* 图标上传 */}
      <div>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          <UploadOutlined /> 自定义图标
        </Text>

        {/* 预览区 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 8,
          padding: 12,
          background: '#fafafa',
          borderRadius: 8,
          border: '1px solid #f0f0f0',
        }}>
          <div style={{
            width: 48, height: 48,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, background: '#fff', border: '1px solid #e8e8e8',
            fontSize: 28,
          }}>
            {node?.data?.customIconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={node.data.customIconUrl} alt="icon" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            ) : (
              <span style={{ color: '#8c8c8c' }}>默认</span>
            )}
          </div>
          <div>
            <Text>当前图标：{node?.data?.customIconUrl ? '自定义' : '默认'}</Text>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.svg,image/png,image/svg+xml"
            onChange={handleIconUpload}
            style={{ display: 'none' }}
          />
          <Button
            icon={<UploadOutlined />}
            onClick={() => fileInputRef.current?.click()}
          >
            上传图标
          </Button>
          {node?.data?.customIconUrl && (
            <Button
              icon={<DeleteOutlined />}
              danger
              onClick={handleClearIcon}
            >
              恢复默认
            </Button>
          )}
        </div>
        <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
          支持 PNG / SVG 格式，大小不超过 500KB
        </Text>
      </div>
    </div>
  );

  const renderControlTab = () => {
    if (!nodeType) return null;
    const defaults = defaultRanges[nodeType];
    if (!defaults) return null;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <Title level={5} style={{ margin: 0 }}>
            <ControlOutlined /> {defaults.label}
          </Title>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
            设置在拓扑监控界面中该模块滑块的最小值和最大值
          </Text>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <Text style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>最小值 ({defaults.unit})</Text>
              <InputNumber
                style={{ width: '100%' }}
                value={rangeMin}
                onChange={(v) => setRangeMin(v)}
                step={defaults.step}
                placeholder={`默认 ${defaults.min}`}
              />
            </div>
            <span style={{ marginTop: 20 }}>~</span>
            <div style={{ flex: 1 }}>
              <Text style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>最大值 ({defaults.unit})</Text>
              <InputNumber
                style={{ width: '100%' }}
                value={rangeMax}
                onChange={(v) => setRangeMax(v)}
                step={defaults.step}
                placeholder={`默认 ${defaults.max}`}
              />
            </div>
          </div>

          <div style={{
            padding: '8px 12px',
            background: '#f6f8fa',
            border: '1px solid #e8e8e8',
            borderRadius: 6,
            marginBottom: 12,
          }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              <InfoCircleOutlined /> 当前范围：{rangeMin ?? defaults.min}{defaults.unit} ~ {rangeMax ?? defaults.max}{defaults.unit}
              （默认：{defaults.min}{defaults.unit} ~ {defaults.max}{defaults.unit}）
            </Text>
          </div>

          <Button type="primary" onClick={handleSaveControlRange} block>
            保存控制范围
          </Button>
        </div>
      </div>
    );
  };

  // 获取固定字段定义
  const fixedFieldDefs = nodeType ? (FIXED_FIELD_DEFS[nodeType] || []) : [];
  
  // 合并自定义字段定义
  const allFieldDefs = [...fixedFieldDefs, ...customFieldDefs];
  
  // 获取字段的显示名（会读取 fieldMapping.label 覆盖）
  const getFieldLabel = (fieldKey: string): string => {
    const def = allFieldDefs.find(d => d.fieldKey === fieldKey);
    return def?.label || fieldKey;
  };

  // 获取字段的默认显示名（不读取 fieldMapping.label，用于输入框 placeholder）
  const getFieldDefaultLabel = (fieldKey: string): string => {
    const def = allFieldDefs.find(d => d.fieldKey === fieldKey);
    return def?.label || fieldKey;
  };

  const renderApiTab = () => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* 字段映射配置 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Title level={5} style={{ margin: 0 }}>
              <ApiOutlined /> 字段映射配置
            </Title>
            <Space>
              <Button size="small" danger onClick={handleClearAllFieldMappings}>
                清空所有
              </Button>
              <Button size="small" onClick={handleRestoreDefaults}>
                恢复默认
              </Button>
            </Space>
          </div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
            为每个字段填写对应的 BMC Sensor 名称，系统将自动匹配数据。支持加减乘除运算，如 CPU0 PWR/POWER2、CPU0 PWR + CPU1 PWR
          </Text>

          {/* 字段映射列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {fieldMappings.length === 0 && (
              <div style={{ 
                padding: 24, 
                textAlign: 'center', 
                background: '#f5f5f5', 
                borderRadius: 6,
                color: '#8c8c8c' 
              }}>
                暂无字段映射，点击"恢复默认"开始使用
              </div>
            )}
            {fieldMappings.map((mapping, index) => (
              <div key={index} style={{ 
                display: 'flex', 
                gap: 8, 
                alignItems: 'center',
                padding: 12,
                background: '#f6f8fa',
                borderRadius: 6,
                border: '1px solid #e8e8e8',
              }}>
                <div style={{ flex: '0 0 120px' }}>
                  <Text style={{ fontSize: 12, display: 'block', marginBottom: 4, color: '#595959' }}>字段名</Text>
                  <Input
                    size="small"
                    value={mapping.label || getFieldDefaultLabel(mapping.fieldKey)}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      const defaultLabel = getFieldDefaultLabel(mapping.fieldKey);
                      handleUpdateFieldMapping(index, { label: value && value !== defaultLabel ? value : undefined });
                    }}
                    style={{ color: '#000', fontWeight: 500 }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>BMC Sensor 名称</Text>
                  <Input
                    placeholder="如：CPU0 PWR 或 CPU0 PWR/POWER2"
                    value={mapping.bmcField}
                    onChange={(e) => handleUpdateFieldMapping(index, { bmcField: e.target.value })}
                    size="small"
                  />
                </div>
                <Button
                  type="text"
                  size="small"
                  icon={<ArrowUpOutlined />}
                  onClick={() => handleMoveFieldMapping(index, -1)}
                  disabled={index === 0}
                  style={{ marginTop: 20 }}
                />
                <Button
                  type="text"
                  size="small"
                  icon={<ArrowDownOutlined />}
                  onClick={() => handleMoveFieldMapping(index, 1)}
                  disabled={index === fieldMappings.length - 1}
                  style={{ marginTop: 20 }}
                />
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => handleRemoveFieldMapping(index)}
                  style={{ marginTop: 20 }}
                />
              </div>
            ))}
          </div>

          {/* 添加固定字段 */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, display: 'block', marginBottom: 4, color: '#595959' }}>添加固定字段</Text>
              <Select
                size="small"
                style={{ width: '100%' }}
                placeholder="选择要添加的字段"
                value={fieldToAdd}
                onChange={(v) => setFieldToAdd(v)}
                options={(() => {
                  if (!nodeType) return [];
                  const usedKeys = new Set(fieldMappings.map(m => m.fieldKey));
                  return (FIXED_FIELD_DEFS[nodeType] || [])
                    .filter(d => !usedKeys.has(d.fieldKey))
                    .map(d => ({ value: d.fieldKey, label: `${d.label} (${d.fieldKey})` }));
                })()}
              />
            </div>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleAddFieldMapping} disabled={!fieldToAdd}>
              添加
            </Button>
          </div>

          {/* 添加自定义字段 */}
          <CustomFieldAdder
            onAdd={(fieldKey, label) => {
              const usedKeys = new Set(fieldMappings.map(m => m.fieldKey));
              if (usedKeys.has(fieldKey)) {
                message.info('该字段已存在');
                return;
              }
              const next = [...fieldMappings, { fieldKey, bmcField: '', label }];
              setFieldMappings(next);
              setCustomFieldDefs(prev => [...prev, { fieldKey, label }]);
              if (node) {
                updateNodeFieldMappings(node.id, next);
              }
            }}
          />

          {/* 常用 Sensor 示例 */}
          <div style={{ marginTop: 16, padding: 12, background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              <InfoCircleOutlined /> 常用 BMC Sensor 名称（点击复制）：
            </Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                'CPU0 PWR', 'CPU1 PWR', 'CPU Total PWR',
                'CPU0 Core Temp', 'CPU1 Core Temp',
                'FAN1 Speed', 'FAN2 Speed', 'FAN Power',
                'DIMM PWR', 'DIMM Temp',
                'PS1 POut', 'PS2 POut', 'Power', 'Power2',
                'Disk BP1 Power', 'Disk BP2 Power',
                'CPU0 PWR + CPU1 PWR', 'CPU0 PWR/POWER2',
              ].map((name) =>(
                <Tag 
                  key={name} 
                  color="green" 
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    navigator.clipboard.writeText(name);
                    message.success(`已复制：${name}`);
                  }}
                >
                  {name}
                </Tag>
              ))}
            </div>
          </div>
        </div>

        <Divider style={{ margin: '4px 0' }} />

        {/* 字段阈值配置 */}
        {fieldMappings.length > 0 && (
          <div>
            <Title level={5} style={{ margin: 0 }}>
              <InfoCircleOutlined /> 字段阈值配置
            </Title>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12, marginTop: 4 }}>
              为数值字段配置颜色阈值，监控界面将根据数值范围显示不同颜色
            </Text>

            {/* 字段选择 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {fieldMappings
                .filter(m => ['power', 'temperature', 'efficiency', 'rpm', 'speedPercent', 'current', 'voltage'].includes(m.fieldKey))
                .map(mapping => {
                  const hasThreshold = fieldThresholds.some(t => t.fieldKey === mapping.fieldKey);
                  return (
                    <Button
                      key={mapping.fieldKey}
                      size="small"
                      type={activeThresholdField === mapping.fieldKey ? 'primary' : 'default'}
                      onClick={() => setActiveThresholdField(activeThresholdField === mapping.fieldKey ? null : mapping.fieldKey)}
                    >
                      {getFieldLabel(mapping.fieldKey)} {hasThreshold && '●'}
                    </Button>
                  );
                })}
            </div>

            {/* 阈值编辑区域 */}
            {activeThresholdField && (
              <FieldThresholdEditor
                fieldKey={activeThresholdField}
                fieldLabel={getFieldLabel(activeThresholdField)}
                thresholds={fieldThresholds}
                onChange={setFieldThresholds}
                defaultThresholds={nodeType ? DEFAULT_FIELD_THRESHOLDS[nodeType] : undefined}
              />
            )}
          </div>
        )}

        <Divider style={{ margin: '4px 0' }} />

        {/* 控制 Shell 命令 */}
        <div>
          <Title level={5} style={{ margin: 0 }}>
            <LinkOutlined /> 控制 Shell 命令
          </Title>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8, marginTop: 4 }}>
            配置 BMC 控制 Shell 命令，使用 {'{value}'} 占位符表示调节值，系统将通过 SSH 下发到 BMC 执行
          </Text>
          <Input.TextArea
            placeholder="如：ipmcset -t fan -d speed -v {value}"
            value={controlShell}
            onChange={(e) => setControlShell(e.target.value)}
            rows={2}
          />
        </div>

        <Button type="primary" onClick={handleSaveApiConfig} block style={{ marginTop: 8 }}>
          保存配置
        </Button>

        {/* 使用说明 */}
        <div style={{ background: '#fff7e6', padding: 12, borderRadius: 6, border: '1px solid #ffd591' }}>
          <Text strong style={{ fontSize: 13, color: '#d46b08', display: 'block', marginBottom: 4 }}>
            <InfoCircleOutlined /> 使用说明
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            系统将 BMC Sensor 名称与后端获取的数据匹配，将匹配到的值映射到对应字段。数据将按照 cpuData、memoryData、diskData 等格式返回。
          </Text>
        </div>
      </div>
    );
  };

  return (
    <Drawer
      title={
        <span>
          编辑模块 {node?.data?.label && <Tag color="blue">{typeTag}</Tag>}
        </span>
      }
      placement="right"
      width={520}
      open={open}
      onClose={onClose}
      styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflow: 'auto' } }}
      destroyOnClose
    >
      {node ? (
        <Tabs
          defaultActiveKey="basic"
          size="small"
          items={[
            {
              key: 'basic',
              label: <span><EditOutlined /> 基本信息</span>,
              children: renderBasicTab(),
            },
            ...(nodeType && controllableTypes.includes(nodeType) ? [{
              key: 'control',
              label: <span><ControlOutlined /> 控制范围</span>,
              children: renderControlTab(),
            }] : []),
            {
              key: 'api',
              label: <span><ApiOutlined /> 字段映射</span>,
              children: renderApiTab(),
            },
          ]}
        />
      ) : (
        <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 40 }}>
          请选中一个模块进行编辑
        </div>
      )}
    </Drawer>
  );
};

/** 字段阈值编辑器组件 */
interface FieldThresholdEditorProps {
  fieldKey: string;
  fieldLabel: string;
  thresholds: FieldThreshold[];
  onChange: (thresholds: FieldThreshold[]) => void;
  defaultThresholds?: FieldThreshold[];
}

const FieldThresholdEditor: React.FC<FieldThresholdEditorProps> = ({
  fieldKey,
  fieldLabel,
  thresholds,
  onChange,
  defaultThresholds,
}) => {
  const currentThreshold = thresholds.find(t => t.fieldKey === fieldKey);
  const defaultConfig = defaultThresholds?.find(t => t.fieldKey === fieldKey);
  
  const ranges = currentThreshold?.ranges || [];

  const handleAddRange = () => {
    const newThresholds = [...thresholds];
    const index = newThresholds.findIndex(t => t.fieldKey === fieldKey);
    const newRange = { min: 0, max: 100, color: '#52c41a', label: '正常' };
    
    if (index >= 0) {
      newThresholds[index].ranges.push(newRange);
    } else {
      newThresholds.push({ fieldKey, ranges: [newRange] });
    }
    onChange(newThresholds);
  };

  const handleRemoveRange = (rangeIndex: number) => {
    const newThresholds = thresholds.map(t => 
      t.fieldKey === fieldKey 
        ? { ...t, ranges: t.ranges.filter((_, i) => i !== rangeIndex) }
        : t
    ).filter(t => t.ranges.length > 0);
    onChange(newThresholds);
  };

  const handleUpdateRange = (rangeIndex: number, updates: Partial<{ min: number; max: number; color: string; label: string }>) => {
    const newThresholds = thresholds.map(t => 
      t.fieldKey === fieldKey 
        ? { 
            ...t, 
            ranges: t.ranges.map((r, i) => i === rangeIndex ? { ...r, ...updates } : r)
          }
        : t
    );
    onChange(newThresholds);
  };

  const handleLoadDefault = () => {
    if (defaultConfig) {
      const newThresholds = thresholds.filter(t => t.fieldKey !== fieldKey);
      newThresholds.push({ fieldKey, ranges: [...defaultConfig.ranges] });
      onChange(newThresholds);
      message.success(`已加载 ${fieldLabel} 的默认阈值配置`);
    }
  };

  const colors = [
    { value: '#52c41a', label: '绿色' },
    { value: '#73d13d', label: '浅绿' },
    { value: '#95de64', label: '淡绿' },
    { value: '#faad14', label: '黄色' },
    { value: '#ffc53d', label: '浅黄' },
    { value: '#ff7a45', label: '橙色' },
    { value: '#ff4d4f', label: '红色' },
    { value: '#cf1322', label: '深红' },
    { value: '#1890ff', label: '蓝色' },
    { value: '#722ed1', label: '紫色' },
  ];

  return (
    <div style={{ 
      padding: 12, 
      background: '#f6f8fa', 
      borderRadius: 6, 
      border: '1px solid #e8e8e8',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>{fieldLabel} 阈值配置</Text>
        <Space size="small">
          {defaultConfig && (
            <Button size="small" onClick={handleLoadDefault}>
              加载默认
            </Button>
          )}
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleAddRange}>
            添加范围
          </Button>
        </Space>
      </div>

      {ranges.length === 0 && (
        <div style={{ textAlign: 'center', padding: 16, color: '#8c8c8c', fontSize: 12 }}>
          暂无阈值配置，点击"添加范围"或"加载默认"
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ranges.map((range, index) => (
          <div key={index} style={{ 
            display: 'flex', 
            gap: 8, 
            alignItems: 'center',
            padding: 8,
            background: '#fff',
            borderRadius: 4,
            border: '1px solid #d9d9d9',
          }}>
            <div style={{ flex: '0 0 80px' }}>
              <Text style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>最小值</Text>
              <InputNumber
                size="small"
                style={{ width: '100%' }}
                value={range.min}
                onChange={(v) => handleUpdateRange(index, { min: v ?? 0 })}
              />
            </div>
            <div style={{ flex: '0 0 80px' }}>
              <Text style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>最大值</Text>
              <InputNumber
                size="small"
                style={{ width: '100%' }}
                value={range.max}
                onChange={(v) => handleUpdateRange(index, { max: v ?? 100 })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>颜色</Text>
              <Select
                size="small"
                style={{ width: '100%' }}
                value={range.color}
                onChange={(v) => handleUpdateRange(index, { color: v })}
                options={colors}
                optionRender={(option) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ 
                      width: 12, 
                      height: 12, 
                      borderRadius: '50%', 
                      backgroundColor: option.value as string,
                      border: '1px solid #d9d9d9'
                    }} />
                    {option.label}
                  </div>
                )}
              />
            </div>
            <div style={{ flex: '0 0 80px' }}>
              <Text style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>标签</Text>
              <Input
                size="small"
                value={range.label || ''}
                onChange={(e) => handleUpdateRange(index, { label: e.target.value })}
                placeholder="如：正常"
              />
            </div>
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => handleRemoveRange(index)}
              style={{ marginTop: 16 }}
            />
          </div>
        ))}
      </div>

      {ranges.length > 0 && (
        <div style={{ marginTop: 12, padding: 8, background: '#e6f7ff', borderRadius: 4 }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
            数值范围判断：最小值 ≤ 数值 &lt; 最大值
          </Text>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {ranges.map((r, i) => (
              <Tag key={i} color={r.color} style={{ margin: 0 }}>
                {r.label || `${r.min}-${r.max}`}
              </Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/** 自定义字段添加器 */
const CustomFieldAdder: React.FC<{
  onAdd: (fieldKey: string, label: string) => void;
}> = ({ onAdd }) => {
  const [fieldKey, setFieldKey] = useState('');
  const [label, setLabel] = useState('');

  const handleAdd = () => {
    const key = fieldKey.trim();
    const lbl = label.trim();
    if (!key) {
      message.error('请输入字段标识');
      return;
    }
    if (!lbl) {
      message.error('请输入显示名称');
      return;
    }
    onAdd(key, lbl);
    setFieldKey('');
    setLabel('');
    message.success('自定义字段已添加');
  };

  return (
    <div style={{ marginTop: 12, padding: 12, background: '#f0f5ff', borderRadius: 6, border: '1px solid #adc6ff' }}>
      <Text style={{ fontSize: 12, display: 'block', marginBottom: 8, color: '#595959' }}>
        <PlusOutlined /> 添加自定义字段
      </Text>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>字段标识（英文）</Text>
          <Input
            size="small"
            placeholder="如 customPower"
            value={fieldKey}
            onChange={(e) => setFieldKey(e.target.value)}
            onPressEnter={handleAdd}
          />
        </div>
        <div style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>显示名称</Text>
          <Input
            size="small"
            placeholder="如 自定义功耗"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onPressEnter={handleAdd}
          />
        </div>
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          添加
        </Button>
      </div>
    </div>
  );
};

export default NodeEditPanel;
