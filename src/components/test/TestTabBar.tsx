'use client';

import React, { useState, useRef } from 'react';
import { Tabs, Tag, Space, Input, Tooltip } from 'antd';
import { DesktopOutlined, EditOutlined } from '@ant-design/icons';
import { useTestStore } from '../../stores/testStore';

const TestTabBar: React.FC = () => {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab, updateTabName } = useTestStore();
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<any>(null);

  const handleTabChange = (activeKey: string) => {
    setActiveTab(activeKey);
  };

  const handleEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
    if (action === 'add') {
      addTab();
    } else if (action === 'remove') {
      removeTab(targetKey as string);
    }
  };

  const handleDoubleClick = (tab: typeof tabs[0], e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTabId(tab.id);
    setEditValue(tab.name);
    // 自动聚焦
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const handleNameSubmit = () => {
    if (editingTabId && editValue.trim()) {
      updateTabName(editingTabId, editValue.trim());
    }
    setEditingTabId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 阻止事件冒泡，防止 Tabs 组件捕获 Backspace 等按键
    e.stopPropagation();
    
    if (e.key === 'Enter') {
      handleNameSubmit();
    } else if (e.key === 'Escape') {
      setEditingTabId(null);
    }
    // Backspace 不需要特殊处理，阻止冒泡后即可正常删除输入框中的字符
  };

  const renderTabLabel = (tab: typeof tabs[0]) => {
    if (editingTabId === tab.id) {
      return (
        <Input
          ref={inputRef}
          size="small"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleNameSubmit}
          onKeyDown={handleKeyDown}
          style={{ width: 120, height: 22 }}
          onClick={(e) => e.stopPropagation()}
        />
      );
    }

    return (
      <Tooltip title="双击重命名">
        <Space 
          size={4} 
          onDoubleClick={(e) => handleDoubleClick(tab, e)}
          style={{ cursor: 'pointer' }}
        >
          <DesktopOutlined />
          <span>{tab.name}</span>
          <Tag 
            color={tab.isSSHConnected ? "success" : "default"} 
            style={{ fontSize: 10, lineHeight: '14px', padding: '0 4px', margin: 0 }}
          >
            {tab.isSSHConnected ? '已连' : '未连'}
          </Tag>
        </Space>
      </Tooltip>
    );
  };

  return (
    <div 
      style={{ 
        display: 'flex', 
        alignItems: 'center',
        background: '#f5f5f5',
        borderBottom: '1px solid #d9d9d9',
        padding: '8px 16px',
      }}
    >
      <Tabs
        type="editable-card"
        activeKey={activeTabId || undefined}
        onChange={handleTabChange}
        onEdit={handleEdit}
        style={{ flex: 1 }}
        items={tabs.map(tab => ({
          key: tab.id,
          label: renderTabLabel(tab),
          closable: tabs.length > 1,
        }))}
      />
    </div>
  );
};

export default TestTabBar;
