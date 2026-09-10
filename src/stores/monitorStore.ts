/** 监控数据状态管理 - 客户端独立状态（每个标签页独立） */
import { create } from 'zustand';
import { useTopologyStore } from './topologyStore';
import { useCloneTopologyStore } from './cloneTopologyStore';
import {
  pollAllData,
  type PollResult,
} from '../services/backendApi';
import { useBMCSessionStore } from './bmcSessionStore';
import { message } from 'antd';

// sessionStorage 键名
const SESSION_KEY = 'blue_sky_monitor_state';

interface MonitorState {
  isPolling: boolean;
  pollInterval: number;
  isLoading: boolean;
  error: string | null;
  lastPollResult: PollResult | null;
  lastUpdate: string | null;
  
  // 私有状态
  _intervalId: number | null;

  // 方法
  startPolling: () => Promise<void>;
  stopPolling: () => Promise<void>;
  togglePolling: () => Promise<void>;
  refreshOnce: () => Promise<void>;
  setPollInterval: (ms: number) => void;
}

// 默认轮询间隔 2秒
const DEFAULT_POLL_INTERVAL = 2000;

// 从 sessionStorage 加载状态
function loadFromSession(): { isPolling: boolean; pollInterval: number } {
  if (typeof window === 'undefined') {
    return { isPolling: false, pollInterval: DEFAULT_POLL_INTERVAL };
  }
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        isPolling: parsed.isPolling ?? false,
        pollInterval: parsed.pollInterval ?? DEFAULT_POLL_INTERVAL,
      };
    }
  } catch {
    // ignore
  }
  return { isPolling: false, pollInterval: DEFAULT_POLL_INTERVAL };
}

// 保存状态到 sessionStorage
function saveToSession(state: { isPolling: boolean; pollInterval: number }) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

// 页面加载时自动恢复轮询的标记
let hasAutoStarted = false;

