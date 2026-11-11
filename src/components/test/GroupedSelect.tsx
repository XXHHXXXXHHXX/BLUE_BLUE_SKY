'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Select,
  Button,
  Space,
  Modal,
  Input,
  List,
  Checkbox,
  Tag,
  Empty,
  message,
  Popconfirm,
  Divider,
  Typography,
} from 'antd';
import {
  SettingOutlined,
  EditOutlined,
  DeleteOutlined,
  FolderAddOutlined,
  FolderOutlined,
  MergeCellsOutlined,
  DownOutlined,
  RightOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

export interface GroupedSelectGroup {
  id: string;
  name: string;
}

export interface GroupedSelectOption {
  value: string;
  /** 条目名称（用于管理弹窗展示与改名） */
  name: string;
  label: React.ReactNode;
  /** 参与搜索的纯文本（名称 / 描述等），默认使用 name */
  searchText?: string;
  /** 所属分组；为空表示未分组 */
  groupId?: string | null;
  /** 是否允许改名（默认允许） */
  canRename?: boolean;
  /** 是否允许删除（默认允许） */
  canDelete?: boolean;
}

export interface GroupedSelectProps {
  groups: GroupedSelectGroup[];
  options: GroupedSelectOption[];
  value?: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
  /** 是否显示「管理」按钮 */
  showManage?: boolean;
  /** 管理弹窗标题 */
  manageTitle: string;
  /** 删除条目时的确认文案；不传则不显示删除按钮 */
  itemDeleteTitle?: string;
  /** 条目额外信息（如阶段数、文件大小） */
  renderItemExtra?: (value: string) => React.ReactNode;
  onCreateGroup: (name: string) => Promise<GroupedSelectGroup>;
  onAssignGroup: (ids: string[], groupId: string | null) => Promise<void>;
  onRenameItem: (id: string, name: string) => Promise<void>;
  onRenameGroup: (id: string, name: string) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
  onDeleteItem?: (id: string) => Promise<void>;
}

/**
 * 通用「分组下拉选择器」
 *
 * - 下拉按分组展示，点击分组名可折叠/展开组内条目
 * - 支持按条目名称、描述或分组名搜索，搜索时忽略折叠状态
 * - 「管理」弹窗支持多选合并分组、加入已有分组、移出分组、改名、删除（均需确认）
 */
const GroupedSelect: React.FC<GroupedSelectProps> = ({
  groups,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  size = 'small',
  style,
  showManage = true,
  manageTitle,
  itemDeleteTitle,
  renderItemExtra,
  onCreateGroup,
  onAssignGroup,
  onRenameItem,
  onRenameGroup,
  onDeleteGroup,
  onDeleteItem,
}) => {
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [renaming, setRenaming] = useState<{ kind: 'item' | 'group'; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // 受控值 + 递增 key：每次操作后重置，避免 Select 内部残留旧值
  const [targetGroupId, setTargetGroupId] = useState<string | undefined>(undefined);
  const [groupSelectKey, setGroupSelectKey] = useState(0);
  // 已展开的分组（默认全部折叠，仅「未分组」默认展开）；搜索时忽略
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [ungroupedCollapsed, setUngroupedCollapsed] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const selectOptions = useMemo(() => {
    const result: Array<{
      label: React.ReactNode;
      title: string;
      options: Array<{ label: React.ReactNode; value: string; disabled?: boolean }>;
    }> = [];

    const keyword = searchValue.trim().toLowerCase();
    // 未分组默认展开，其余分组默认折叠
    const isCollapsed = (key: string) =>
      !keyword &&
      (key === '__ungrouped__'
        ? ungroupedCollapsed
        : !expandedGroups.includes(key));

    const buildGroupLabel = (key: string, name: string, count: number) => (
      <span
        data-group-key={key}
        onClick={(e) => {
          e.stopPropagation();
          if (key === '__ungrouped__') {
            setUngroupedCollapsed((prev) => !prev);
          } else {
            setExpandedGroups((prev) =>
              prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
            );
          }
        }}
        style={{ color: '#1677ff', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}
      >
        <Space size={4}>
          {isCollapsed(key) ? <RightOutlined /> : <DownOutlined />}
          <FolderOutlined />
          <span>{name}</span>
          <Text style={{ color: '#1677ff', fontSize: 11, fontWeight: 400 }}>({count})</Text>
        </Space>
      </span>
    );

    // 折叠时保留一个不可选占位项，确保分组标题仍然渲染
    const collapsedPlaceholder = (key: string) => [
      {
        value: `__collapsed__${key}`,
        label: <span style={{ color: '#bbb' }}>（已折叠，点击分组名展开）</span>,
        disabled: true,
      },
    ];

    const matchOption = (opt: GroupedSelectOption) =>
      !keyword || (opt.searchText ?? opt.name).toLowerCase().includes(keyword);

    for (const group of groups) {
      const all = options.filter((o) => o.groupId === group.id);
      if (all.length === 0) continue;
      const groupMatched = !!keyword && group.name.toLowerCase().includes(keyword);
      const items = groupMatched ? all : all.filter(matchOption);
      if (items.length === 0) continue;
      result.push({
        label: buildGroupLabel(group.id, group.name, items.length),
        title: group.name,
        options: isCollapsed(group.id)
          ? collapsedPlaceholder(group.id)
          : items.map((o) => ({ value: o.value, label: o.label })),
      });
    }

    const allUngrouped = options.filter(
      (o) => !o.groupId || !groups.some((g) => g.id === o.groupId),
    );
    const ungroupedMatched = !!keyword && '未分组'.includes(keyword);
    const ungrouped = ungroupedMatched ? allUngrouped : allUngrouped.filter(matchOption);
    if (ungrouped.length > 0) {
      result.push({
        label: buildGroupLabel('__ungrouped__', '未分组', ungrouped.length),
        title: '未分组',
        options: isCollapsed('__ungrouped__')
          ? collapsedPlaceholder('__ungrouped__')
          : ungrouped.map((o) => ({ value: o.value, label: o.label })),
      });
    }

    return result;
  }, [options, groups, expandedGroups, ungroupedCollapsed, searchValue]);

  const handleSelect = (id: string | undefined) => {
    if (!id) {
      onChange(null);
      return;
    }
    onChange(id);
  };

  const handleMergeToNewGroup = async () => {
    if (selectedIds.length === 0) {
      message.warning('请先勾选要合并的条目');
      return;
    }
    if (!newGroupName.trim()) {
      message.warning('请输入分组名称');
      return;
    }
    setBusy(true);
    try {
      const group = await onCreateGroup(newGroupName.trim());
      await onAssignGroup(selectedIds, group.id);
      setNewGroupName('');
      setSelectedIds([]);
      message.success(`已将 ${selectedIds.length} 个条目合并到分组「${group.name}」`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '合并分组失败');
    } finally {
      setBusy(false);
    }
  };

  const handleMoveToGroup = async (groupId: string | null) => {
    if (selectedIds.length === 0) {
      message.warning('请先勾选条目');
      return;
    }
    setBusy(true);
    try {
      await onAssignGroup(selectedIds, groupId);
      setSelectedIds([]);
      message.success(groupId ? '已加入分组' : '已移出分组');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!onDeleteItem) return;
    setBusy(true);
    try {
      await onDeleteItem(id);
      if (value === id) onChange(null);
      message.success('已删除');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    setBusy(true);
    try {
      await onDeleteGroup(id);
      message.success('已删除分组（组内条目已移出分组）');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除分组失败');
    } finally {
      setBusy(false);
    }
  };

  const handleRenameSubmit = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) {
      message.warning('名称不能为空');
      return;
    }
    setBusy(true);
    try {
      if (renaming.kind === 'item') {
        await onRenameItem(renaming.id, name);
      } else {
        await onRenameGroup(renaming.id, name);
      }
      setRenaming(null);
      message.success('已重命名');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重命名失败');
    } finally {
      setBusy(false);
    }
  };

  const toggleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  }, []);

  const renderItemRow = (opt: GroupedSelectOption) => {
    const group = groups.find((g) => g.id === opt.groupId);
    const name = opt.name;
    return (
      <List.Item
        key={opt.value}
        actions={[
          opt.canRename === false ? null : (
            <Button
              key="rename"
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => setRenaming({ kind: 'item', id: opt.value, name })}
            >
              改名
            </Button>
          ),
          onDeleteItem && itemDeleteTitle && opt.canDelete !== false ? (
            <Popconfirm
              key="delete"
              title={itemDeleteTitle}
              description="删除后不可恢复"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => handleDeleteItem(opt.value)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          ) : null,
        ].filter(Boolean)}
      >
        <Space>
          <Checkbox
            checked={selectedIds.includes(opt.value)}
            onChange={(e) => toggleSelect(opt.value, e.target.checked)}
          />
          <span>{name}</span>
          {group && <Tag color="blue">{group.name}</Tag>}
          {renderItemExtra?.(opt.value)}
        </Space>
      </List.Item>
    );
  };

  return (
    <>
      <Space.Compact style={{ width: '100%', ...style }}>
        <Select
          size={size}
          style={{ flex: 1 }}
          placeholder={placeholder || '请选择'}
          value={value || undefined}
          onChange={handleSelect}
          allowClear
          showSearch
          searchValue={searchValue}
          onSearch={setSearchValue}
          onOpenChange={(open) => {
            if (!open) {
              // 关闭后重置，下次打开分组恢复默认折叠状态（未分组仍默认展开）
              setSearchValue('');
              setExpandedGroups([]);
              setUngroupedCollapsed(false);
            }
          }}
          filterOption={false}
          options={selectOptions}
          disabled={disabled}
        />
        {showManage && (
          <Button
            size={size}
            icon={<SettingOutlined />}
            onClick={() => setIsManageOpen(true)}
          >
            管理
          </Button>
        )}
      </Space.Compact>

      <Modal
        title={manageTitle}
        open={isManageOpen}
        onCancel={() => {
          setIsManageOpen(false);
          setSelectedIds([]);
          setNewGroupName('');
          setTargetGroupId(undefined);
          setGroupSelectKey((k) => k + 1);
        }}
        footer={null}
        width={720}
        destroyOnClose
      >
        {/* 分组操作区 */}
        <div
          style={{
            padding: 10,
            background: '#fafafa',
            border: '1px solid #f0f0f0',
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <Space wrap>
            <Input
              size="small"
              style={{ width: 180 }}
              placeholder="新分组名称"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
            />
            <Button
              size="small"
              type="primary"
              icon={<MergeCellsOutlined />}
              loading={busy}
              onClick={handleMergeToNewGroup}
            >
              合并为分组（已选 {selectedIds.length}）
            </Button>
            <Select
              key={groupSelectKey}
              size="small"
              style={{ width: 180 }}
              placeholder="加入已有分组"
              value={targetGroupId}
              onChange={(gid) => {
                setTargetGroupId(gid);
                handleMoveToGroup(gid).finally(() => {
                  setTargetGroupId(undefined);
                  setGroupSelectKey((k) => k + 1);
                });
              }}
              options={groups.map((g) => ({ value: g.id, label: g.name }))}
              disabled={groups.length === 0 || selectedIds.length === 0}
            />
            <Button
              size="small"
              icon={<FolderAddOutlined />}
              disabled={selectedIds.length === 0}
              onClick={() => handleMoveToGroup(null)}
            >
              移出分组
            </Button>
          </Space>
          <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>
            勾选下方条目后可合并为分组或加入已有分组；删除条目与分组均需二次确认。
          </div>
        </div>

        {/* 分组列表 */}
        {groups.length > 0 && (
          <>
            <Text strong>分组</Text>
            <List
              size="small"
              dataSource={groups}
              style={{ marginBottom: 8 }}
              renderItem={(group: GroupedSelectGroup) => (
                <List.Item
                  actions={[
                    <Button
                      key="rename"
                      type="link"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => setRenaming({ kind: 'group', id: group.id, name: group.name })}
                    >
                      改名
                    </Button>,
                    <Popconfirm
                      key="delete"
                      title="确定删除该分组吗？"
                      description="组内条目不会被删除，只会移出分组"
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() => handleDeleteGroup(group.id)}
                    >
                      <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                        删除分组
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <Space>
                    <FolderOutlined />
                    <span>{group.name}</span>
                    <Tag>{options.filter((o) => o.groupId === group.id).length} 个条目</Tag>
                  </Space>
                </List.Item>
              )}
            />
            <Divider style={{ margin: '8px 0' }} />
          </>
        )}

        {/* 条目列表 */}
        <Text strong>条目</Text>
        {options.length === 0 ? (
          <Empty description="暂无条目" style={{ margin: '16px 0' }} />
        ) : (
          <List
            size="small"
            dataSource={options}
            renderItem={renderItemRow}
            style={{ maxHeight: 360, overflow: 'auto' }}
          />
        )}
      </Modal>

      {/* 重命名弹窗 */}
      <Modal
        title={renaming?.kind === 'group' ? '重命名分组' : '重命名'}
        open={!!renaming}
        onCancel={() => setRenaming(null)}
        onOk={handleRenameSubmit}
        confirmLoading={busy}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          value={renaming?.name || ''}
          onChange={(e) => setRenaming((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
          onPressEnter={handleRenameSubmit}
          placeholder="请输入新名称"
          autoFocus
        />
      </Modal>
    </>
  );
};

export default GroupedSelect;
