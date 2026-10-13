/**
 * 浏览器客户端唯一标识 - 每个浏览器持久化一个稳定 ID，
 * 用于区分不同用户创建的测试任务，避免多人共用同一后台任务导致混乱。
 */
const CLIENT_ID_KEY = 'blue_sky_client_id';

export function getClientId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage 不可用（隐私模式等）时，退回会话级随机 ID
    return `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
