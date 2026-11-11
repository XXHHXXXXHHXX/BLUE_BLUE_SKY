'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  useTestIterationConfigStore,
  type SavedTestConfig,
  type ConfigGroup,
} from '../../stores/testIterationConfigStore';

const { Text } = Typography;

interface ConfigTemplateSelectProps {
  configType: 'iteration' | 'monitor';
  /** 当前选中的配置 ID */
  value?: string | null;
  /** 选中配置（空值表示清除选择） */
  onChange: (config: SavedTestConfig | null) => void;
  placeholder?: string;
  /** 额外展示在选项右侧的信息（如命令条数） */
  renderExtra?: (config: SavedTestConfig) => React.ReactNode;
  disabled?: boolean;
  /** 是否显示「管理」按钮（默认显示） */
  showManage?: boolean;
}

/**
 * 配置模板选择器（支持分组）
 *
 * - 下拉菜单按分组展示：先看到分组，展开后看到组内模板；未分组的模板单独一栏
 * - 右上角「管理」进入管理弹窗：多选合并分组、重命名配置/分组、删除（需确认）
 */
const ConfigTemplateSelect: React.FC<ConfigTemplateSelectProps> = ({
  configType,
  value,
  onChange,
  placeholder,
  renderExtra,
  disabled,
  showManage = true,
}) => {
  const {
    configs,
    groups,
    fetchConfigs,
    removeConfig,
    renameConfig,
    assignConfigsToGroup,
    addGroup,
    renameGroup,
    removeGroup,
  } = useTestIterationConfigStore();

  const [isManageOpen, setIsManageOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [renaming, setRenaming] = useState<{ kind: 'config' | 'group'; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // 受控值 + 递增 key：每次选择后重置，避免 Select 内部残留旧值导致再次选择同一分组不触发 onChange
  const [targetGroupId, setTargetGroupId] = useState<string | undefined>(undefined);
  const [groupSelectKey, setGroupSelectKey] = useState(0);
  // 下拉中已折叠的分组（点击分组名切换）；搜索时自动忽略折叠状态
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [searchValue, setSearchValue] = useState('');

  useEffect(() => {
    fetchConfigs(configType);
  }, [fetchConfigs, configType]);

  const typeConfigs = useMemo(
    () => configs.filter((c) => c.configType === configType),
    [configs, configType],
  );
  const typeGroups = useMemo(
    () => groups.filter((g) => g.configType === configType),
    [groups, configType],
  );

  // 下拉选项：分组在前（组内模板），未分组的模板单独一组
  // 点击分组名可折叠/展开组内模板；搜索时忽略折叠状态，始终展开命中的分组
  const selectOptions = useMemo(() => {
    const options: Array<{
      label: React.ReactNode;
      title: string;
      options: Array<{ label: React.ReactNode; value: string; disabled?: boolean }>;
    }> = [];

    const keyword = searchValue.trim().toLowerCase();
    const isCollapsed = (key: string) => !keyword && collapsedGroups.includes(key);

    const buildGroupLabel = (key: string, name: string, count: number) => (
      <span
        data-group-key={key}
        onClick={(e) => {
          e.stopPropagation();
          setCollapsedGroups((prev) =>
            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
          );
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

    const buildConfigLabel = (config: SavedTestConfig) => (
      <Space>
        <span>{config.name}</span>
        {renderExtra?.(config)}
        {config.description && (
          <span style={{ color: '#999', fontSize: 12 }}>{config.description}</span>
        )}
      </Space>
    );

    // 搜索匹配：配置名 / 配置描述命中；或分组名命中（整组保留）
    const matchConfig = (config: SavedTestConfig) =>
      !keyword ||
      config.name.toLowerCase().includes(keyword) ||
      !!config.description?.toLowerCase().includes(keyword);

    for (const group of typeGroups) {
      const all = typeConfigs.filter((c) => c.groupId === group.id);
      if (all.length === 0) continue;
      const groupMatched = !!keyword && group.name.toLowerCase().includes(keyword);
      const items = groupMatched ? all : all.filter(matchConfig);
      if (items.length === 0) continue;
      options.push({
        label: buildGroupLabel(group.id, group.name, items.length),
        title: group.name,
        options: isCollapsed(group.id)
          ? collapsedPlaceholder(group.id)
          : items.map((config) => ({ value: config.id, label: buildConfigLabel(config) })),
      });
    }

    const allUngrouped = typeConfigs.filter(
      (c) => !c.groupId || !typeGroups.some((g) => g.id === c.groupId),
    );
    const ungroupedMatched = !!keyword && '未分组'.includes(keyword);
    const ungrouped = ungroupedMatched ? allUngrouped : allUngrouped.filter(matchConfig);
    if (ungrouped.length > 0) {
      options.push({
        label: buildGroupLabel('__ungrouped__', '未分组', ungrouped.length),
        title: '未分组',
        options: isCollapsed('__ungrouped__')
          ? collapsedPlaceholder('__ungrouped__')
          : ungrouped.map((config) => ({ value: config.id, label: buildConfigLabel(config) })),
      });
    }

    return options;
  }, [typeConfigs, typeGroups, renderExtra, collapsedGroups, searchValue]);

  const handleSelect = (id: string | undefined) => {
    if (!id) {
      onChange(null);
      return;
    }
    const config = typeConfigs.find((c) => c.id === id) || null;
    onChange(config);
  };

  /** 把选中的多个配置合并到一个新分组 */
  const handleMergeToNewGroup = async () => {
    if (selectedIds.length === 0) {
      message.warning('请先勾选要合并的配置');
      return;
    }
    if (!newGroupName.trim()) {
      message.warning('请输入分组名称');
      return;
    }
    setBusy(true);
    try {
      const group = await addGroup(newGroupName.trim(), configType);
      await assignConfigsToGroup(selectedIds, group.id);
      setNewGroupName('');
      setSelectedIds([]);
      message.success(`已将 ${selectedIds.length} 个配置合并到分组「${group.name}」`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '合并分组失败');
    } finally {
      setBusy(false);
    }
  };

  /** 把选中的配置加入已有分组 */
  const handleMoveToGroup = async (groupId: string | null) => {
    if (selectedIds.length === 0) {
      message.warning('请先勾选配置');
      return;
    }
    setBusy(true);
    try {
      await assignConfigsToGroup(selectedIds, groupId);
      setSelectedIds([]);
      message.success(groupId ? '已加入分组' : '已移出分组');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteConfig = async (id: string) => {
    setBusy(true);
    try {
      await removeConfig(id);
      if (value === id) onChange(null);
      message.success('已删除配置');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    setBusy(true);
    try {
      await removeGroup(id);
      message.success('已删除分组（组内配置已移出分组）');
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
      if (renaming.kind === 'config') {
        await renameConfig(renaming.id, name);
      } else {
        await renameGroup(renaming.id, name);
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

  const renderConfigRow = (config: SavedTestConfig) => {
    const group = typeGroups.find((g) => g.id === config.groupId);
    return (
      <List.Item
        key={config.id}
        actions={[
          <Button
            key="rename"
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => setRenaming({ kind: 'config', id: config.id, name: config.name })}
          >
            改名
          </Button>,
          <Popconfirm
            key="delete"
            title="确定删除该配置模板吗？"
            description="删除后不可恢复"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => handleDeleteConfig(config.id)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>,
        ]}
      >
        <Space>
          <Checkbox
            checked={selectedIds.includes(config.id)}
            onChange={(e) => toggleSelect(config.id, e.target.checked)}
          />
          <span>{config.name}</span>
          {group && <Tag color="blue">{group.name}</Tag>}
          {renderExtra?.(config)}
        </Space>
      </List.Item>
    );
  };

  return (
    <>
      <Space.Compact style={{ width: '100%' }}>
        <Select
          size="small"
          style={{ flex: 1 }}
          placeholder={placeholder || '选择已保存的配置模板'}
          value={value || undefined}
          onChange={handleSelect}
          allowClear
          showSearch
          searchValue={searchValue}
          onSearch={setSearchValue}
          onOpenChange={(open) => {
            if (!open) setSearchValue('');
          }}
          filterOption={false}
          options={selectOptions}
          disabled={disabled}
        />
        {showManage && (
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => setIsManageOpen(true)}
          >
            管理
          </Button>
        )}
      </Space.Compact>

      <Modal
        title={`配置模板管理（${configType === 'iteration' ? '迭代参数' : '监控配置'}）`}
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
                // 记录本次选择后立即重置，下次可再次选择同一分组
                setTargetGroupId(gid);
                handleMoveToGroup(gid).finally(() => {
                  setTargetGroupId(undefined);
                  setGroupSelectKey((k) => k + 1);
                });
              }}
              options={typeGroups.map((g) => ({ value: g.id, label: g.name }))}
              disabled={typeGroups.length === 0 || selectedIds.length === 0}
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
            勾选下方配置后可合并为分组或加入已有分组；删除配置与分组均需二次确认。
          </div>
        </div>

        {/* 分组列表 */}
        {typeGroups.length > 0 && (
          <>
            <Text strong>分组</Text>
            <List
              size="small"
              dataSource={typeGroups}
              style={{ marginBottom: 8 }}
              renderItem={(group: ConfigGroup) => (
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
                      description="组内配置不会被删除，只会移出分组"
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
                    <Tag>{typeConfigs.filter((c) => c.groupId === group.id).length} 个配置</Tag>
                  </Space>
                </List.Item>
              )}
            />
            <Divider style={{ margin: '8px 0' }} />
          </>
        )}

        {/* 配置列表 */}
        <Text strong>配置模板</Text>
        {typeConfigs.length === 0 ? (
          <Empty description="暂无配置模板" style={{ margin: '16px 0' }} />
        ) : (
          <List
            size="small"
            dataSource={typeConfigs}
            renderItem={renderConfigRow}
            style={{ maxHeight: 360, overflow: 'auto' }}
          />
        )}
      </Modal>

      {/* 重命名弹窗 */}
      <Modal
        title={renaming?.kind === 'group' ? '重命名分组' : '重命名配置模板'}
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

export default ConfigTemplateSelect;
