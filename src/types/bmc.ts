/** BMC API响应类型定义 */

export interface BMCResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
  error?: string;
}

export interface BMCNodeDataResponse {
  nodeId: string;
  values: Record<string, number>;
}

