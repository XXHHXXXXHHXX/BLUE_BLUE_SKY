'use client';

/** 通用错误边界：局部渲染崩溃时降级为提示，不拖垮整个页面
 *
 * AI 生成的图表配置/表格数据是外部输入，可能触发第三方组件异常。
 * 用错误边界把影响限制在单个区块内，保证应用整体可继续使用。
 */
import React from 'react';
import { Alert, Button, Space, Typography } from 'antd';

const { Text } = Typography;

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** 降级时展示的标题 */
  title?: string;
  /** 出错时的回调（用于上报/日志） */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.title || '', error, info?.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <Alert
          type="warning"
          showIcon
          title={this.props.title ? `${this.props.title}渲染失败` : '内容渲染失败'}
          description={
            <Space orientation="vertical" size={4} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {this.state.error.message || '未知错误'}
              </Text>
              <Button size="small" onClick={this.reset}>
                重试
              </Button>
            </Space>
          }
        />
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
