'use client';

import React from 'react';
import { Timeline, Tag, Typography } from 'antd';

const { Text } = Typography;

interface AMUEvent {
  id: string;
  timestamp: string;
  type: 'warning' | 'error' | 'info';
  domain: string;
  message: string;
  value: number;
}

interface AMUEventListProps {
  events: AMUEvent[];
}

const COLOR_MAP: Record<AMUEvent['type'], string> = {
  info: 'blue',
  warning: 'orange',
  error: 'red',
};

const AMUEventList: React.FC<AMUEventListProps> = ({ events }) => {
  if (!events.length) {
    return <Text type="secondary">暂无事件</Text>;
  }

  return (
    <Timeline
      items={events.map((evt) => ({
        key: evt.id,
        color: COLOR_MAP[evt.type],
        children: (
          <div>
            <Text type="secondary" style={{ marginRight: 8 }}>{evt.timestamp}</Text>
            <Tag color={COLOR_MAP[evt.type]}>{evt.domain}</Tag>
            <br />
            <Text>{evt.message}</Text>
            <Text strong style={{ marginLeft: 8 }}>{evt.value}W</Text>
          </div>
        ),
      }))}
    />
  );
};

export default AMUEventList;
