'use client';

import React from 'react';
import { Popover } from 'antd';
import * as AntIcons from '@ant-design/icons';
import { availableIcons } from '../topology/nodes/NodeIcon';

interface IconPickerProps {
  value?: string;
  onChange: (iconName: string) => void;
  children: React.ReactNode;
}

const IconPicker: React.FC<IconPickerProps> = ({ value, onChange, children }) => {
  const content = (
    <div className="icon-picker-grid">
      {availableIcons.map(name => {
        const Icon = (AntIcons as unknown as Record<string, React.ComponentType>)[name];
        if (!Icon) return null;
        return (
          <div
            key={name}
            className={`icon-picker-item${value === name ? ' selected' : ''}`}
            onClick={() => onChange(name)}
            title={name.replace('Outlined', '')}
          >
            <Icon />
          </div>
        );
      })}
    </div>
  );

  return (
    <Popover content={content} title="选择图标" trigger="click" placement="right">
      {children}
    </Popover>
  );
};

export default IconPicker;
