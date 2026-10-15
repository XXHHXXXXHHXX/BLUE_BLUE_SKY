'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { Slider, Button, message, Tooltip } from 'antd';
import NodeIcon from './NodeIcon';
import { getNodeDisplayLabel } from '../../../utils/formatters';
import type { ControlConfig } from '../../../types/topology';
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
  const [lastSent, setLastSent] = useState<{ value: number; time: string } | null>(null);

  /** 下发指定值到 BMC */
  const handleSend = useCallback(
    async (value: number) => {
      if (!command) {
        message.warning('控制命令未配置');
        return;
      }
      if (!bmcConfig) {
        message.warning('未连接 BMC，请先在监控配置中连接 BMC');
        return;
      }
      setSending(true);
      try {
        const result = await executeControlCommand(bmcConfig, command, value);
        if (result.success) {
          message.success(`已下发 ${value}${unit}`);
          setLastSent({ value, time: new Date().toLocaleTimeString() });
        } else {
          message.error(result.message || '命令下发失败');
        }
      } finally {
        setSending(false);
      }
    },
    [command, bmcConfig, unit],
  );

  // 范围式参数
  const rangeMin = controlConfig.rangeMin ?? 0;
  const rangeMax = controlConfig.rangeMax ?? 100;
  const rangeStep = controlConfig.rangeStep && controlConfig.rangeStep > 0 ? controlConfig.rangeStep : 1;
  const options = controlConfig.options || [];

  const rangeText = mode === 'range'
    ? `${rangeMin} ~ ${rangeMax}${unit}`
    : (options.length ? options.map((o) => `${o}${unit}`).join(' / ') : '未配置');

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
            <div>
              命令：{command ? command.length > 18 ? `${command.slice(0, 18)}…` : command : '未配置'}
            </div>
            <div>
              范围：{rangeText}
            </div>
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
                  最近下发：{lastSent.value}{unit}（{lastSent.time}）
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '0 8px' }}>
              {options.length === 0 ? (
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>未配置固定选项</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {options.map((opt, idx) => (
                    <Tooltip key={idx} title={`下发 ${opt}${unit}`}>
                      <Button
                        size="small"
                        type={lastSent?.value === opt ? 'primary' : 'default'}
                        loading={sending}
                        onClick={() => handleSend(opt)}
                        style={{ borderColor: '#d3adf7' }}
                      >
                        {opt}{unit}
                      </Button>
                    </Tooltip>
                  ))}
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
