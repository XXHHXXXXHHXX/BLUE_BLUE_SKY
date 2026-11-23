'use client';

/** AI 插件管理面板：查看内置/声明式插件，按插件启停
 *
 * 声明式插件放在 `.data/ai-plugins/*.json`，新增文件后点「重新加载」即可生效。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Empty, List, Modal, Space, Switch, Tag, Tooltip, Typography, message } from 'antd';
import { ReloadOutlined, ApiOutlined, CodeOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface PluginSummary {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'declarative';
  file?: string;
  enabled: boolean;
  toolNames: string[];
  promptHint?: string;
  error?: string;
}

interface AIPluginPanelProps {
  open: boolean;
  onClose: () => void;
}

const AIPluginPanel: React.FC<AIPluginPanelProps> = ({ open, onClose }) => {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [pluginsDir, setPluginsDir] = useState('');
  const [activeToolCount, setActiveToolCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchPlugins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/plugins');
      const data = await res.json();
      if (data.success) {
        setPlugins(data.plugins || []);
        setPluginsDir(data.pluginsDir || '');
        setActiveToolCount(data.activeToolCount || 0);
      } else {
        message.error(data.message || '读取插件失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '读取插件失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchPlugins();
  }, [open, fetchPlugins]);

  const togglePlugin = async (id: string, enabled: boolean) => {
    setTogglingId(id);
    try {
      const res = await fetch('/api/ai/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      });
      const data = await res.json();
      if (data.success) {
        setPlugins(data.plugins || []);
        setActiveToolCount(data.activeToolCount || 0);
        message.success(enabled ? '插件已启用' : '插件已禁用');
      } else {
        message.error(data.message || '更新失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      title={
        <Space>
          <ApiOutlined />
          <span>AI 插件管理</span>
          <Tag color="blue">{activeToolCount} 个工具生效</Tag>
        </Space>
      }
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="如何扩展能力"
        description={
          <div style={{ fontSize: 12 }}>
            在 <Text code>{pluginsDir || '.data/ai-plugins/'}</Text> 下新增 <Text code>*.json</Text> 文件即可声明 HTTP 工具插件，
            无需改代码；新增或修改文件后点「重新加载」生效。
          </div>
        }
      />

      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={fetchPlugins}>
          重新加载
        </Button>
      </div>

      {plugins.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '加载中…' : '暂无插件'} />
      ) : (
        <List
          dataSource={plugins}
          renderItem={(p) => (
            <List.Item
              actions={[
                <Tooltip key="toggle" title={p.error ? '插件加载失败，无法启用' : undefined}>
                  <Switch
                    size="small"
                    checked={p.enabled}
                    loading={togglingId === p.id}
                    disabled={!!p.error}
                    onChange={(checked) => togglePlugin(p.id, checked)}
                  />
                </Tooltip>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space wrap size={6}>
                    <span>{p.name}</span>
                    <Tag color={p.source === 'builtin' ? 'geekblue' : 'green'}>
                      {p.source === 'builtin' ? '内置' : '声明式'}
                    </Tag>
                    {p.file && <Text type="secondary" style={{ fontSize: 12 }}>{p.file}</Text>}
                    {p.error && <Tag color="red">加载失败</Tag>}
                  </Space>
                }
                description={
                  <div style={{ fontSize: 12 }}>
                    {p.description && <div>{p.description}</div>}
                    {p.error && (
                      <div style={{ color: '#ff4d4f', marginTop: 4 }}>
                        <CodeOutlined /> {p.error}
                      </div>
                    )}
                    {p.toolNames.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        {p.toolNames.map((t) => (
                          <Tag key={t} style={{ fontSize: 11, marginBottom: 2 }}>
                            {t}
                          </Tag>
                        ))}
                      </div>
                    )}
                    {p.promptHint && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        提示：{p.promptHint}
                      </Text>
                    )}
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
};

export default AIPluginPanel;
