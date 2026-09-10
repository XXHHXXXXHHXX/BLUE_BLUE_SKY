'use client';

import React, { useEffect } from 'react';
import { Empty, Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTestStore } from '../../src/stores/testStore';
import TestTabBar from '../../src/components/test/TestTabBar';
import SSHLoginPanel from '../../src/components/test/SSHLoginPanel';
import PowerTestPanel from '../../src/components/test/PowerTestPanel';
import ShellTerminal from '../../src/components/test/ShellTerminal';

export default function TestPage() {
  const { 
    tabs, 
    activeTabId, 
    isShellVisible,
    addTab, 
    setShellVisible 
  } = useTestStore();

  const activeTab = tabs.find(t => t.id === activeTabId);

  // 初始化时创建一个默认标签页
  useEffect(() => {
    if (tabs.length === 0) {
      addTab();
    }
  }, []);

  if (tabs.length === 0) {
    return (
      <div style={{ 
        height: '100%', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center' 
      }}>
        <Empty
          description="暂无测试标签页"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={addTab}>
            新建测试页面
          </Button>
        </Empty>
      </div>
    );
  }

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* 标签栏 */}
      <TestTabBar />

      {/* 主内容区域 */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        overflow: 'hidden',
      }}>
        {/* 左侧：测试配置区域 */}
        <div style={{ 
          flex: 1, 
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          padding: 16,
        }}>
          {activeTab ? (
            <>
              {/* SSH连接配置 */}
              <SSHLoginPanel tab={activeTab} />
              
              {/* 迭代遍历测试面板 */}
              <div style={{ marginTop: 16 }}>
                <PowerTestPanel tab={activeTab} />
              </div>
            </>
          ) : (
            <Empty description="请选择一个标签页" />
          )}
        </div>

        {/* 右侧：Shell终端 */}
        {activeTab && (
          <ShellTerminal 
            key={activeTab.id}
            tab={activeTab}
            isVisible={isShellVisible}
            onToggle={() => setShellVisible(!isShellVisible)}
          />
        )}
      </div>
    </div>
  );
}
