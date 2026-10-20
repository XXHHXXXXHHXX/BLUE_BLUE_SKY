'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { Slider, Button, message, Tooltip, Modal } from 'antd';
import NodeIcon from './NodeIcon';
import { getNodeDisplayLabel } from '../../../utils/formatters';
import type { ControlConfig, ControlOption, ControlOptionItem } from '../../../types/topology';
import { useBMCSessionStore } from '../../../stores/bmcSessionStore';
import { executeControlCommand } from '../../../services/backendApi';

/** 生成步进点标记：0~100 步进 25 → {0,25,50,75,100} */
function buildSliderMarks(min: number, max: number, step: number, unit: string): Record<number, React.ReactNode> {
  const marks: Record<number, React.ReactNode> = {};
  if (step <= 0 || max <= min) {
    marks[min] = `${min}${unit}`;
    marks[max] = `${max}${unit}`;
    return marks;
  }
  const count = Math.max(1, Math.round((max - min) / step));
  for (let i = 0; i <= count; i++) {
    const v = min + i * step;
    if (v <= max + 1e-9) {
      marks[Math.round(v * 100) / 100] = `${Math.round(v * 100) / 100}${unit}`;
    }
  }
  return marks;
}

/** 判断选项是否为成对形态（label + value） */
function isPairOption(opt: ControlOptionItem): opt is ControlOption {
  return typeof opt === 'object' && opt !== null && 'label' in opt && 'value' in opt;
}

/** 获取选项的 UI 显示文本：成对显示 label，数字带单位，字符串原样 */
function getOptionLabel(opt: ControlOptionItem, unit: string): string {
  if (isPairOption(opt)) return opt.label;
  return typeof opt === 'number' ? `${opt}${unit}` : String(opt);
}

/** 获取选项的实际下发值：成对取 value，简单形态取自身 */
function getOptionValue(opt: ControlOptionItem): number | string {
  return isPairOption(opt) ? opt.value : opt;
}

/** 获取选项专属命令模板：成对形态且配置了 shell 时返回，否则返回 undefined（回退全局命令） */
function getOptionShell(opt: ControlOptionItem): string | undefined {
  if (isPairOption(opt) && typeof opt.shell === 'string' && opt.shell.trim()) {
    return opt.shell.trim();
  }
  return undefined;
}

const ControlNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    displayAlias?: string;
    customIcon?: string;
    customIconUrl?: string;
    nodeType?: string;
    controlConfig?: ControlConfig;
  };

  // 设计模式（_mode === 'design'）只做静态展示；监控模式渲染交互控件
  const isDesignMode = (props.data as Record<string, unknown>)?._mode === 'design';

  const controlConfig = data.controlConfig || {
    purpose: '',
    controlShell: '',
    mode: 'range' as const,
    rangeMin: 0,
    rangeMax: 100,
    rangeStep: 1,
    rangeUnit: '%',
    options: [],
  };

  const command = controlConfig.controlShell?.trim();
  const mode = controlConfig.mode;
  const unit = controlConfig.rangeUnit || '';

  // 响应式订阅 BMC 会话（订阅稳定引用，避免每次渲染返回新对象导致循环渲染）
  const sessions = useBMCSessionStore((s) => s.sessions);
  const connectedSessionId = useBMCSessionStore((s) => s.connectedSessionId);
  const bmcConfig = useMemo(() => {
    const session = sessions.find((s) => s.id === connectedSessionId);
    if (!session) return null;
    const { id: _id, name: _name, ...config } = session;
    return config;
  }, [sessions, connectedSessionId]);
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState<{ value: number | string; time: string } | null>(null);

  /** 选项展示：数字带单位，字符串忽略单位 */
  const formatOption = useCallback((v: number | string) => {
    return typeof v === 'number' ? `${v}${unit}` : v;
  }, [unit]);

  /** 真正下发指定值到 BMC（确认通过后调用）。shell 传入时用选项专属命令，否则用全局命令 */
  const doSend = useCallback(
    async (value: number | string, shell?: string) => {
      const finalShell = shell || command;
      if (!finalShell) {
        message.warning('控制命令未配置');
        return;
      }
      if (!bmcConfig) {
        message.warning('未连接 BMC，请先在监控配置中连接 BMC');
        return;
      }
      setSending(true);
      try {
        const result = await executeControlCommand(bmcConfig, finalShell, value);
        if (result.success) {
          message.success(`已下发 ${formatOption(value)}`);
          setLastSent({ value, time: new Date().toLocaleTimeString() });
        } else {
          message.error(result.message || '命令下发失败');
        }
      } finally {
        setSending(false);
      }
    },
    [command, bmcConfig, formatOption],
  );

  /** 点击控制时先弹确认框，确认后才下发，避免误操作 */
  const handleSend = useCallback(
    (value: number | string, shell?: string) => {
      const finalShell = shell || command;
      if (!finalShell) {
        message.warning('控制命令未配置');
        return;
      }
      if (!bmcConfig) {
        message.warning('未连接 BMC，请先在监控配置中连接 BMC');
        return;
      }
      Modal.confirm({
        title: '确认下发控制命令',
        content: (
          <div>
            确定要下发 <b>{formatOption(value)}</b> 到当前 BMC 吗？
            {finalShell !== command && (
              <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>
                使用选项专属命令：{finalShell}
              </div>
            )}
          </div>
        ),
        okText: '确认下发',
        cancelText: '取消',
        onOk: () => doSend(value, shell),
      });
    },
    [command, bmcConfig, formatOption, doSend],
  );

  // 范围式参数
  const rangeMin = controlConfig.rangeMin ?? 0;
  const rangeMax = controlConfig.rangeMax ?? 100;
  const rangeStep = controlConfig.rangeStep && controlConfig.rangeStep > 0 ? controlConfig.rangeStep : 1;
  const options = controlConfig.options || [];

  // 控制用途（自定义描述，监控页卡片显示；未配置则不显示）
  const purpose = controlConfig.purpose?.trim();

  return (
    <div className="hardware-node control-node">
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon
            nodeType="control"
            customIcon={data.customIcon as string | undefined}
            customIconUrl={data.customIconUrl as string | undefined}
          />
        </div>
        <div className="node-info">
          <div className="node-header">
            <span>{getNodeDisplayLabel(data)}</span>
          </div>
          <div className="node-body">
            {purpose && (
              <div>
                用途：{purpose}
              </div>
            )}
          </div>
        </div>
      </div>

      {!isDesignMode && (
        <div className="control-node-interactive nodrag nopan" style={{ marginTop: 8, borderTop: '1px dashed #d3adf7', paddingTop: 8 }}>
          {mode === 'range' ? (
            <div style={{ padding: '0 8px' }}>
              <Slider
                min={rangeMin}
                max={rangeMax}
                step={rangeStep}
                marks={buildSliderMarks(rangeMin, rangeMax, rangeStep, unit)}
                defaultValue={rangeMin}
                disabled={sending}
                onAfterChange={(v) => {
                  if (typeof v === 'number') handleSend(v);
                }}
              />
              {lastSent && (
                <div style={{ fontSize: 11, color: '#8c8c8c', textAlign: 'center', marginTop: -6 }}>
                  最近下发：{formatOption(lastSent.value)}（{lastSent.time}）
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '0 8px' }}>
              {options.length === 0 ? (
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>未配置固定选项</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {options.map((opt, idx) => {
                    const label = getOptionLabel(opt, unit);
                    const value = getOptionValue(opt);
                    const optShell = getOptionShell(opt);
                    return (
                      <Tooltip key={idx} title={optShell ? `下发 ${formatOption(value)}（专属命令）` : `下发 ${formatOption(value)}`}>
                        <Button
                          size="small"
                          type={lastSent?.value === value ? 'primary' : 'default'}
                          loading={sending}
                          onClick={() => handleSend(value, optShell)}
                          style={{ borderColor: '#d3adf7' }}
                        >
                          {label}
                        </Button>
                      </Tooltip>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {!bmcConfig && (
            <div style={{ fontSize: 11, color: '#fa8c16', textAlign: 'center', marginTop: 6 }}>
              未连接 BMC，下发不可用
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ControlNode;
