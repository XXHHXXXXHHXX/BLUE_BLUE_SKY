import type { NodeTypes } from '@xyflow/react';
import { withScalable, withoutScalable } from './ScalableNodeWrapper';
import ACNode from './ACNode';
import PSUNode from './PSUNode';
import VRNode from './VRNode';
import PSIPNode from './PSIPNode';
import BusbarNode from './BusbarNode';
import CPUNode from './CPUNode';
import MemoryNode from './MemoryNode';
import FanNode from './FanNode';
import DiskNode from './DiskNode';
import IONode from './IONode';
import CardNode from './CardNode';
import SensorNode from './SensorNode';
import MgmtBoardNode from './MgmtBoardNode';
import ChassisNode from './ChassisNode';
import ThermometerNode from './ThermometerNode';
import CustomNode from './CustomNode';

/**
 * 带缩放功能的节点类型 - 用于设计页面
 */
export const nodeTypes: NodeTypes = {
  ac: withScalable(ACNode),
  psu: withScalable(PSUNode),
  vr: withScalable(VRNode),
  psip: withScalable(PSIPNode),
  busbar: withScalable(BusbarNode),
  cpu: withScalable(CPUNode),
  memory: withScalable(MemoryNode),
  fan: withScalable(FanNode),
  disk: withScalable(DiskNode),
  io: withScalable(IONode),
  card: withScalable(CardNode),
  sensor: withScalable(SensorNode),
  mgmtBoard: withScalable(MgmtBoardNode),
  chassis: withScalable(ChassisNode),
  thermometer: withScalable(ThermometerNode),
  custom: withScalable(CustomNode),
};

/**
 * 不带缩放功能的节点类型 - 用于监控页面和分身页面
 */
export const staticNodeTypes: NodeTypes = {
  ac: withoutScalable(ACNode),
  psu: withoutScalable(PSUNode),
  vr: withoutScalable(VRNode),
  psip: withoutScalable(PSIPNode),
  busbar: withoutScalable(BusbarNode),
  cpu: withoutScalable(CPUNode),
  memory: withoutScalable(MemoryNode),
  fan: withoutScalable(FanNode),
  disk: withoutScalable(DiskNode),
  io: withoutScalable(IONode),
  card: withoutScalable(CardNode),
  sensor: withoutScalable(SensorNode),
  mgmtBoard: withoutScalable(MgmtBoardNode),
  chassis: withoutScalable(ChassisNode),
  thermometer: withoutScalable(ThermometerNode),
  custom: withoutScalable(CustomNode),
};
