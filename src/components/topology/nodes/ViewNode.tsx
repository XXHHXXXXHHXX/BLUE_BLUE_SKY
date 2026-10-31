'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { Button, Input, message } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import NodeIcon from './NodeIcon';
import { getNodeDisplayLabel } from '../../../utils/formatters';
import type { ViewConfig } from '../../../types/topology';
import { useBMCSessionStore } from '../../../stores/bmcSessionStore';
import { executeViewCommand } from '../../../services/backendApi';

const ViewNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    displayAlias?: string;
    customIcon?: string;
    customIconUrl?: string;
    nodeType?: string;
    viewConfig?: ViewConfig;
  };

  // 设计模式（_mode === 'design'）只做静态展示；监控模式渲染查看交互
  const isDesignMode = (props.data as Record<string, unknown>)?._mode === 'design';

  const viewConfig = data.viewConfig || { purpose: '', command: '', params: [] };
  const command = (viewConfig.command || '').trim();
  const params = viewConfig.params || [];

  // 响应式订阅 BMC 会话（订阅稳定引用，避免每次渲染返回新对象导致循环渲染）
  const sessions = useBMCSessionStore((s) => s.sessions);
  const connectedSessionId = useBMCSessionStore((s) => s.connectedSessionId);
  const bmcConfig = useMemo(() => {
    const session = sessions.find((s) => s.id === connectedSessionId);
    if (!session) return null;
    const { id: _id, name: _name, ...config } = session;
    return config;
  }, [sessions, connectedSessionId]);

  // 参数输入值（key 为参数名）
  const [values, setValues] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    text: string;
    time: string;
  } | null>(null);

  const handleView = useCallback(async () => {
    if (!command) {
      message.warning('查看命令未配置');
      return;
    }
    if (!bmcConfig) {
      message.warning('未连接 BMC，请先在监控配置中连接 BMC');
      return;
    }

    // 校验必填参数
    const missing = params.filter((p) => !values[p.name] || !values[p.name].trim());
    if (missing.length > 0) {
      message.warning(`请填写参数：${missing.map((p) => p.label || p.name).join('、')}`);
      return;
    }

    setViewing(true);
    try {
      const res = await executeViewCommand(bmcConfig, command, values);
      if (res.success) {
        const text = res.stdout ?? '';
        setResult({
          success: true,
          text,
          time: new Date().toLocaleTimeString(),
        });
      } else {
        const text = res.stderr || res.message || '命令执行失败';
        setResult({
          success: false,
          text,
          time: new Date().toLocaleTimeString(),
        });
        message.error(res.message || '命令执行失败');
      }
    } finally {
      setViewing(false);
    }
  }, [command, bmcConfig, params, values]);

  const purpose = viewConfig.purpose?.trim();

  return (
    <div className="hardware-node view-node">
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon
            nodeType="view"
            customIcon={data.customIcon as string | undefined}
            customIconUrl={data.customIconUrl as string | undefined}
          />
        </div>
        <div className="node-info">
          <div className="node-header">
            <span>{getNodeDisplayLabel(data)}</span>
          </div>
          <div className="node-body">
            {purpose && <div>用途：{purpose}</div>}
          </div>
        </div>
      </div>

      {!isDesignMode && (
        <div className="nodrag nopan" style={{ marginTop: 8, borderTop: '1px dashed #87e8de', paddingTop: 8 }}>
          {params.length === 0 ? (
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>未配置查看参数</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {params.map((p) => (
                <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      flex: '0 0 64px',
                      fontSize: 12,
                      color: '#595959',
                      textAlign: 'right',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.label || p.name}
                  </span>
                  <Input
                    size="small"
                    style={{ flex: 1, minWidth: 0 }}
                    type={p.encrypted ? 'password' : 'text'}
                    placeholder={p.encrypted ? '••••••' : `请输入${p.label || p.name}`}
                    value={values[p.name] || ''}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [p.name]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <Button
              size="small"
              type="primary"
              icon={<EyeOutlined />}
              loading={viewing}
              disabled={!command || params.length === 0}
              onClick={handleView}
              style={{ background: '#13c2c2', borderColor: '#13c2c2' }}
            >
              查看
            </Button>
            {result && (
              <span style={{ fontSize: 11, color: '#8c8c8c' }}>
                {result.success ? '已获取' : '执行失败'}（{result.time}）
              </span>
            )}
          </div>

          {result && (
            <pre
              style={{
                marginTop: 8,
                maxHeight: 120,
                overflow: 'auto',
                fontSize: 11,
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                padding: 6,
                borderRadius: 4,
                background: result.success ? '#f6ffed' : '#fff2f0',
                border: `1px solid ${result.success ? '#b7eb8f' : '#ffa39e'}`,
                color: result.success ? '#237804' : '#cf1322',
                marginBottom: 0,
              }}
            >
              {result.text}
            </pre>
          )}

          {!bmcConfig && (
            <div style={{ fontSize: 11, color: '#fa8c16', textAlign: 'center', marginTop: 6 }}>
              未连接 BMC，查看不可用
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ViewNode;
