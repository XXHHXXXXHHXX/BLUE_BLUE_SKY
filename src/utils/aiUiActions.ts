/** AI 界面操控执行器
 *
 * 服务端把 UI 类工具声明为「客户端工具」，模型调用后暂停并由前端执行真实界面动作。
 * 这里集中处理所有界面动作，返回结构化结果供回传给模型。
 */
import { useTestStore } from '../stores/testStore';
import { useTopologyStore } from '../stores/topologyStore';
import { useDesignTopologyStore } from '../stores/designTopologyStore';
import { useCloneTopologyStore } from '../stores/cloneTopologyStore';
import { useAiContextStore } from '../stores/aiContextStore';
import { highlightFields } from './highlightField';

export interface UiActionContext {
  /** Next.js router 的 push */
  navigate: (path: string) => void;
  /** 当前页面路径 */
  pathname: string;
  /** 打开弹窗（由宿主组件注入） */
  openPanel?: (panel: string) => void;
}

export interface UiActionResult {
  ok: boolean;
  message: string;
  detail?: unknown;
}

/** 执行一个界面动作；未知工具返回 ok:false 以便模型纠正 */
export async function executeUiAction(
  toolName: string,
  args: Record<string, unknown>,
  ctx: UiActionContext,
): Promise<UiActionResult> {
  switch (toolName) {
    case 'navigateTo': {
      const path = String(args.path || '').trim();
      if (!path.startsWith('/')) {
        return { ok: false, message: `路径必须以 / 开头，收到：${path}` };
      }
      ctx.navigate(path);
      return { ok: true, message: `已跳转到 ${path}`, detail: { path } };
    }

    case 'switchTopology': {
      const topologyId = String(args.topologyId || '').trim();
      if (!topologyId) return { ok: false, message: '缺少 topologyId' };
      // 按当前页面选择对应 store；分身页与设计页各有独立 store
      if (ctx.pathname === '/view') {
        const ok = await useCloneTopologyStore.getState().switchTopology(topologyId);
        return ok
          ? { ok: true, message: `已切换到拓扑 ${topologyId}`, detail: { topologyId } }
          : { ok: false, message: `切换拓扑失败：${topologyId} 不存在或加载出错` };
      }
      if (ctx.pathname === '/design') {
        const ok = await useDesignTopologyStore.getState().switchTopology(topologyId);
        return ok
          ? { ok: true, message: `已切换到拓扑 ${topologyId}`, detail: { topologyId } }
          : { ok: false, message: `切换拓扑失败：${topologyId} 不存在或加载出错` };
      }
      if (ctx.pathname === '/') {
        const ok = await useTopologyStore.getState().switchTopology(topologyId);
        return ok
          ? { ok: true, message: `已切换到拓扑 ${topologyId}`, detail: { topologyId } }
          : { ok: false, message: `切换拓扑失败：${topologyId} 不存在或加载出错` };
      }
      return {
        ok: false,
        message: `当前页面（${ctx.pathname}）没有拓扑视图，请先 navigateTo 到 / 或 /design`,
      };
    }

    case 'selectReport': {
      const ids = Array.isArray(args.reportIds) ? (args.reportIds as string[]).map(String) : [];
      if (ids.length === 0) return { ok: false, message: '缺少 reportIds' };
      useAiContextStore.getState().setSelectedReportIds(ids);
      if (ctx.pathname !== '/analysis') {
        // 不在数据分析页时，选中只作为对话上下文生效
        return {
          ok: true,
          message: `已把 ${ids.length} 份报告设为对话上下文（当前不在数据分析页，页面选择未同步）`,
          detail: { reportIds: ids },
        };
      }
      return { ok: true, message: `已选中 ${ids.length} 份报告`, detail: { reportIds: ids } };
    }

    case 'highlightField': {
      const keys = Array.isArray(args.fieldKeys) ? (args.fieldKeys as string[]).map(String) : [];
      if (keys.length === 0) return { ok: false, message: '缺少 fieldKeys' };
      if (typeof document === 'undefined') {
        return { ok: false, message: '当前环境不支持高亮' };
      }
      // 先确认页面上确实存在这些配置区，否则告知模型（可能需要先导航到对应页面）
      const found = keys.filter((k) => document.querySelector(`[data-field-key="${k}"]`));
      if (found.length === 0) {
        return {
          ok: false,
          message: `当前页面没有找到配置区：${keys.join('、')}。可用高亮标识见页面配置区，或先导航到对应页面`,
          detail: { fieldKeys: keys },
        };
      }
      highlightFields(found);
      return {
        ok: true,
        message: `已高亮 ${found.length} 个配置区域`,
        detail: { fieldKeys: found, missing: keys.filter((k) => !found.includes(k)) },
      };
    }

    case 'switchTestTab': {
      const store = useTestStore.getState();
      const tabId = typeof args.tabId === 'string' ? args.tabId : '';
      const tabName = typeof args.tabName === 'string' ? args.tabName : '';
      let target = tabId ? store.tabs.find((t) => t.id === tabId) : undefined;
      if (!target && tabName) target = store.tabs.find((t) => t.name === tabName);
      if (!target && !tabId && !tabName) target = store.tabs[0];
      if (!target) {
        return {
          ok: false,
          message: `未找到目标标签页（现有：${store.tabs.map((t) => t.name).join('、') || '无'}）`,
        };
      }
      store.setActiveTab(target.id);
      return { ok: true, message: `已切换到标签页 ${target.name}`, detail: { tabId: target.id } };
    }

    case 'startLiveAnalysis': {
      const reportId = String(args.reportId || '').trim();
      if (!reportId) return { ok: false, message: '缺少 reportId' };
      const direction = args.direction === 'min' ? 'min' : 'max';
      const rank = typeof args.rank === 'number' ? args.rank : 0;
      const target = typeof args.target === 'string' && args.target ? args.target : undefined;

      // 先广播请求（数据分析页已挂载时立即消费），再确保跳到数据分析页
      useAiContextStore.getState().requestLiveAnalysis({ reportId, target, direction, rank });
      if (ctx.pathname !== '/analysis') {
        ctx.navigate('/analysis');
        return {
          ok: true,
          message: `已跳转到数据分析页并启动实时建模（报告 ${reportId}）`,
          detail: { reportId, target, direction, rank },
        };
      }
      return {
        ok: true,
        message: `已在当前页启动实时建模（报告 ${reportId}）`,
        detail: { reportId, target, direction, rank },
      };
    }

    case 'openPanel': {
      const panel = String(args.panel || '');
      if (!ctx.openPanel) return { ok: false, message: '当前页面不支持打开该面板' };
      ctx.openPanel(panel);
      return { ok: true, message: `已打开面板 ${panel}`, detail: { panel } };
    }

    default:
      return { ok: false, message: `未知界面动作：${toolName}` };
  }
}
