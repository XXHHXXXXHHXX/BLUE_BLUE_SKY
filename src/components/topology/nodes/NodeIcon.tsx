'use client';

import React from 'react';
import * as AntIcons from '@ant-design/icons';
import type { HardwareNodeType } from '../../../types/topology';

const defaultIconMap: Record<HardwareNodeType, string> = {
  ac: 'ThunderboltOutlined',
  psu: 'ApiOutlined',
  vr: 'ControlOutlined',
  psip: 'NodeIndexOutlined',
  cpu: 'DesktopOutlined',
  memory: 'DatabaseOutlined',
  fan: 'FanOutlined',
  disk: 'HddOutlined',
  io: 'SwapOutlined',
  card: 'CreditCardOutlined',
  sensor: 'FireOutlined',
  mgmtBoard: 'SettingOutlined',
  chassis: 'AppstoreOutlined',
  thermometer: 'DashboardOutlined',
  custom: 'BuildOutlined',
};

/** Fan SVG icon (custom, since Ant Design doesn't have a fan icon) */
const FanSvgIcon = () => (
  <span role="img" aria-label="fan" className="anticon" style={{ fontSize: 'inherit' }}>
    <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
      <path d="M512 64c-53 0-96 43-96 96 0 106-86 192-192 192-53 0-96 43-96 96s43 96 96 96c106 0 192 86 192 192 0 53 43 96 96 96s96-43 96-96c0-106 86-192 192-192 53 0 96-43 96-96s-43-96-96-96c-106 0-192-86-192-192 0-53-43-96-96-96zm0 400a48 48 0 1 1 0 96 48 48 0 0 1 0-96z" />
    </svg>
  </span>
);

interface NodeIconProps {
  nodeType: HardwareNodeType;
  customIcon?: string;
  customIconUrl?: string;
}

const NodeIcon: React.FC<NodeIconProps> = ({ nodeType, customIcon, customIconUrl }) => {
  // 优先使用用户上传的自定义图标
  if (customIconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={customIconUrl}
        alt="custom icon"
        style={{ width: '1em', height: '1em', objectFit: 'contain' }}
      />
    );
  }

  const iconName = customIcon || defaultIconMap[nodeType];

  // Special case for fan custom SVG
  if (!customIcon && nodeType === 'fan') {
    return <FanSvgIcon />;
  }

  const IconComponent = (AntIcons as unknown as Record<string, React.ComponentType>)[iconName];
  if (IconComponent) {
    return <IconComponent />;
  }

  // Fallback to default if custom icon name is invalid
  const fallbackName = defaultIconMap[nodeType];
  if (fallbackName === 'FanOutlined') {
    return <FanSvgIcon />;
  }
  const FallbackIcon = (AntIcons as unknown as Record<string, React.ComponentType>)[fallbackName];
  return FallbackIcon ? <FallbackIcon /> : null;
};

export default NodeIcon;

/** List of available icons for the icon picker */
export const availableIcons = [
  'ThunderboltOutlined', 'ApiOutlined', 'ControlOutlined', 'NodeIndexOutlined',
  'DesktopOutlined', 'DatabaseOutlined', 'HddOutlined', 'SwapOutlined',
  'CreditCardOutlined', 'FireOutlined', 'SettingOutlined', 'AppstoreOutlined',
  'CloudOutlined', 'WifiOutlined', 'GlobalOutlined', 'SafetyOutlined',
  'BulbOutlined', 'RocketOutlined', 'ExperimentOutlined', 'ToolOutlined',
  'BuildOutlined', 'ClusterOutlined', 'DeploymentUnitOutlined', 'FundOutlined',
  'DashboardOutlined', 'RadarChartOutlined', 'AlertOutlined', 'BugOutlined',
  'CodeOutlined', 'CloudServerOutlined', 'LaptopOutlined', 'MobileOutlined',
  'TabletOutlined', 'PrinterOutlined', 'UsbOutlined', 'PoweroffOutlined',
];

export { defaultIconMap };
