'use client';

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Button,
  Table,
  Input,
  Space,
  Typography,
  message,
  Tabs,
  Upload,
  Alert,
} from 'antd';
import type { UploadFile } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ImportOutlined,
  ExportOutlined,
  SaveOutlined,
  CopyOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons';
import type { TestReport } from '../../stores/testReportStore';

const { Text } = Typography;
const { TextArea } = Input;

interface EnvironmentInfoModalProps {
  open: boolean;
  report: TestReport | null;
  onClose: () => void;
  onSave: (report: TestReport, environment: Record<string, string>) => void;
}

type EnvEntry = { key: string; value: string; id: string };

const EnvironmentInfoModal: React.FC<EnvironmentInfoModalProps> = ({
  open,
  report,
  onClose,
  onSave,
}) => {
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [importText, setImportText] = useState('');
  const [activeTab, setActiveTab] = useState('edit');
  const [importError, setImportError] = useState<string>('');

  useEffect(() => {
    if (open && report) {
      const env = report.environment || {};
      setEntries(
        Object.entries(env).map(([k, v], idx) => ({
          key: k,
          value: v,
          id: `${idx}-${k}`,
        }))
      );
      setImportText('');
      setImportError('');
      setActiveTab('edit');
    }
  }, [open, report]);

  const updateEntry = (id: string, field: 'key' | 'value', value: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  };

  const addEntry = () => {
    setEntries((prev) => [...prev, { key: '', value: '', id: `new-${Date.now()}` }]);
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const getEnvironmentObject = (): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const e of entries) {
      if (e.key.trim()) {
        result[e.key.trim()] = e.value;
      }
    }
    return result;
  };

  const exportEnvironment = () => {
    const env = getEnvironmentObject();
    const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report?.name || 'report'}-environment.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    message.success('环境信息已导出');
  };

  const parseImportText = (text: string): Record<string, string> | null => {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const result: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          result[k] = String(v);
        }
        return result;
      }
      if (Array.isArray(parsed)) {
        const result: Record<string, string> = {};
        for (const item of parsed) {
          if (item && typeof item === 'object') {
            const key = item.key || item.name || item.k;
            const value = item.value || item.v || item.val;
            if (key !== undefined) {
              result[String(key)] = String(value ?? '');
            }
          }
        }
        return result;
      }
      return null;
    } catch {
      // 尝试解析 key=value 或 key:value 行
      const result: Record<string, string> = {};
      const lines = text.split(/\r?\n/);
      let hasValid = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([^=:]+)[=:]\s*(.*)$/);
        if (match) {
          result[match[1].trim()] = match[2].trim();
          hasValid = true;
        }
      }
      return hasValid ? result : null;
    }
  };

  const applyImport = () => {
    setImportError('');
    if (!importText.trim()) {
      setImportError('请输入或粘贴环境信息');
      return;
    }
    const parsed = parseImportText(importText.trim());
    if (!parsed) {
      setImportError('无法解析，请检查 JSON 或 key=value / key:value 格式');
      return;
    }
    const newEntries: EnvEntry[] = Object.entries(parsed).map(([k, v], idx) => ({
      key: k,
      value: v,
      id: `import-${Date.now()}-${idx}`,
    }));
    setEntries(newEntries);
    setImportText('');
    setActiveTab('edit');
    message.success(`已导入 ${newEntries.length} 条环境信息`);
  };

  const handleFileChange = (info: { file: UploadFile }) => {
    const { file } = info;
    if (!file.originFileObj) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || '');
      setImportText(text);
      const parsed = parseImportText(text);
      if (parsed) {
        setImportError('');
      } else {
        setImportError('文件内容无法解析');
      }
    };
    reader.readAsText(file.originFileObj);
  };

  const copyExportText = () => {
    const text = JSON.stringify(getEnvironmentObject(), null, 2);
    navigator.clipboard.writeText(text).then(() => message.success('已复制到剪贴板'));
  };

  const columns = [
    {
      title: '键',
      dataIndex: 'key',
      render: (_: unknown, record: EnvEntry) => (
        <Input
          placeholder="例如: CPU"
          value={record.key}
          onChange={(e) => updateEntry(record.id, 'key', e.target.value)}
        />
      ),
    },
    {
      title: '值',
      dataIndex: 'value',
      render: (_: unknown, record: EnvEntry) => (
        <Input
          placeholder="例如: Intel Xeon E5-2680 v4"
          value={record.value}
          onChange={(e) => updateEntry(record.id, 'value', e.target.value)}
        />
      ),
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, record: EnvEntry) => (
        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeEntry(record.id)} />
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <EnvironmentOutlined />
          <span>环境信息 - {report?.name}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={720}
      destroyOnClose
      footer={[
        <Button key="export" icon={<ExportOutlined />} onClick={exportEnvironment}>
          导出 JSON
        </Button>,
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="save"
          type="primary"
          icon={<SaveOutlined />}
          onClick={() => report && onSave(report, getEnvironmentObject())}
        >
          保存
        </Button>,
      ]}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: 'edit',
          label: '编辑键值对',
          children: (
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text type="secondary">共 {entries.length} 条环境信息</Text>
                <Button type="dashed" icon={<PlusOutlined />} onClick={addEntry}>
                  添加键值对
                </Button>
              </div>
              <Table
                size="small"
                columns={columns}
                dataSource={entries}
                rowKey="id"
                pagination={false}
                locale={{ emptyText: '暂无环境信息，点击上方添加' }}
                scroll={{ y: 320 }}
              />
            </Space>
          ),
        },
        {
          key: 'import',
          label: '导入',
          children: (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Alert
                message="支持 JSON 对象、数组或 key=value / key:value 行格式"
                description={
                  <div>
                    <div>JSON 示例：{"{\"CPU\":\"Xeon E5\",\"网卡\":\"Intel X520\"}"}</div>
                    <div>数组示例：[{"{\"key\":\"CPU\",\"value\":\"Xeon E5\"}"}]</div>
                    <div>行格式：CPU=Xeon E5、网卡: Intel X520</div>
                  </div>
                }
                type="info"
                showIcon
              />
              <Upload
                accept=".json,.txt"
                beforeUpload={() => false}
                onChange={handleFileChange}
                maxCount={1}
                showUploadList={false}
              >
                <Button icon={<ImportOutlined />}>从文件导入</Button>
              </Upload>
              <TextArea
                rows={10}
                placeholder="粘贴 JSON 或键值对文本"
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  setImportError('');
                }}
              />
              {importError && <Alert message={importError} type="error" showIcon />}
              <Button type="primary" icon={<ImportOutlined />} onClick={applyImport}>
                解析并导入
              </Button>
            </Space>
          ),
        },
        {
          key: 'export',
          label: '导出预览',
          children: (
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text type="secondary">当前环境信息 JSON</Text>
                <Button icon={<CopyOutlined />} onClick={copyExportText}>
                  复制
                </Button>
              </div>
              <pre
                style={{
                  background: '#f5f5f5',
                  padding: 12,
                  borderRadius: 4,
                  maxHeight: 320,
                  overflow: 'auto',
                  fontSize: 12,
                }}
              >
                {JSON.stringify(getEnvironmentObject(), null, 2)}
              </pre>
            </Space>
          ),
        },
      ]} />
    </Modal>
  );
};

export default EnvironmentInfoModal;
