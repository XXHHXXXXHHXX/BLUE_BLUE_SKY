/** 拓扑插件：监控启停 + 拓扑设计（节点/连线增删改）
 *
 * 注意：写操作（新增/删除/改拓扑结构、启停监控）会直接改服务端数据，
 * 工具描述里已声明「需用户明确要求」；AI 侧不会自动执行。
 */
import { z } from 'zod';
import type { AiPlugin } from './pluginTypes';
import {
  addTopologyEdge,
  addTopologyNode,
  createTopologyRecord,
  getMonitorState,
  getTopologyRaw,
  getTopologySummary,
  listTopologies,
  removeTopologyEdge,
  removeTopologyNode,
  setMonitorState,
  updateTopologyNode,
} from './topologyTools';

const NODE_TYPES = [
  'ac', 'psu', 'vr', 'psip', 'busbar',
  'cpu', 'memory', 'fan', 'disk', 'io', 'card', 'sensor', 'mgmtBoard',
  'chassis', 'thermometer', 'custom', 'control', 'view', 'aggregator',
] as const;

export const topologyPlugin: AiPlugin = {
  id: 'core.topology',
  name: '拓扑监控与设计',
  description: '查看/新建拓扑、增删节点与连线、启停实时监控',
  source: 'builtin',
  promptHint:
    '涉及拓扑时先调用 listTopologies 确认拓扑 ID，再用 getTopology 查看结构。' +
    '新增节点/连线、删除节点、修改拓扑结构、启停监控都属于会改变系统状态的操作，' +
    '直接调用工具即可（系统会弹出确认框由用户决定是否执行），执行后在回复中说明改了什么。',
  tools: [
    {
      name: 'listTopologies',
      description: '列出所有拓扑（ID、名称、节点数、更新时间）',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return listTopologies();
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'listTopologies 失败' };
        }
      },
    },
    {
      name: 'getTopology',
      description: '读取指定拓扑的节点与连线结构（含节点类型、标签、位置、连线损耗）',
      inputSchema: z.object({ topologyId: z.string().describe('拓扑 ID，可先用 listTopologies 获取') }),
      execute: async (args) => {
        try {
          const summary = getTopologySummary(String(args.topologyId));
          return summary ?? { error: `拓扑不存在: ${args.topologyId}` };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'getTopology 失败' };
        }
      },
    },
    {
      name: 'createTopology',
      description: '新建一个拓扑；可选从现有拓扑复制。会改变系统数据，需用户明确要求',
      requiresApproval: true,
      inputSchema: z.object({
        name: z.string().describe('新拓扑名称'),
        description: z.string().optional(),
        copyFromId: z.string().optional().describe('复制来源的拓扑 ID'),
      }),
      execute: async (args) => {
        try {
          return createTopologyRecord(
            String(args.name),
            typeof args.description === 'string' ? args.description : undefined,
            typeof args.copyFromId === 'string' ? args.copyFromId : undefined,
          );
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'createTopology 失败' };
        }
      },
    },
    {
      name: 'addTopologyNode',
      description: '在指定拓扑中新增一个节点（模块）。会改变系统数据，需用户明确要求',
      requiresApproval: true,
      inputSchema: z.object({
        topologyId: z.string(),
        nodeType: z.enum(NODE_TYPES).describe('节点类型，如 cpu / memory / fan / psu / ac / custom'),
        label: z.string().optional().describe('节点显示名'),
        x: z.number().optional().describe('画布 X 坐标，缺省自动排布'),
        y: z.number().optional().describe('画布 Y 坐标，缺省自动排布'),
      }),
      execute: async (args) => {
        try {
          const position =
            typeof args.x === 'number' && typeof args.y === 'number'
              ? { x: args.x, y: args.y }
              : undefined;
          return addTopologyNode({
            topologyId: String(args.topologyId),
            nodeType: args.nodeType as (typeof NODE_TYPES)[number],
            label: typeof args.label === 'string' ? args.label : undefined,
            position,
          });
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'addTopologyNode 失败' };
        }
      },
    },
    {
      name: 'addTopologyEdge',
      description: '在指定拓扑中连接两个节点（新增连线）。会改变系统数据，需用户明确要求',
      requiresApproval: true,
      inputSchema: z.object({
        topologyId: z.string(),
        source: z.string().describe('源节点 ID'),
        target: z.string().describe('目标节点 ID'),
        label: z.string().optional(),
      }),
      execute: async (args) => {
        try {
          return addTopologyEdge({
            topologyId: String(args.topologyId),
            source: String(args.source),
            target: String(args.target),
            label: typeof args.label === 'string' ? args.label : undefined,
          });
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'addTopologyEdge 失败' };
        }
      },
    },
    {
      name: 'removeTopologyNode',
      description: '删除拓扑中的节点及其关联连线。会改变系统数据，需用户明确要求',
      requiresApproval: true,
      inputSchema: z.object({ topologyId: z.string(), nodeId: z.string() }),
      execute: async (args) => {
        try {
          return removeTopologyNode(String(args.topologyId), String(args.nodeId));
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'removeTopologyNode 失败' };
        }
      },
    },
    {
      name: 'removeTopologyEdge',
      description: '删除拓扑中的一条连线。会改变系统数据，需用户明确要求',
      requiresApproval: true,
      inputSchema: z.object({ topologyId: z.string(), edgeId: z.string() }),
      execute: async (args) => {
        try {
          return removeTopologyEdge(String(args.topologyId), String(args.edgeId));
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'removeTopologyEdge 失败' };
        }
      },
    },
    {
      name: 'updateTopologyNode',
      description: '修改节点显示名或别名。会改变系统数据，需用户明确要求',
      requiresApproval: true,
      inputSchema: z.object({
        topologyId: z.string(),
        nodeId: z.string(),
        label: z.string().optional(),
        alias: z.string().optional(),
      }),
      execute: async (args) => {
        try {
          return updateTopologyNode(String(args.topologyId), String(args.nodeId), {
            label: typeof args.label === 'string' ? args.label : undefined,
            alias: typeof args.alias === 'string' ? args.alias : undefined,
          });
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'updateTopologyNode 失败' };
        }
      },
    },
    {
      name: 'getMonitorState',
      description: '查询实时监控是否开启及轮询间隔',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return getMonitorState();
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'getMonitorState 失败' };
        }
      },
    },
    {
      name: 'setMonitorState',
      description: '开启/关闭实时监控或调整轮询间隔。会改变系统状态，需用户明确要求',
      requiresApproval: true,
      inputSchema: z.object({
        isPolling: z.boolean().optional().describe('true=开启监控，false=关闭'),
        pollInterval: z.number().int().min(500).optional().describe('轮询间隔（毫秒）'),
      }),
      execute: async (args) => {
        try {
          return setMonitorState({
            isPolling: typeof args.isPolling === 'boolean' ? args.isPolling : undefined,
            pollInterval: typeof args.pollInterval === 'number' ? args.pollInterval : undefined,
          });
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'setMonitorState 失败' };
        }
      },
    },
    {
      name: 'getTopologyRaw',
      description: '读取拓扑完整原始数据（含节点全部字段），用于深度分析；数据量大，慎用',
      inputSchema: z.object({ topologyId: z.string() }),
      execute: async (args) => {
        try {
          const raw = getTopologyRaw(String(args.topologyId));
          return raw ?? { error: `拓扑不存在: ${args.topologyId}` };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'getTopologyRaw 失败' };
        }
      },
    },
  ],
};
