'use client';

import React from 'react';
import NodeIcon from '../topology/nodes/NodeIcon';
import type { HardwareNodeType } from '../../types/topology';
import { nodeTypeLabels } from '../../services/mockData';

interface ModuleCategory {
  label: string;
  types: HardwareNodeType[];
}

const categories: ModuleCategory[] = [
  { label: '电源类', types: ['ac', 'psu', 'vr', 'psip', 'busbar'] },
  { label: '负载类', types: ['cpu', 'memory', 'fan', 'disk', 'io', 'card'] },
  { label: '其他', types: ['sensor'] },
  { label: '自定义', types: ['custom'] },
];

const ModulePalette: React.FC = () => {
  const onDragStart = (event: React.DragEvent, nodeType: HardwareNodeType) => {
    event.dataTransfer.setData('application/reactflow-type', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="module-palette">
      <div className="palette-title">模块面板</div>
      {categories.map(cat => (
        <div key={cat.label} className="palette-category">
          <div className="category-label">{cat.label}</div>
          {cat.types.map(type => (
            <div
              key={type}
              className="palette-item"
              draggable
              onDragStart={(e) => onDragStart(e, type)}
            >
              <span className="palette-icon">
                <NodeIcon nodeType={type} />
              </span>
              <span>{nodeTypeLabels[type] ?? type}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default ModulePalette;
