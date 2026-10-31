'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Drawer, Input, InputNumber, Button, message, Tabs, Select, Typography, Divider, Tag, Space } from 'antd';
import {
  EditOutlined,
  UploadOutlined,
  ApiOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ApartmentOutlined,
  ControlOutlined,
  EyeOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useDesignTopologyStore } from '../../stores/designTopologyStore';
import { defaultFieldMappings, defaultPowerDomainFieldMappings } from '../../services/mockData';
import { getNodeLossFieldAnnotation } from '../../services/lossCalculation';
import { CPU_POWER_DOMAIN_FIELD_DEFS } from '../../types/power';
import type { TopologyNode, HardwareNodeType, ApiConfig, FieldMapping, FieldThreshold, ControlConfig, ControlOptionItem, ViewConfig, ViewParamDef } from '../../types/topology';
import { FIXED_FIELD_DEFS, DEFAULT_FIELD_THRESHOLDS } from '../../types/topology';
import { extractCommandParams } from '../../utils/commandParams';

const { Text, Title } = Typography;

/** 模块类型大写缩写 */
const typeTagMap: Record<HardwareNodeType, string> = {
  ac: 'AC', psu: 'PSU', vr: 'VR', psip: 'PSIP', busbar: 'BUSBAR',
  cpu: 'CPU', memory: 'MEM', fan: 'FAN', disk: 'DISK',
  io: 'IO', card: 'CARD', sensor: 'SENSOR', mgmtBoard: 'MGMT', chassis: 'CHASSIS',
  thermometer: 'THERM', custom: 'CUSTOM', control: 'CTRL', view: 'VIEW',
};

interface NodeEditPanelProps {
  open: boolean;
  onClose: () => void;
  node: TopologyNode | null;
}

