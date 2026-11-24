/** 用例测试编排插件：查看任务/用例包/模板，创建与停止任务
 *
 * 创建和停止任务会真实下发执行，工具描述中已声明需用户明确要求。
 */
import { z } from 'zod';
import type { AiPlugin } from './pluginTypes';
import {
  createTestJob,
  getJobDetail,
  listJobs,
  listPipelineTemplates,
  listTestPackages,
  stopTestJob,
} from './testTools';

export const testPlugin: AiPlugin = {
  id: 'core.test-orchestration',
  name: '用例测试编排',
  description: '查看任务与用例包、创建迭代/流水线/火眼任务、停止任务',
  source: 'builtin',
  promptHint:
    '涉及用例测试时，先用 listJobs / listTestPackages / listPipelineTemplates 了解现状。' +
    '创建任务（createTestJob）和停止任务（stopTestJob）会真实下发执行，' +
    '直接调用工具即可（系统会弹出确认框展示完整参数由用户决定是否执行）。',
  tools: [
    {
      name: 'listJobs',
      description: '列出最近的测试任务（ID、名称、状态、模式、进度、结果数）',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 20'),
      }),
      execute: async (args) => {
        try {
          return listJobs(typeof args.limit === 'number' ? args.limit : 20);
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'listJobs 失败' };
        }
      },
    },
    {
      name: 'getJobDetail',
      description: '查看指定测试任务的详情（配置、阶段结果摘要、可选最近日志）',
      inputSchema: z.object({
        jobId: z.string(),
        includeLogs: z.boolean().optional().describe('是否附带最近 50 条日志，默认 false'),
      }),
      execute: async (args) => {
        try {
          const detail = getJobDetail(String(args.jobId), args.includeLogs === true);
          return detail ?? { error: `任务不存在: ${args.jobId}` };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'getJobDetail 失败' };
        }
      },
    },
    {
      name: 'listTestPackages',
      description: '列出用例包库中的测试包（ID、名称、必填环境变量）',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return listTestPackages();
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'listTestPackages 失败' };
        }
      },
    },
    {
      name: 'listPipelineTemplates',
      description: '列出已保存的流水线模板（名称、阶段数与各阶段用例包）',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return listPipelineTemplates();
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'listPipelineTemplates 失败' };
        }
      },
    },
    {
      name: 'createTestJob',
      description:
        '创建并启动测试任务（本地迭代 / 流水线 / 火眼三种模式之一）。会真实下发执行，需用户明确确认方案后再调用',
      requiresApproval: true,
      inputSchema: z.object({
        name: z.string().describe('任务名称'),
        host: z.string().optional().describe('目标机 IP（本地/流水线模式）'),
        port: z.number().int().optional().describe('SSH 端口，默认 22'),
        username: z.string().optional(),
        password: z.string().optional(),
        packageLibraryId: z
          .string()
          .optional()
          .describe('本地迭代模式的用例包 ID，可先用 listTestPackages 获取'),
        iterationParams: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              mode: z.enum(['range', 'custom']),
              start: z.number(),
              end: z.number(),
              step: z.number(),
              values: z.array(z.string()),
            }),
          )
          .optional()
          .describe('迭代参数（本地迭代模式必填）'),
        huoyan: z
          .object({
            queueId: z.string(),
            definitionId: z.string(),
            definitionName: z.string().optional(),
            arguments: z.array(z.object({ name: z.string(), value: z.any() })),
            bindings: z.array(z.object({ role: z.string(), target_name: z.string() })),
            timeoutHours: z.number().optional(),
            baseUrl: z.string().optional(),
          })
          .optional()
          .describe('火眼模式配置'),
        stages: z
          .array(
            z.object({
              name: z.string().describe('阶段名称'),
              order: z.number().int().describe('阶段顺序，从 1 开始'),
              packageMode: z
                .enum(['local', 'huoyan'])
                .optional()
                .describe('该阶段执行模式：local=本地用例包（默认），huoyan=提交火眼平台'),
              packageLibraryId: z.string().optional().describe('local 模式的用例包 ID'),
              iterationParams: z
                .array(
                  z.object({
                    id: z.string(),
                    name: z.string(),
                    mode: z.enum(['range', 'custom']),
                    start: z.number(),
                    end: z.number(),
                    step: z.number(),
                    values: z.array(z.string()),
                  }),
                )
                .optional()
                .describe('该阶段的迭代参数'),
              monitorCommands: z
                .array(z.object({ name: z.string(), command: z.string() }))
                .optional()
                .describe('该阶段的监控命令'),
              huoyan: z
                .object({
                  queueId: z.string(),
                  definitionId: z.string(),
                  definitionName: z.string().optional(),
                  arguments: z.array(z.object({ name: z.string(), value: z.any() })),
                  bindings: z.array(z.object({ role: z.string(), target_name: z.string() })),
                  timeoutHours: z.number().optional(),
                  baseUrl: z.string().optional(),
                })
                .optional()
                .describe('packageMode=huoyan 时的阶段火眼配置'),
            }),
          )
          .optional()
          .describe('流水线模式的阶段列表（提供时按流水线执行）'),
      }),
      execute: async (args) => {
        try {
          return createTestJob({
            name: String(args.name),
            host: typeof args.host === 'string' ? args.host : undefined,
            port: typeof args.port === 'number' ? args.port : undefined,
            username: typeof args.username === 'string' ? args.username : undefined,
            password: typeof args.password === 'string' ? args.password : undefined,
            packageLibraryId: typeof args.packageLibraryId === 'string' ? args.packageLibraryId : undefined,
            iterationParams: args.iterationParams as never,
            huoyan: args.huoyan as never,
            stages: args.stages as never,
          });
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'createTestJob 失败' };
        }
      },
    },
    {
      name: 'stopTestJob',
      description: '停止指定运行中/等待中的测试任务。会真实中止执行，需用户明确要求',
      requiresApproval: true,
      inputSchema: z.object({ jobId: z.string() }),
      execute: async (args) => {
        try {
          return stopTestJob(String(args.jobId));
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'stopTestJob 失败' };
        }
      },
    },
  ],
};
