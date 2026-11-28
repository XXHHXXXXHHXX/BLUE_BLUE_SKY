'use client';

/** 用例包在线文件编辑器
 *
 * 直接在服务器上编辑压缩包内容：改 run.sh、增删改任意文件。
 * 左侧文件树，右侧编辑区；保存即写回压缩包（服务端重新打包）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderOutlined,
  SaveOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import useMaximizableModal from '../../hooks/useMaximizableModal';

const { Text } = Typography;
const { TextArea } = Input;

interface PackageFileEntry {
  path: string;
  name: string;
  size: number;
  dir: boolean;
  isText: boolean;
}

interface PackageFileEditorProps {
  visible: boolean;
  packageId: string | null;
  packageName: string;
  onClose: () => void;
  /** 保存/删除后回调，宿主可刷新包列表（大小/更新时间变化） */
  onChanged?: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 按目录层级把扁平文件列表整理成树 */
interface TreeNode {
  key: string;
  title: string;
  isLeaf: boolean;
  children?: TreeNode[];
}

function buildFileTree(files: PackageFileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  const ensureDir = (dirPath: string): TreeNode[] => {
    if (!dirPath) return root;
    if (dirMap.has(dirPath)) return dirMap.get(dirPath)!.children!;
    const segments = dirPath.split('/');
    const parentPath = segments.slice(0, -1).join('/');
    const parentChildren = ensureDir(parentPath);
    const node: TreeNode = {
      key: `dir:${dirPath}`,
      title: segments[segments.length - 1],
      isLeaf: false,
      children: [],
    };
    dirMap.set(dirPath, node);
    parentChildren.push(node);
    return node.children!;
  };

  for (const f of files) {
    const idx = f.path.lastIndexOf('/');
    const dir = idx >= 0 ? f.path.slice(0, idx) : '';
    const children = ensureDir(dir);
    children.push({
      key: `file:${f.path}`,
      title: f.name,
      isLeaf: true,
    });
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1;
      return a.title.localeCompare(b.title);
    });
    nodes.forEach((n) => n.children && sortNodes(n.children));
  };
  sortNodes(root);
  return root;
}

