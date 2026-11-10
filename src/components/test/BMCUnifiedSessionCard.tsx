'use client';

import React, { useState } from 'react';
import { Card, Select, Button, Space, Tag } from 'antd';
import { SafetyOutlined } from '@ant-design/icons';
import { useTestStore, type TestTab } from '../../stores/testStore';
import { useBMCSessionStore } from '../../stores/bmcSessionStore';
import BMCConfigPanel from '../monitor/BMCConfigPanel';

const { Option } = Select;

interface BMCUnifiedSessionCardProps {
  tab: TestTab;
}

/**
 * BMC 统一会话配置卡片
 *
 * 与「目标测试主机连接配置」并列展示，明确区分「连接测试主机」和「连接 BMC」。
 * 所有目标为 BMC 的命令（调整命令 / 监控命令 / 日志监控）统一使用这里选择的会话。
 */
const BMCUnifiedSessionCard: React.FC<BMCUnifiedSessionCardProps> = ({ tab }) => {
  const { setGlobalBmcSessionId } = useTestStore();
  const { sessions: bmcSessions } = useBMCSessionStore();
  const [isBMCConfigOpen, setIsBMCConfigOpen] = useState(false);

  const selectedSession = bmcSessions.find(
    (s) => s.id === tab.powerTestConfig.globalBmcSessionId,
  );

  return (
    <Card
      title={
        <Space>
          <SafetyOutlined />
          <span>BMC 连接配置</span>
        </Space>
      }
      size="small"
      extra={
        <Space>
          {selectedSession ? (
            <Tag color="success">已选择：{selectedSession.name}</Tag>
          ) : (
            <Tag color="default">未选择会话</Tag>
          )}
          <Button
            type="primary"
            ghost
            size="small"
            icon={<SafetyOutlined />}
            onClick={() => setIsBMCConfigOpen(true)}
          >
            BMC会话管理
          </Button>
        </Space>
      }
    >
      <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
        所有目标为 BMC 的命令（调整命令 / 监控命令 / 日志监控）统一使用此会话；与上方「目标测试主机连接配置」相互独立。
      </div>
      <Select
        size="small"
        style={{ width: '100%' }}
        placeholder={
          bmcSessions.length > 0
            ? '选择 BMC 会话（所有 BMC 目标命令将统一使用）'
            : '暂无 BMC 会话，请先点击右上角「BMC会话管理」添加'
        }
        value={tab.powerTestConfig.globalBmcSessionId || undefined}
        onChange={(value) => setGlobalBmcSessionId(tab.id, value || null)}
        disabled={tab.isRunningTest || bmcSessions.length === 0}
        allowClear
      >
        {bmcSessions.map((session) => (
          <Option key={session.id} value={session.id}>
            <Space>
              <span>{session.name}</span>
              <span style={{ color: '#999', fontSize: 12 }}>
                {session.ip}:{session.port || 22}
              </span>
            </Space>
          </Option>
        ))}
      </Select>

      <BMCConfigPanel
        open={isBMCConfigOpen}
        onClose={() => setIsBMCConfigOpen(false)}
      />
    </Card>
  );
};

export default BMCUnifiedSessionCard;