const NodeEditPanel: React.FC<NodeEditPanelProps> = ({ open, onClose, node }) => {
  const { updateNodeAlias, updateNodeCustomIconUrl, updateNodeColor, updateNodeApiConfig, updateNodeControlConfig, updateNodeViewConfig, updateNodeFieldMappings, updateNodePowerDomainFieldMappings } = useDesignTopologyStore();

  const [alias, setAlias] = useState('');
  const [controlConfig, setControlConfig] = useState<ControlConfig>({ controlShell: '', mode: 'range' });
  const [viewConfig, setViewConfig] = useState<ViewConfig>({ purpose: '', command: '', params: [] });
  const [controlOptionInput, setControlOptionInput] = useState('');
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [powerDomainFieldMappings, setPowerDomainFieldMappings] = useState<FieldMapping[]>([]);
  const [customFieldDefs, setCustomFieldDefs] = useState<{ fieldKey: string; label: string }[]>([]);
  const [fieldThresholds, setFieldThresholds] = useState<FieldThreshold[]>([]);
  const [activeThresholdField, setActiveThresholdField] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 同步外部 node 数据到本地状态 - 只在节点切换时同步，避免编辑时被重置
  useEffect(() => {
    if (node?.data) {
      setAlias(node.data.displayAlias || '');
      // 使用节点已有的字段映射，或该类型的默认映射
      const existingMappings = node.data.apiConfig?.fieldMappings;
      setFieldMappings(existingMappings || []);
      // 使用节点已有的电源域字段映射
      const existingDomainMappings = node.data.apiConfig?.powerDomainFieldMappings;
      setPowerDomainFieldMappings(existingDomainMappings || []);
      // 使用节点已有的自定义字段定义
      setCustomFieldDefs(node.data.apiConfig?.customFieldDefs || []);
      // 使用节点已有的阈值配置，或该类型的默认阈值
      const existingThresholds = node.data.apiConfig?.fieldThresholds;
      setFieldThresholds(existingThresholds || []);
      // 使用节点已有的控制配置（控制模块专用）
      const existingControl = (node.data as { controlConfig?: ControlConfig }).controlConfig;
      setControlConfig(existingControl || { controlShell: '', mode: 'range' });
      // 使用节点已有的查看配置（查看组件专用）
      const existingView = (node.data as { viewConfig?: ViewConfig }).viewConfig;
      setViewConfig(existingView || { purpose: '', command: '', params: [] });
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

  // 预设渲染颜色
  const PRESET_NODE_COLORS = [
    '#1677ff', // 蓝
    '#52c41a', // 绿
    '#faad14', // 黄
    '#ff7a45', // 橙
    '#f5222d', // 红
    '#722ed1', // 紫
    '#13c2c2', // 青
    '#eb2f96', // 粉
    '#2f54eb', // 靛
    '#8c8c8c', // 灰
  ];

  // 保存渲染颜色
  const handleSaveColor = useCallback((color: string | undefined) => {
    if (!node) return;
    updateNodeColor(node.id, color);
    if (color) {
      message.success('渲染颜色已设置');
    } else {
      message.success('已恢复默认颜色');
    }
  }, [node, updateNodeColor]);

  // 保存 API 配置
  const handleSaveApiConfig = useCallback(() => {
    if (!node) return;
    const config: ApiConfig = {};
    // 保存字段映射（只要 fieldKey 存在即可，BMC 字段名可为空）
    config.fieldMappings = fieldMappings.filter(m => m.fieldKey);
    // 保存电源域字段映射（用于"电源域详情"弹窗）
    config.powerDomainFieldMappings = powerDomainFieldMappings.filter(m => m.fieldKey);
    // 保存自定义字段定义
    config.customFieldDefs = customFieldDefs.filter(d => d.fieldKey && d.label);
    // 保存阈值配置（过滤掉空范围）
    config.fieldThresholds = fieldThresholds.filter(t => t.fieldKey && t.ranges.length > 0);
    updateNodeApiConfig(node.id, config);
    message.success('字段映射配置已保存');
  }, [node, fieldMappings, powerDomainFieldMappings, customFieldDefs, fieldThresholds, updateNodeApiConfig]);

  // 保存控制配置（控制模块专用）
  const handleSaveControlConfig = useCallback(() => {
    if (!node) return;
    const config: ControlConfig = {
      purpose: (controlConfig.purpose || '').trim(),
      controlShell: (controlConfig.controlShell || '').trim(),
      mode: controlConfig.mode,
      rangeMin: controlConfig.rangeMin,
      rangeMax: controlConfig.rangeMax,
      rangeStep: controlConfig.rangeStep,
      rangeUnit: controlConfig.rangeUnit,
      options: controlConfig.options || [],
    };
    updateNodeControlConfig(node.id, config);
    message.success('控制配置已保存');
  }, [node, controlConfig, updateNodeControlConfig]);

  // 解析命令中的参数占位符，同步到参数列表
  const handleViewParseParams = useCallback(() => {
    const names = extractCommandParams(viewConfig.command || '');
    if (names.length === 0) {
      message.info('命令中未找到 {参数} 占位符');
      return;
    }
    setViewConfig((prev) => {
      const existing = new Map((prev.params || []).map((p) => [p.name, p]));
      const merged: ViewParamDef[] = names.map((name) => {
        const old = existing.get(name);
        return old
          ? { ...old }
          : { name, label: name, encrypted: false };
      });
      return { ...prev, params: merged };
    });
    message.success(`已解析 ${names.length} 个参数`);
  }, [viewConfig.command]);

  // 更新某个参数定义（显示名 / 是否加密）
  const handleViewParamChange = useCallback((idx: number, updates: Partial<ViewParamDef>) => {
    setViewConfig((prev) => {
      const params = (prev.params || []).map((p, i) => (i === idx ? { ...p, ...updates } : p));
      return { ...prev, params };
    });
  }, []);

  // 删除某个参数定义
  const handleViewParamRemove = useCallback((idx: number) => {
    setViewConfig((prev) => {
      const params = (prev.params || []).filter((_, i) => i !== idx);
      return { ...prev, params };
    });
  }, []);

  // 保存查看配置（查看组件专用）
  const handleSaveViewConfig = useCallback(() => {
    if (!node) return;
    const config: ViewConfig = {
      purpose: (viewConfig.purpose || '').trim(),
      command: (viewConfig.command || '').trim(),
      params: (viewConfig.params || []).map((p) => ({
        name: p.name,
        label: p.label || p.name,
        encrypted: !!p.encrypted,
      })),
    };
    updateNodeViewConfig(node.id, config);
    message.success('查看配置已保存');
  }, [node, viewConfig, updateNodeViewConfig]);

  // 解析固定选项输入（支持逗号/空格分隔）
  // 支持两种形态：
  //   1. 简单：`10` / `balance` → 显示值与下发值相同
  //   2. 成对：`自动:mode=0` / `手动:mode=1` → UI 显示中文，下发英文值
  // 成对格式用最后一个冒号分隔（value 本身可能含冒号，如 http://）
  const handleParseOptions = useCallback((raw: string): ControlOptionItem[] => {
    return raw
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const sepIdx = s.lastIndexOf(':');
        if (sepIdx > 0) {
          const label = s.slice(0, sepIdx).trim();
          const value = s.slice(sepIdx + 1).trim();
          if (label && value) {
            return { label, value: /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value };
          }
        }
        // 简单形态：纯数字（含小数/负数）转成 number，其余保留字符串
        return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
      });
  }, []);

  // 更新某个固定选项的专属命令模板；简单形态（number/string）填了命令后升级为成对形态
  const handleOptionShellChange = useCallback((idx: number, shell: string) => {
    setControlConfig((prev) => {
      const options = prev.options || [];
      const next = options.map((opt, i) => {
        if (i !== idx) return opt;
        const trimmed = shell.trim();
        if (typeof opt === 'object' && opt !== null && 'label' in opt && 'value' in opt) {
          return { ...opt, shell: trimmed || undefined };
        }
        // 简单形态：若有专属命令则升级为成对形态，label/value 用自身
        if (trimmed) {
          return { label: String(opt), value: opt, shell: trimmed };
        }
        return opt;
      });
      return { ...prev, options: next };
    });
  }, []);

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
      // CPU 额外恢复"电源域详情"内的固定字段映射
      if (nodeType === 'cpu') {
        const domainDefaults = defaultPowerDomainFieldMappings.cpu || [];
        const domainMappings: FieldMapping[] = domainDefaults.map(m => ({
          fieldKey: m.fieldKey,
          bmcField: m.bmcField || '',
        }));
        setPowerDomainFieldMappings(domainMappings);
        if (node) {
          updateNodePowerDomainFieldMappings(node.id, domainMappings);
        }
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
  }, [nodeType, node, updateNodeFieldMappings, updateNodePowerDomainFieldMappings]);

  // 清空所有字段映射
  const handleClearAllFieldMappings = useCallback(() => {
    setFieldMappings([]);
    setCustomFieldDefs([]);
    if (node) {
      updateNodeFieldMappings(node.id, []);
    }
    message.success('已清空所有字段');
  }, [node, updateNodeFieldMappings]);

  // ==================== 电源域字段映射（CPU 专用） ====================
  const [powerDomainFieldToAdd, setPowerDomainFieldToAdd] = useState<string | null>(null);

  const getPowerDomainFieldLabel = useCallback((fieldKey: string): string => {
    const def = CPU_POWER_DOMAIN_FIELD_DEFS.find(d => d.fieldKey === fieldKey);
    return def?.label || fieldKey;
  }, []);

  const handleAddPowerDomainFieldMapping = useCallback(() => {
    if (!powerDomainFieldToAdd) return;
    const usedKeys = new Set(powerDomainFieldMappings.map(m => m.fieldKey));
    if (usedKeys.has(powerDomainFieldToAdd)) {
      message.info('该字段已存在');
      return;
    }
    const def = CPU_POWER_DOMAIN_FIELD_DEFS.find(d => d.fieldKey === powerDomainFieldToAdd);
    if (def) {
      const next = [...powerDomainFieldMappings, { fieldKey: def.fieldKey, bmcField: '' }];
      setPowerDomainFieldMappings(next);
      setPowerDomainFieldToAdd(null);
      if (node) {
        updateNodePowerDomainFieldMappings(node.id, next);
      }
    }
  }, [powerDomainFieldToAdd, powerDomainFieldMappings, node, updateNodePowerDomainFieldMappings]);

  const handleRemovePowerDomainFieldMapping = useCallback((index: number) => {
    const next = powerDomainFieldMappings.filter((_, i) => i !== index);
    setPowerDomainFieldMappings(next);
    if (node) {
      updateNodePowerDomainFieldMappings(node.id, next);
    }
  }, [powerDomainFieldMappings, node, updateNodePowerDomainFieldMappings]);

  const handleUpdatePowerDomainFieldMapping = useCallback((index: number, updates: Partial<FieldMapping>) => {
    setPowerDomainFieldMappings(prev => {
      const next = prev.map((m, i) => i === index ? { ...m, ...updates } : m);
      if (node) {
        updateNodePowerDomainFieldMappings(node.id, next.filter(m => m.fieldKey));
      }
      return next;
    });
  }, [node, updateNodePowerDomainFieldMappings]);

  const handleMovePowerDomainFieldMapping = useCallback((index: number, direction: -1 | 1) => {
    setPowerDomainFieldMappings(prev => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      if (node) {
        updateNodePowerDomainFieldMappings(node.id, next.filter(m => m.fieldKey));
      }
      return next;
    });
  }, [node, updateNodePowerDomainFieldMappings]);

  const handleRestorePowerDomainDefaults = useCallback(() => {
    const domainDefaults = defaultPowerDomainFieldMappings.cpu || [];
    const domainMappings: FieldMapping[] = domainDefaults.map(m => ({
      fieldKey: m.fieldKey,
      bmcField: m.bmcField || '',
    }));
    setPowerDomainFieldMappings(domainMappings);
    if (node) {
      updateNodePowerDomainFieldMappings(node.id, domainMappings);
    }
    message.success('已恢复电源域默认字段映射');
  }, [node, updateNodePowerDomainFieldMappings]);

  const handleClearPowerDomainMappings = useCallback(() => {
    setPowerDomainFieldMappings([]);
    if (node) {
      updateNodePowerDomainFieldMappings(node.id, []);
    }
    message.success('已清空电源域字段');
  }, [node, updateNodePowerDomainFieldMappings]);

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

      <Divider style={{ margin: '8px 0' }} />

      {/* 渲染颜色 */}
      <div>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          <ApartmentOutlined /> 渲染颜色
        </Text>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          选择后卡片整体（边框 / 图标区 / 标题）使用该主题色，监控页同样生效。
        </Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {PRESET_NODE_COLORS.map((c) => {
            const active = node?.data?.nodeColor === c;
            return (
              <div
                key={c}
                onClick={() => handleSaveColor(c)}
                title={c}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: c,
                  cursor: 'pointer',
                  border: active ? '2px solid #000' : '2px solid #fff',
                  boxShadow: active ? '0 0 0 2px #1677ff' : '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            );
          })}
          {node?.data?.nodeColor && (
            <div
              onClick={() => handleSaveColor(undefined)}
              title="恢复默认"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                cursor: 'pointer',
                border: '1px dashed #d9d9d9',
                color: '#8c8c8c',
                background: '#fafafa',
              }}
            >
              ✕
            </div>
          )}
        </div>
      </div>
    </div>
  );

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

  // 判断字段是否为该模块用于链路损耗计算的字段，返回其角色标注
  const getFieldLossRole = (fieldKey: string): { role: 'source' | 'target' | 'both'; label: string } | null => {
    if (!nodeType) return null;
    const annotation = getNodeLossFieldAnnotation(nodeType);
    if (!annotation) return null;
    if (annotation.source && annotation.target && annotation.source.key === annotation.target.key) {
      return annotation.source.key === fieldKey ? { role: 'both', label: '链路损耗计算字段' } : null;
    }
    if (annotation.source?.key === fieldKey) return { role: 'source', label: '链路损耗·上游输出' };
    if (annotation.target?.key === fieldKey) return { role: 'target', label: '链路损耗·下游输入' };
    return null;
  };

  // 链路损耗计算字段说明（用于字段映射页顶部提示）
  const lossAnnotation = nodeType ? getNodeLossFieldAnnotation(nodeType) : null;

  const renderApiTab = () => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* 链路损耗计算字段说明 */}
        {lossAnnotation && (
          <div style={{ padding: 12, background: '#fff7e6', borderRadius: 6, border: '1px solid #ffd591' }}>
            <Text strong style={{ fontSize: 13, color: '#d46b08', display: 'block', marginBottom: 4 }}>
              <InfoCircleOutlined /> 链路损耗计算字段
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              连线损耗 = 上游模块输出功率 − 下游模块输入功率。本模块参与计算的字段：
              {lossAnnotation.source && lossAnnotation.target
                ? lossAnnotation.source.key === lossAnnotation.target.key
                  ? ` ${lossAnnotation.source.label}（${lossAnnotation.source.key}）`
                  : ` 上游(源)用 ${lossAnnotation.source.label}（${lossAnnotation.source.key}），下游(目标)用 ${lossAnnotation.target.label}（${lossAnnotation.target.key}）`
                : lossAnnotation.source
                  ? ` ${lossAnnotation.source.label}（${lossAnnotation.source.key}）`
                  : lossAnnotation.target
                    ? ` ${lossAnnotation.target.label}（${lossAnnotation.target.key}）`
                    : ' 无'}
            </Text>
          </div>
        )}

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
            {fieldMappings.map((mapping, index) => {
              const lossRole = getFieldLossRole(mapping.fieldKey);
              return (
              <div key={index} style={{ 
                display: 'flex', 
                gap: 8, 
                alignItems: 'center',
                padding: 12,
                background: '#f6f8fa',
                borderRadius: 6,
                border: lossRole ? `1px solid ${lossRole.role === 'source' ? '#91caff' : lossRole.role === 'target' ? '#d3adf7' : '#ffe58f'}` : '1px solid #e8e8e8',
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
                  {lossRole && (
                    <Tag
                      color={lossRole.role === 'source' ? 'blue' : lossRole.role === 'target' ? 'purple' : 'gold'}
                      style={{ marginTop: 4, fontSize: 10 }}
                    >
                      {lossRole.label}
                    </Tag>
                  )}
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
              );
            })}
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

        {/* CPU 电源域详情字段映射（仅在"电源域详情"弹窗内使用） */}
        {nodeType === 'cpu' && (
          <>
            <Divider style={{ margin: '4px 0' }} />
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Title level={5} style={{ margin: 0 }}>
                  <ApartmentOutlined /> 电源域详情字段映射
                </Title>
                <Space>
                  <Button size="small" danger onClick={handleClearPowerDomainMappings}>
                    清空所有
                  </Button>
                  <Button size="small" onClick={handleRestorePowerDomainDefaults}>
                    恢复默认
                  </Button>
                </Space>
              </div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                配置"电源域详情"按钮内各电源域的输出电压 / 输出电流 / 输出功率对应的 BMC Sensor 名称
              </Text>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {powerDomainFieldMappings.length === 0 && (
                  <div style={{
                    padding: 24,
                    textAlign: 'center',
                    background: '#f5f5f5',
                    borderRadius: 6,
                    color: '#8c8c8c',
                  }}>
                    暂无电源域字段映射，点击"恢复默认"开始使用
                  </div>
                )}
                {powerDomainFieldMappings.map((mapping, index) => (
                  <div key={index} style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    padding: 12,
                    background: '#f6f8fa',
                    borderRadius: 6,
                    border: '1px solid #e8e8e8',
                  }}>
                    <div style={{ flex: '0 0 220px' }}>
                      <Text style={{ fontSize: 12, display: 'block', marginBottom: 4, color: '#595959' }}>字段名</Text>
                      <Text strong style={{ fontSize: 12 }}>{getPowerDomainFieldLabel(mapping.fieldKey)}</Text>
                    </div>
                    <div style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>BMC Sensor 名称</Text>
                      <Input
                        placeholder="如：TA_CORE_DVFS_VOUT"
                        value={mapping.bmcField}
                        onChange={(e) => handleUpdatePowerDomainFieldMapping(index, { bmcField: e.target.value })}
                        size="small"
                      />
                    </div>
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowUpOutlined />}
                      onClick={() => handleMovePowerDomainFieldMapping(index, -1)}
                      disabled={index === 0}
                      style={{ marginTop: 20 }}
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowDownOutlined />}
                      onClick={() => handleMovePowerDomainFieldMapping(index, 1)}
                      disabled={index === powerDomainFieldMappings.length - 1}
                      style={{ marginTop: 20 }}
                    />
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemovePowerDomainFieldMapping(index)}
                      style={{ marginTop: 20 }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, display: 'block', marginBottom: 4, color: '#595959' }}>添加电源域字段</Text>
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    placeholder="选择要添加的电源域字段"
                    value={powerDomainFieldToAdd}
                    onChange={(v) => setPowerDomainFieldToAdd(v)}
                    options={(() => {
                      const usedKeys = new Set(powerDomainFieldMappings.map(m => m.fieldKey));
                      return CPU_POWER_DOMAIN_FIELD_DEFS
                        .filter(d => !usedKeys.has(d.fieldKey))
                        .map(d => ({ value: d.fieldKey, label: `${d.label} (${d.fieldKey})` }));
                    })()}
                  />
                </div>
                <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleAddPowerDomainFieldMapping} disabled={!powerDomainFieldToAdd}>
                  添加
                </Button>
              </div>
            </div>
          </>
        )}

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
              {fieldMappings.map(mapping => {
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

  // 控制配置 Tab（控制模块专用）
  const renderControlTab = () => {
    if (!nodeType || nodeType !== 'control') return null;

    const set = (patch: Partial<ControlConfig>) =>
      setControlConfig((prev) => ({ ...prev, ...patch }));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 控制用途 */}
        <div>
          <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
            <ControlOutlined /> 用途
          </Title>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            自定义这个控制的用途说明，将在拓扑监控页面的模块卡片上显示。
          </Text>
          <Input
            placeholder="如：风扇转速调节 / CPU 功耗限制 / 电源模式切换"
            value={controlConfig.purpose || ''}
            onChange={(e) => set({ purpose: e.target.value })}
          />
        </div>

        <Divider style={{ margin: '4px 0' }} />

        {/* 控制命令 */}
        <div>
          <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
            <ControlOutlined /> 控制命令
          </Title>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            配置发往 BMC 的控制 Shell 命令，使用 {'{value}'} 占位符表示调节值，系统将通过 SSH 下发到 BMC 执行。
          </Text>
          <Input.TextArea
            rows={3}
            placeholder="如：ipmitool -I lanplus -H {ip} -U {user} -P {pass} raw 0x30 0x45 0x01 {value}"
            value={controlConfig.controlShell}
            onChange={(e) => set({ controlShell: e.target.value })}
          />
        </div>

        <Divider style={{ margin: '4px 0' }} />

        {/* 控制范围方式 */}
        <div>
          <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
            <ControlOutlined /> 控制范围
          </Title>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
            选择范围式（连续可调）或固定选项（离散数值），两种都可配置，之后监控界面据此生成调节控件。
          </Text>

          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <Button
              type={controlConfig.mode === 'range' ? 'primary' : 'default'}
              onClick={() => set({ mode: 'range' })}
            >
              范围式
            </Button>
            <Button
              type={controlConfig.mode === 'options' ? 'primary' : 'default'}
              onClick={() => set({ mode: 'options' })}
            >
              固定选项
            </Button>
          </div>

          {/* 范围式配置 */}
          {controlConfig.mode === 'range' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <Text style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>最小值</Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    value={controlConfig.rangeMin ?? 0}
                    onChange={(v) => set({ rangeMin: v ?? undefined })}
                    placeholder="最小值"
                  />
                </div>
                <span style={{ marginTop: 20 }}>~</span>
                <div style={{ flex: 1 }}>
                  <Text style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>最大值</Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    value={controlConfig.rangeMax ?? 100}
                    onChange={(v) => set({ rangeMax: v ?? undefined })}
                    placeholder="最大值"
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <Text style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>步进</Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    value={controlConfig.rangeStep ?? 1}
                    onChange={(v) => set({ rangeStep: v ?? undefined })}
                    placeholder="步进"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Text style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>单位</Text>
                  <Input
                    style={{ width: '100%' }}
                    value={controlConfig.rangeUnit || ''}
                    onChange={(e) => set({ rangeUnit: e.target.value })}
                    placeholder="如 % / V / RPM"
                  />
                </div>
              </div>
            </div>
          ) : (
            /* 固定选项配置 */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Text style={{ display: 'block', fontSize: 12 }}>固定选项（逗号或空格分隔）。简单值如 10 / balance；如需 UI 显示中文、下发英文值，用冒号成对：自动:mode=0。每个选项还可单独配置专属命令（留空则用上方全局命令）。</Text>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <Input
                  style={{ flex: 1 }}
                  value={controlOptionInput}
                  onChange={(e) => setControlOptionInput(e.target.value)}
                  placeholder="如：10, 20, 30, 40, 50 或 自动:mode=0, 手动:mode=1"
                  onPressEnter={() => {
                    set({ options: handleParseOptions(controlOptionInput) });
                    setControlOptionInput('');
                  }}
                />
                <Button
                  type="primary"
                  onClick={() => {
                    set({ options: handleParseOptions(controlOptionInput) });
                    setControlOptionInput('');
                  }}
                >
                  添加
                </Button>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flex: '0 0 120px' }}>
                  <Text style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>单位</Text>
                  <Input
                    style={{ width: '100%' }}
                    value={controlConfig.rangeUnit || ''}
                    onChange={(e) => set({ rangeUnit: e.target.value })}
                    placeholder="如 % / V / RPM"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Text style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>当前选项</Text>
                  {(controlConfig.options || []).length === 0 ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>暂无固定选项</Text>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(controlConfig.options || []).map((opt, idx) => {
                        // 成对选项显示“中文标签 (下发值)”，简单形态保持原样
                        const isPair = typeof opt === 'object' && opt !== null && 'label' in opt && 'value' in opt;
                        const display = isPair
                          ? `${(opt as { label: string }).label} (${(opt as { value: number | string }).value})`
                          : typeof opt === 'number'
                            ? `${opt}${controlConfig.rangeUnit || ''}`
                            : String(opt);
                        const optShell = isPair
                          ? ((opt as { shell?: string }).shell ?? '')
                          : '';
                        return (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              gap: 6,
                              alignItems: 'center',
                              padding: 6,
                              background: '#fafafa',
                              borderRadius: 4,
                              border: '1px solid #f0f0f0',
                            }}
                          >
                            <Tag closable color="purple" onClose={() => set({ options: (controlConfig.options || []).filter((_, i) => i !== idx) })}>
                              {display}
                            </Tag>
                            <Input
                              size="small"
                              style={{ flex: 1, minWidth: 0 }}
                              placeholder="专属命令（留空则用上方全局命令）"
                              value={optShell}
                              onChange={(e) => handleOptionShellChange(idx, e.target.value)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <Divider style={{ margin: '4px 0' }} />

        <Button type="primary" onClick={handleSaveControlConfig} block>
          保存控制配置
        </Button>
      </div>
    );
  };

  // 查看配置 Tab（查看组件专用）
  const renderViewTab = () => {
    if (!nodeType || nodeType !== 'view') return null;

    const set = (patch: Partial<ViewConfig>) =>
      setViewConfig((prev) => ({ ...prev, ...patch }));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 查看用途 */}
        <div>
          <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
            <EyeOutlined /> 用途
          </Title>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            自定义这个查看的用途说明，将在拓扑监控页面的模块卡片上显示。
          </Text>
          <Input
            placeholder="如：查询服务器健康状态 / 读取整机功耗"
            value={viewConfig.purpose || ''}
            onChange={(e) => set({ purpose: e.target.value })}
          />
        </div>

        <Divider style={{ margin: '4px 0' }} />

        {/* 查看命令 */}
        <div>
          <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
            <EyeOutlined /> 查看命令
          </Title>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            配置通过 SSH 在已连接 BMC 上执行的查询命令，使用 {'{参数名}'} 占位符。保存前点击“解析参数”可自动从命令中提取参数。
          </Text>
          <Input.TextArea
            rows={3}
            placeholder="如：ssh {user}@{ip}:{password} hello"
            value={viewConfig.command || ''}
            onChange={(e) => set({ command: e.target.value })}
          />
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleViewParseParams}
            style={{ marginTop: 8 }}
          >
            解析参数
          </Button>
        </div>

        <Divider style={{ margin: '4px 0' }} />

        {/* 参数定义列表 */}
        <div>
          <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
            <EyeOutlined /> 参数定义
          </Title>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            在监控页面查看时，会要求填写这些参数。可设置“加密”，加密参数用密码框输入且不回显。
          </Text>
          {(viewConfig.params || []).length === 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              暂无参数，请先在上方填写命令并点击“解析参数”。
            </Text>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(viewConfig.params || []).map((p, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    padding: 8,
                    background: '#fafafa',
                    borderRadius: 4,
                    border: '1px solid #f0f0f0',
                  }}
                >
                  <Input
                    size="small"
                    style={{ flex: '0 0 110px' }}
                    value={p.name}
                    disabled
                    title="参数名（来自命令占位符，不可修改）"
                  />
                  <Input
                    size="small"
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="显示名（可选）"
                    value={p.label || p.name}
                    onChange={(e) => handleViewParamChange(idx, { label: e.target.value })}
                  />
                  <Select
                    size="small"
                    style={{ flex: '0 0 84px' }}
                    value={p.encrypted ? 'encrypted' : 'plain'}
                    onChange={(v) => handleViewParamChange(idx, { encrypted: v === 'encrypted' })}
                    options={[
                      { value: 'plain', label: '普通' },
                      { value: 'encrypted', label: '加密' },
                    ]}
                  />
                  <Button
                    size="small"
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => handleViewParamRemove(idx)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <Divider style={{ margin: '4px 0' }} />

        <Button type="primary" onClick={handleSaveViewConfig} block>
          保存查看配置
        </Button>
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
            {
              key: 'api',
              label: <span><ApiOutlined /> 字段映射</span>,
              children: renderApiTab(),
            },
            ...(nodeType === 'control'
              ? [{
                  key: 'control',
                  label: <span><ControlOutlined /> 控制配置</span>,
                  children: renderControlTab(),
                }]
              : []),
            ...(nodeType === 'view'
              ? [{
                  key: 'view',
                  label: <span><EyeOutlined /> 查看配置</span>,
                  children: renderViewTab(),
                }]
              : []),
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
