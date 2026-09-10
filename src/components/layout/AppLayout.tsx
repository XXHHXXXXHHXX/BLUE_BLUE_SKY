'use client';

import React, { useState } from 'react';
import { Layout, Menu, Typography, Switch, Space, Tag, Button } from 'antd';
import {
  DashboardOutlined,
  ThunderboltOutlined,
  ExperimentOutlined,
  AimOutlined,
  EditOutlined,
  AppstoreOutlined,
  FileTextOutlined,
  InboxOutlined,
  ClusterOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useRouter, usePathname } from 'next/navigation';
import { useMonitorStore } from '../../stores/monitorStore';
import { useBMCSessionStore } from '../../stores/bmcSessionStore';
import TestPackageLibrary from '../test/TestPackageLibrary';
import TestReportManager from '../test/TestReportManager';
import TestDraftManager from '../test/TestDraftManager';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '拓扑监控' },
  { key: '/design', icon: <EditOutlined />, label: '拓扑设计' },
  { key: '/efficiency', icon: <ThunderboltOutlined />, label: '效率分析' },
  { key: '/test', icon: <ExperimentOutlined />, label: '用例测试' },
  { key: '/optimize', icon: <AimOutlined />, label: '自动寻优' },
  { key: '/analysis', icon: <BarChartOutlined />, label: '数据分析' },
];

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { isPolling, startPolling, stopPolling, lastUpdate } = useMonitorStore();
  const { sessions, connectedSessionId } = useBMCSessionStore();
  const [isPackageLibraryOpen, setIsPackageLibraryOpen] = useState(false);
  const [isReportManagerOpen, setIsReportManagerOpen] = useState(false);
  const [isDraftManagerOpen, setIsDraftManagerOpen] = useState(false);

  // 分身页面（/view）隐藏导航栏和顶部 Header，全屏显示拓扑
  const isClonePage = pathname === '/view';
  // 用例测试页面（包括子页面）
  const isTestPage = pathname === '/test' || pathname.startsWith('/test/');

  return (
    <Layout style={{ height: '100vh' }}>
      {!isClonePage && (
        <Sider width={180} theme="dark">
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
              蓝天系统
            </Typography.Title>
            <Typography.Text style={{ color: '#8c8c8c', fontSize: 11 }}>
              电源域监控
            </Typography.Text>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[pathname.startsWith('/test/') ? '/test' : pathname]}
            items={menuItems}
            onClick={({ key }) => router.push(key)}
          />
        </Sider>
      )}
      <Layout>
        {!isClonePage && (
          <Header style={{
            background: '#fff',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            height: 48,
          }}>
            {isTestPage ? (
              // 用例测试页面：显示用例包库和报告管理按钮
              <>
                <Space>
                  <Typography.Text strong>用例测试</Typography.Text>
                  <Button
                    type="primary"
                    ghost
                    size="small"
                    icon={<AppstoreOutlined />}
                    onClick={() => setIsPackageLibraryOpen(true)}
                  >
                    用例包库
                  </Button>
                  <Button
                    type="primary"
                    ghost
                    size="small"
                    icon={<FileTextOutlined />}
                    onClick={() => setIsReportManagerOpen(true)}
                  >
                    报告管理
                  </Button>
                  <Button
                    type="primary"
                    ghost
                    size="small"
                    icon={<InboxOutlined />}
                    onClick={() => setIsDraftManagerOpen(true)}
                  >
                    草稿箱
                  </Button>
                  <Button
                    type="primary"
                    ghost
                    size="small"
                    icon={<ClusterOutlined />}
                    onClick={() => router.push('/test/jobs')}
                  >
                    任务中心
                  </Button>
                </Space>
                <TestPackageLibrary
                  visible={isPackageLibraryOpen}
                  onClose={() => setIsPackageLibraryOpen(false)}
                />
                <TestReportManager
                  visible={isReportManagerOpen}
                  onClose={() => setIsReportManagerOpen(false)}
                />
                <TestDraftManager
                  visible={isDraftManagerOpen}
                  onClose={() => setIsDraftManagerOpen(false)}
                />
              </>
            ) : (
              // 其他页面：显示实时监控开关
              <>
                <Space>
                  <Typography.Text strong>实时监控</Typography.Text>
                  <Switch
                    checked={isPolling}
                    onChange={async (v) => {
                      if (v) {
                        await startPolling();
                      } else {
                        await stopPolling();
                      }
                    }}
                    checkedChildren="ON"
                    unCheckedChildren="OFF"
                    size="small"
                  />
                  {isPolling && <Tag color="green">运行中</Tag>}
                  {connectedSessionId ? (
                    (() => {
                      const session = sessions.find((s) => s.id === connectedSessionId);
                      return session ? (
                        <Tag color="blue">BMC: {session.name}</Tag>
                      ) : null;
                    })()
                  ) : (
                    <Tag color="warning">未连接 BMC</Tag>
                  )}
                </Space>
                {lastUpdate && (
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    最后更新: {new Date(lastUpdate).toLocaleTimeString()}
                  </Typography.Text>
                )}
              </>
            )}
          </Header>
        )}
        <Content style={{ position: 'relative', overflow: 'auto' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