const PackageFileEditor: React.FC<PackageFileEditorProps> = ({
  visible,
  packageId,
  packageName,
  onClose,
  onChanged,
}) => {
  const modal = useMaximizableModal({ minWidth: 1200, minPageSize: 5, maxPageSize: 25 });

  const [files, setFiles] = useState<PackageFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [fileIsText, setFileIsText] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [expandedDirs, setExpandedDirs] = useState<string[]>([]);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');

  const dirty = content !== originalContent;
  const activeEntry = useMemo(
    () => files.find((f) => f.path === activePath) || null,
    [files, activePath],
  );

  /** 加载文件列表 */
  const loadFiles = useCallback(async () => {
    if (!packageId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/test/packages/files?id=${encodeURIComponent(packageId)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.message || '加载文件列表失败');
      setFiles(data.files || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [packageId]);

  useEffect(() => {
    if (!visible || !packageId) return;
    setActivePath(null);
    setContent('');
    setOriginalContent('');
    void loadFiles();
  }, [visible, packageId, loadFiles]);

  /** 读取单个文件 */
  const openFile = useCallback(
    async (filePath: string) => {
      if (!packageId) return;
      if (dirty) {
        const ok = window.confirm('当前文件有未保存的修改，确定切换？修改将丢失。');
        if (!ok) return;
      }
      setFileLoading(true);
      setActivePath(filePath);
      try {
        const res = await fetch(
          `/api/test/packages/files?id=${encodeURIComponent(packageId)}&file=${encodeURIComponent(filePath)}`,
        );
        const data = await res.json();
        if (!data.success) throw new Error(data.message || '读取文件失败');
        setFileIsText(!!data.file.isText);
        // 二进制文件不展示内容（避免乱码），仅提示
        const text = data.file.isText ? (data.file.content as string) : '';
        setContent(text);
        setOriginalContent(text);
      } catch (err) {
        message.error(err instanceof Error ? err.message : '读取失败');
        setActivePath(null);
      } finally {
        setFileLoading(false);
      }
    },
    [packageId, dirty],
  );

  /** 保存当前文件 */
  const handleSave = async () => {
    if (!packageId || !activePath) return;
    setSaving(true);
    try {
      const res = await fetch('/api/test/packages/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: packageId, path: activePath, content, encoding: 'utf8' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || '保存失败');
      setOriginalContent(content);
      message.success('已保存到用例包');
      await loadFiles();
      onChanged?.();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /** 新建文件 */
  const handleCreateFile = async () => {
    if (!packageId) return;
    const p = newFilePath.trim().replace(/^\/+/, '');
    if (!p) {
      message.warning('请输入文件路径');
      return;
    }
    if (files.some((f) => f.path === p)) {
      message.warning('该路径已存在');
      return;
    }
    try {
      const res = await fetch('/api/test/packages/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: packageId, path: p, content: '', encoding: 'utf8' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || '创建失败');
      message.success('文件已创建');
      setNewFileOpen(false);
      setNewFilePath('');
      await loadFiles();
      onChanged?.();
      await openFile(p);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  /** 删除文件 */
  const handleDeleteFile = async (filePath: string) => {
    if (!packageId) return;
    try {
      const res = await fetch(
        `/api/test/packages/files?id=${encodeURIComponent(packageId)}&file=${encodeURIComponent(filePath)}`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.message || '删除失败');
      message.success('文件已删除');
      if (activePath === filePath) {
        setActivePath(null);
        setContent('');
        setOriginalContent('');
      }
      await loadFiles();
      onChanged?.();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const treeData = useMemo(() => buildFileTree(files), [files]);

  /** 目录默认全部展开，便于一眼看到 run.sh */
  useEffect(() => {
    const dirs: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (!n.isLeaf) {
          dirs.push(n.key);
          if (n.children) walk(n.children);
        }
      }
    };
    walk(treeData);
    setExpandedDirs(dirs);
  }, [treeData]);

  const renderTree = (nodes: TreeNode[], depth = 0): React.ReactNode =>
    nodes.map((node) => {
      const isDir = !node.isLeaf;
      const filePath = node.key.startsWith('file:') ? node.key.slice(5) : '';
      const expanded = expandedDirs.includes(node.key);
      const isActive = !isDir && filePath === activePath;
      return (
        <div key={node.key}>
          <div
            onClick={() => {
              if (isDir) {
                setExpandedDirs((prev) =>
                  prev.includes(node.key) ? prev.filter((k) => k !== node.key) : [...prev, node.key],
                );
              } else {
                void openFile(filePath);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              paddingLeft: 8 + depth * 14,
              borderRadius: 4,
              cursor: 'pointer',
              background: isActive ? '#e6f7ff' : 'transparent',
              border: isActive ? '1px solid #91d5ff' : '1px solid transparent',
              fontSize: 13,
            }}
          >
            {isDir ? (
              <FolderOutlined style={{ color: '#faad14' }} />
            ) : (
              <FileTextOutlined style={{ color: '#8c8c8c' }} />
            )}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.title}
            </span>
            {!isDir && node.title === 'run.sh' && <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>入口</Tag>}
            {!isDir && (
              <Popconfirm
                title={`删除 ${filePath}？`}
                description="将从压缩包中移除该文件"
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                onConfirm={(e) => {
                  e?.stopPropagation();
                  void handleDeleteFile(filePath);
                }}
                onCancel={(e) => e?.stopPropagation()}
              >
                <DeleteOutlined
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: '#ff4d4f', opacity: 0.65 }}
                />
              </Popconfirm>
            )}
          </div>
          {isDir && expanded && node.children && renderTree(node.children, depth + 1)}
        </div>
      );
    });

  return (
    <>
      <Modal
        title={modal.renderTitle(
          <Space>
            <FileTextOutlined />
            <span>编辑用例包：{packageName}</span>
            {dirty && <Tag color="orange">未保存</Tag>}
          </Space>
        )}
        open={visible}
        onCancel={() => {
          if (dirty && !window.confirm('有未保存的修改，确定关闭？')) return;
          onClose();
        }}
        width={modal.width}
        style={modal.style}
        styles={{ body: { ...modal.bodyStyle, padding: 0 } }}
        footer={[
          <Button key="close" onClick={onClose}>
            关闭
          </Button>,
        ]}
      >
        {error && (
          <div style={{ padding: 12 }}>
            <Alert type="error" showIcon title={error} />
          </div>
        )}
        <div style={{ display: 'flex', height: 'calc(100vh - 220px)', minHeight: 420 }}>
          {/* 左：文件树 */}
          <div
            style={{
              width: 280,
              borderRight: '1px solid #f0f0f0',
              display: 'flex',
              flexDirection: 'column',
              background: '#fafafa',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text strong style={{ fontSize: 13 }}>
                文件（{files.length}）
              </Text>
              <Space size={4}>
                <Tooltip title="新建文件">
                  <Button
                    size="small"
                    type="text"
                    icon={<FileAddOutlined />}
                    onClick={() => setNewFileOpen(true)}
                  />
                </Tooltip>
                <Tooltip title="刷新">
                  <Button size="small" type="text" icon={<UndoOutlined />} onClick={() => void loadFiles()} />
                </Tooltip>
              </Space>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 24 }}>
                  <Spin />
                </div>
              ) : files.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="包内没有文件" />
              ) : (
                renderTree(treeData)
              )}
            </div>
          </div>

          {/* 右：编辑区 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {!activePath ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="从左侧选择一个文件开始编辑（如 run.sh）"
                />
              </div>
            ) : (
              <>
                <div
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Space size={6} style={{ minWidth: 0 }}>
                    <FileTextOutlined />
                    <Text strong ellipsis style={{ maxWidth: 420 }}>
                      {activePath}
                    </Text>
                    {activeEntry && <Tag>{formatSize(activeEntry.size)}</Tag>}
                    {!fileIsText && <Tag color="orange">二进制文件（只读展示）</Tag>}
                  </Space>
                  <Space>
                    <Button
                      size="small"
                      icon={<UndoOutlined />}
                      disabled={!dirty}
                      onClick={() => setContent(originalContent)}
                    >
                      撤销
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      icon={<SaveOutlined />}
                      loading={saving}
                      disabled={!dirty || !fileIsText}
                      onClick={handleSave}
                    >
                      保存到用例包
                    </Button>
                  </Space>
                </div>
                <div style={{ flex: 1, overflow: 'hidden', padding: 12 }}>
                  {fileLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}>
                      <Spin />
                    </div>
                  ) : fileIsText ? (
                    <TextArea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      style={{
                        height: '100%',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                        fontSize: 13,
                        lineHeight: 1.6,
                        resize: 'none',
                      }}
                      spellCheck={false}
                      placeholder="文件内容为空"
                    />
                  ) : (
                    <Alert
                      type="info"
                      showIcon
                      title="该文件被识别为二进制内容，不支持在线文本编辑"
                      description="如需替换，请删除后重新上传，或下载压缩包在本地编辑再上传。"
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        title="新建文件"
        open={newFileOpen}
        onCancel={() => setNewFileOpen(false)}
        onOk={handleCreateFile}
        okText="创建"
        cancelText="取消"
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            支持子目录，如 <Text code>lib/helper.sh</Text>；目录会自动创建。
          </Text>
          <Input
            placeholder="文件路径，如 config/test.conf"
            value={newFilePath}
            onChange={(e) => setNewFilePath(e.target.value)}
            onPressEnter={handleCreateFile}
          />
        </Space>
      </Modal>
    </>
  );
};

export default PackageFileEditor;
