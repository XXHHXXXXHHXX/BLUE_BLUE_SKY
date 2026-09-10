/** BMC 数据获取 Hook - 纯前端方式直接请求 BMC */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useBMCSessionStore } from '../stores/bmcSessionStore';
import type { BMCConfig } from '../types/topology';

export interface BMCDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

export interface UseBMCDataOptions<T = unknown> {
  /** Redfish API 路径，如 /redfish/v1/Chassis/1/Thermal */
  apiPath: string;
  /** 轮询间隔（毫秒），默认 5000 */
  pollInterval?: number;
  /** 是否启用自动轮询 */
  autoPoll?: boolean;
  /** 数据转换函数 */
  transform?: (rawData: unknown) => T;
}

/** 构建 BMC 基础 URL */
export function buildBMCBaseUrl(config: BMCConfig): string {
  return `${config.protocol}://${config.ip}:${config.port || 443}`;
}

/** 构建认证 Header */
export function buildBMCAuthHeaders(config: BMCConfig): HeadersInit {
  return {
    'Authorization': 'Basic ' + btoa(`${config.username}:${config.password}`),
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

/** 发送 BMC 请求 */
export async function fetchBMCData<T>(
  config: BMCConfig,
  apiPath: string
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const baseUrl = buildBMCBaseUrl(config);
    const url = `${baseUrl}${apiPath.startsWith('/') ? apiPath : '/' + apiPath}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: buildBMCAuthHeaders(config),
      mode: 'cors',
      credentials: 'omit',
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, data };
    } else if (response.status === 401) {
      return { success: false, error: '认证失败，请检查用户名和密码' };
    } else {
      return { success: false, error: `请求失败，HTTP ${response.status}` };
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('Failed to fetch')) {
      return { 
        success: false, 
        error: '无法连接到 BMC，请检查网络或 CORS 配置' 
      };
    }
    return { success: false, error: errMsg };
  }
}

/** 使用 BMC 数据 Hook */
export function useBMCData<T = unknown>(options: UseBMCDataOptions): BMCDataState<T> & { refresh: () => void } {
  const { apiPath, pollInterval = 5000, autoPoll = true, transform } = options;
  const bmcConfig = useBMCSessionStore((state) => state.getConnectedConfig());

  const [state, setState] = useState<BMCDataState<T>>({
    data: null,
    loading: false,
    error: null,
    lastUpdated: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!bmcConfig?.enabled || !bmcConfig.ip) {
      setState(prev => ({ ...prev, error: 'BMC 未配置' }));
      return;
    }

    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setState(prev => ({ ...prev, loading: true, error: null }));

    const result = await fetchBMCData<T>(bmcConfig, apiPath);

    if (result.success && result.data) {
      const transformedData = transform ? transform(result.data) : (result.data as T);
      setState({
        data: transformedData as T | null,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      });
    } else {
      setState(prev => ({
        ...prev,
        loading: false,
        error: result.error || '获取数据失败',
      }));
    }
  }, [bmcConfig, apiPath, transform]);

  // 自动轮询
  useEffect(() => {
    if (!autoPoll || !bmcConfig?.enabled) return;

    fetchData();
    const intervalId = setInterval(fetchData, pollInterval);

    return () => {
      clearInterval(intervalId);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [autoPoll, pollInterval, fetchData, bmcConfig?.enabled]);

  return {
    ...state,
    refresh: fetchData,
  };
}

/** 发送 BMC 控制命令 */
export async function sendBMCControlCommand(
  config: BMCConfig,
  apiPath: string,
  method: 'POST' | 'PUT' | 'PATCH' = 'POST',
  body?: unknown
): Promise<{ success: boolean; error?: string }> {
  try {
    const baseUrl = buildBMCBaseUrl(config);
    const url = `${baseUrl}${apiPath.startsWith('/') ? apiPath : '/' + apiPath}`;

    const response = await fetch(url, {
      method,
      headers: buildBMCAuthHeaders(config),
      mode: 'cors',
      credentials: 'omit',
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.ok) {
      return { success: true };
    } else if (response.status === 401) {
      return { success: false, error: '认证失败，请检查用户名和密码' };
    } else {
      return { success: false, error: `控制命令失败，HTTP ${response.status}` };
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errMsg };
  }
}

/** 使用 BMC 控制 Hook */
export function useBMCControl() {
  const bmcConfig = useBMCSessionStore((state) => state.getConnectedConfig());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCommand = useCallback(async (
    apiPath: string,
    method: 'POST' | 'PUT' | 'PATCH' = 'POST',
    body?: unknown
  ) => {
    if (!bmcConfig?.enabled) {
      setError('BMC 未配置');
      return { success: false, error: 'BMC 未配置' };
    }

    setLoading(true);
    setError(null);

    const result = await sendBMCControlCommand(bmcConfig, apiPath, method, body);
    
    setLoading(false);
    if (!result.success) {
      setError(result.error || '发送命令失败');
    }

    return result;
  }, [bmcConfig]);

  return {
    sendCommand,
    loading,
    error,
    bmcEnabled: bmcConfig?.enabled || false,
  };
}