export const useMonitorStore = create<MonitorState>((set, get) => {
  const savedState = loadFromSession();
  
  return {
    // 初始状态 - 从 sessionStorage 加载
    isPolling: savedState.isPolling,
    pollInterval: savedState.pollInterval,
    
    // 私有状态
    isLoading: false,
    error: null,
    lastPollResult: null,
    lastUpdate: null,
    _intervalId: null,

    /**
     * 启动数据轮询
     */
    startPolling: async () => {
      const state = get();
      if (state.isPolling && state._intervalId) return; // 已经在运行
      
      // 获取当前拓扑ID
      const currentTopologyId = useTopologyStore.getState().currentTopologyId;
      
      if (!currentTopologyId) {
        message.error('未选择拓扑，无法启动监控');
        set({ error: '未选择拓扑，无法启动监控', isLoading: false });
        return;
      }
      
      // 从 BMC 会话 Store 获取已连接的 BMC 配置
      const bmcSessionState = useBMCSessionStore.getState();
      const bmcConfig = bmcSessionState.getConnectedConfig();
      
      if (!bmcConfig) {
        message.error('未选择或连接 BMC 会话，无法监控。请先配置并连接 BMC。');
        set({ error: '未连接 BMC 会话，无法监控', isLoading: false });
        return;
      }
      
      if (!bmcConfig.ip || !bmcConfig.username || !bmcConfig.password) {
        message.error('BMC 配置不完整，请检查 IP、用户名和密码。');
        set({ error: 'BMC 配置不完整', isLoading: false });
        return;
      }
      
      // 清除旧的定时器
      if (state._intervalId) {
        window.clearTimeout(state._intervalId);
      }
      
      // 更新本地状态
      const newState = {
        isPolling: true,
        error: null,
      };
      set(newState);
      
      // 保存到 sessionStorage
      saveToSession({ 
        isPolling: true, 
        pollInterval: state.pollInterval 
      });
      
      // 立即执行一次数据获取
      await get().refreshOnce();
      
      // 设置定时轮询
      const scheduleNextPoll = () => {
        const id = window.setTimeout(async () => {
          if (!get().isPolling) return;
          
          await get().refreshOnce();
          
          // 只有在仍然监控状态下才继续下一轮
          if (get().isPolling) {
            scheduleNextPoll();
          }
        }, state.pollInterval);
        
        set({ _intervalId: id });
      };
      
      scheduleNextPoll();
    },

    /**
     * 停止数据轮询
     */
    stopPolling: async () => {
      const state = get();
      if (!state.isPolling) return;
      
      // 清除定时器
      if (state._intervalId) {
        window.clearTimeout(state._intervalId);
      }
      
      set({
        isPolling: false,
        _intervalId: null,
      });
      
      // 保存到 sessionStorage
      saveToSession({ 
        isPolling: false, 
        pollInterval: state.pollInterval 
      });
    },

    /**
     * 切换监控状态
     */
    togglePolling: async () => {
      const { isPolling } = get();
      if (isPolling) {
        await get().stopPolling();
      } else {
        await get().startPolling();
      }
    },

    /**
     * 单次刷新数据
     */
    refreshOnce: async () => {
      set({ isLoading: true, error: null });
      
      try {
        // 获取当前拓扑ID和已连接的 BMC 配置并传递给后端
        const currentTopologyId = useTopologyStore.getState().currentTopologyId;
        const bmcConfig = useBMCSessionStore.getState().getConnectedConfig();
        const result = await pollAllData(currentTopologyId, bmcConfig);
        
        if (result.success) {
          // 更新主页面拓扑数据
          const topoStore = useTopologyStore.getState();
          topoStore.updateNodes(result.nodes);
          topoStore.updateEdges(result.edges);
          
          // 同时更新分身页面拓扑数据（如果分身页面存在且是同一拓扑）
          const cloneStore = useCloneTopologyStore.getState();
          if (cloneStore.currentTopologyId === currentTopologyId) {
            cloneStore.updateNodes(result.nodes);
            cloneStore.updateEdges(result.edges);
          }
          
          set({
            lastPollResult: result,
            isLoading: false,
            lastUpdate: result.timestamp,
          });
        } else {
          // 处理 BMC 错误
          let errorMsg = result.error || 'Failed to fetch data';
          
          if (result.error === 'BMC_NOT_CONFIGURED') {
            errorMsg = 'BMC 未配置，无法监控';
            // 停止监控
            get().stopPolling();
          } else if (result.error === 'BMC_CONFIG_INCOMPLETE') {
            errorMsg = 'BMC 配置不完整，请检查配置';
            get().stopPolling();
          } else if (result.error === 'BMC_CONNECTION_REFUSED') {
            errorMsg = '无法连接到 BMC，请检查 IP 和端口';
          } else if (result.error === 'BMC_AUTH_FAILED') {
            errorMsg = 'BMC 认证失败，请检查用户名和密码';
            get().stopPolling();
          } else if (result.error === 'BMC_TIMEOUT') {
            errorMsg = '连接 BMC 超时';
          }
          
          set({
            error: errorMsg,
            isLoading: false,
            lastPollResult: result,
          });
        }
      } catch (err) {
        set({
          error: (err as Error).message,
          isLoading: false,
        });
      }
    },

    /**
     * 设置轮询间隔
     */
    setPollInterval: (ms: number) => {
      const { isPolling } = get();
      
      set({ pollInterval: ms });
      
      // 保存到 sessionStorage
      saveToSession({ isPolling, pollInterval: ms });
      
      // 如果正在运行，重启轮询以应用新间隔
      if (isPolling) {
        get().stopPolling().then(() => get().startPolling());
      }
    },
  };
});

// 页面加载时，如果之前开启了监控，自动恢复轮询
if (typeof window !== 'undefined') {
  // 延迟执行，确保 topologyStore 已经加载完成
  setTimeout(() => {
    const store = useMonitorStore.getState();
    if (store.isPolling && !hasAutoStarted) {
      hasAutoStarted = true;
      console.log('[Monitor] Auto-starting polling from sessionStorage');
      store.startPolling();
    }
  }, 500);
}
