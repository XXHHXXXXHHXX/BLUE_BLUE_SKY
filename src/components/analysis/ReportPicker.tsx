'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Tree,
  Table,
  Input,
  Space,
  Tag,
  Button,
  Empty,
  Row,
  Col,
  Typography,
} from 'antd';
import {
  FileTextOutlined,
  SearchOutlined,
  FolderOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import {
  useTestReportStore,
  type TestReport,
  type FolderTreeNode,
  isDefaultFolder,
} from '../../stores/testReportStore';

const { Text } = Typography;

interface ReportPickerProps {
  open: boolean;
  title?: string;
  mode?: 'single' | 'multiple';
  selectedIds?: string[];
  maxCount?: number;
  onConfirm: (reports: TestReport[]) => void;
  onCancel: () => void;
}

function countReportsByFolder(
  reports: TestReport[],
  folders: { id: string; parentId: string | null }[],
  folderId: string
): number {
  const descendantIds = new Set([folderId]);
  const collect = (parentId: string) => {
    for (const f of folders) {
      if (f.parentId === parentId) {
        descendantIds.add(f.id);
        collect(f.id);
      }
    }
  };
  collect(folderId);
  return reports.filter((r) => descendantIds.has(r.folderId || 'uncategorized')).length;
}

const ReportPicker: React.FC<ReportPickerProps> = ({
  open,
  title = '选择报告',
  mode = 'single',
  selectedIds = [],
  maxCount,
  onConfirm,
  onCancel,
}) => {
  const { reports, folders, fetchReports, getFolderTree, getSelectedFolderId, setSelectedFolderId } =
    useTestReportStore();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>(selectedIds);
  const [selectedFolderId, setSelectedFolderIdLocal] = useState<string | null>(getSelectedFolderId());

  useEffect(() => {
    if (open) {
      fetchReports();
      setSelectedKeys(selectedIds);
      const defaultId = 'uncategorized';
      setExpandedKeys((prev) => Array.from(new Set([...prev, defaultId])));
    }
  }, [open, fetchReports, selectedIds]);

  const folderTree = useMemo(() => getFolderTree(), [getFolderTree]);

  const folderReportCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of folders) {
      counts[f.id] = countReportsByFolder(reports, folders, f.id);
    }
    counts['uncategorized'] = countReportsByFolder(reports, folders, 'uncategorized');
    return counts;
  }, [folders, reports]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentReports = useMemo(() => {
    if (!selectedFolderId) return reports;
    const descendantIds = new Set([selectedFolderId]);
    const collect = (parentId: string) => {
      for (const f of folders) {
        if (f.parentId === parentId) {
          descendantIds.add(f.id);
          collect(f.id);
        }
      }
    };
    collect(selectedFolderId);
    return reports.filter((r) => descendantIds.has(r.folderId || 'uncategorized'));
  }, [reports, folders, selectedFolderId]);

  const displayedReports = useMemo(() => {
    if (!searchKeyword.trim()) return currentReports;
    const lower = searchKeyword.toLowerCase();
    return currentReports.filter(
      (r) =>
        r.name.toLowerCase().includes(lower) ||
        r.description?.toLowerCase().includes(lower) ||
        r.config.host.toLowerCase().includes(lower)
    );
  }, [currentReports, searchKeyword]);

  const highlight = (text: string, keyword: string) => {
    if (!keyword.trim()) return <span>{text}</span>;
    const lowerKeyword = keyword.toLowerCase();
    const lowerText = text.toLowerCase();
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let idx = lowerText.indexOf(lowerKeyword, lastIndex);
    let key = 0;
    while (idx !== -1) {
      if (idx > lastIndex) {
        parts.push(<span key={key++}>{text.slice(lastIndex, idx)}</span>);
      }
      parts.push(
        <span key={key++} style={{ background: '#fff566', color: '#000000d9', fontWeight: 500 }}>
          {text.slice(idx, idx + keyword.length)}
        </span>
      );
      lastIndex = idx + keyword.length;
      idx = lowerText.indexOf(lowerKeyword, lastIndex);
    }
    if (lastIndex < text.length) {
      parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
    }
    return <span>{parts}</span>;
  };

  const renderTreeTitle = (node: FolderTreeNode) => {
    const isDefault = isDefaultFolder(node.key);
    const count = folderReportCounts[node.key] ?? 0;
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {isDefault ? (
          <FolderOutlined style={{ color: '#1890ff' }} />
        ) : (
          <FolderOpenOutlined style={{ color: '#faad14' }} />
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.title}
        </span>
        <Tag style={{ marginLeft: 4 }}>{count}</Tag>
      </span>
    );
  };

  const columns = [
    {
      title: '报告名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => (
        <Space>
          <FileTextOutlined />
          {highlight(text, searchKeyword)}
        </Space>
      ),
    },
    {
      title: '目录',
      key: 'folder',
      width: 120,
      render: (_: unknown, record: TestReport) => {
        const folderId = record.folderId || 'uncategorized';
        const folder = folders.find((f) => f.id === folderId);
        return <Tag color={isDefaultFolder(folderId) ? 'blue' : 'orange'}>{folder?.name || '未分类'}</Tag>;
      },
    },
    {
      title: '测试主机',
      key: 'host',
      render: (_: unknown, record: TestReport) => highlight(record.config.host, searchKeyword),
    },
    {
      title: '数据点',
      key: 'dataPoints',
      width: 90,
      render: (_: unknown, record: TestReport) => <Tag>{record.results.length} 个</Tag>,
    },
    {
      title: '阶段',
      key: 'stage',
      width: 120,
      render: (_: unknown, record: TestReport) =>
        record.stageName ? <Tag color="purple">{record.stageName}</Tag> : '-',
    },
  ];

  const rowSelection =
    mode === 'multiple'
      ? {
          selectedRowKeys: selectedKeys,
          onChange: (keys: React.Key[]) => {
            if (maxCount && keys.length > maxCount) return;
            setSelectedKeys(keys);
          },
          type: 'checkbox' as const,
        }
      : undefined;

  const handleRowClick = (record: TestReport) => {
    if (mode === 'multiple') {
      const key = record.id;
      const next = selectedKeys.includes(key)
        ? selectedKeys.filter((k) => k !== key)
        : [...selectedKeys, key];
      if (maxCount && next.length > maxCount) return;
      setSelectedKeys(next);
    } else {
      setSelectedKeys([record.id]);
    }
  };

  const handleConfirm = () => {
    const selectedReports = reports.filter((r) => selectedKeys.includes(r.id));
    onConfirm(selectedReports);
  };

  const selectedReports = useMemo(
    () => reports.filter((r) => selectedKeys.includes(r.id)),
    [reports, selectedKeys]
  );

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      width={900}
      styles={{ body: { padding: 0 } }}
      footer={[
        <Text key="hint" type="secondary" style={{ float: 'left' }}>
          {mode === 'multiple' ? `已选 ${selectedKeys.length} 份报告` : '选择一份报告'}
        </Text>,
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button key="confirm" type="primary" onClick={handleConfirm} disabled={selectedKeys.length === 0}>
          确定
        </Button>,
      ]}
    >
      <Row gutter={0}>
        <Col span={6} style={{ borderRight: '1px solid #f0f0f0', padding: 12 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            报告目录
          </Text>
          <Tree
            treeData={folderTree}
            titleRender={renderTreeTitle}
            selectedKeys={selectedFolderId ? [selectedFolderId] : []}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys as string[])}
            onSelect={(keys) => {
              if (keys.length > 0) {
                const id = keys[0] as string;
                setSelectedFolderIdLocal(id);
                setSelectedFolderId(id);
              }
            }}
            showLine
            blockNode
            style={{ background: '#fafafa', padding: 8, borderRadius: 4, minHeight: 320 }}
          />
        </Col>
        <Col span={18} style={{ padding: 12 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索报告"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              allowClear
            />
            {mode === 'multiple' && selectedReports.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <Text type="secondary">已选:</Text>
                {selectedReports.map((r) => (
                  <Tag
                    key={r.id}
                    color="blue"
                    closable
                    onClose={() => setSelectedKeys((prev) => prev.filter((k) => k !== r.id))}
                  >
                    {r.name}
                  </Tag>
                ))}
                {maxCount && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    最多 {maxCount} 份
                  </Text>
                )}
              </div>
            )}
            {displayedReports.length === 0 ? (
              <Empty description="当前目录暂无报告" style={{ marginTop: 40 }} />
            ) : (
              <Table
                columns={columns}
                dataSource={displayedReports}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 8, showSizeChanger: false }}
                rowSelection={rowSelection}
                onRow={(record) => ({
                  onClick: () => handleRowClick(record),
                  style: { cursor: 'pointer' },
                })}
                scroll={{ x: 'max-content' }}
              />
            )}
          </Space>
        </Col>
      </Row>
    </Modal>
  );
};

export default ReportPicker;
