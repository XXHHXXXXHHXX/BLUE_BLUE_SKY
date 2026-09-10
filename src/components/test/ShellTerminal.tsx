'use client';

import React, { useRef, useEffect, useMemo } from 'react';
import { Button, Space, Tooltip } from 'antd';
import { 
  DeleteOutlined, 
  CopyOutlined, 
  CloseOutlined, 
  CodeOutlined,
  ExpandAltOutlined,
  BellOutlined,
  BellFilled,
} from '@ant-design/icons';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useTestStore, type TestTab } from '../../stores/testStore';
import '@xterm/xterm/css/xterm.css';

interface ShellTerminalProps {
  tab: TestTab;
  isVisible: boolean;
  onToggle: () => void;
  externalShellOutput?: string[];
  externalMuteMonitorOutput?: boolean;
}

const ShellTerminal: React.FC<ShellTerminalProps> = ({ tab, isVisible, onToggle, externalShellOutput, externalMuteMonitorOutput }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const prevOutputRef = useRef<string[]>([]);

  const { clearShellOutput, setMuteMonitorOutput } = useTestStore();
  
  // 优先使用外部传入的 shellOutput，否则从 store 订阅
  const storeTab = useTestStore((state) => state.tabs.find((t) => t.id === tab.id));
  const shellOutput = useMemo(() => externalShellOutput ?? storeTab?.shellOutput ?? [], [storeTab, externalShellOutput]);
  const muteMonitorOutput = useMemo(() => externalMuteMonitorOutput ?? storeTab?.muteMonitorOutput ?? false, [storeTab, externalMuteMonitorOutput]);

  // 初始化终端
  useEffect(() => {
    if (!terminalRef.current || !isVisible) return;

    // 如果终端实例已存在（比如 tab.id 变化但组件未卸载），先清理旧实例
    if (termInstance.current) {
      termInstance.current.dispose();
      termInstance.current = null;
      fitAddon.current = null;
    }

    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
      },
      cursorStyle: 'block',
      cursorBlink: true,
      scrollback: 10000,
      wordSeparator: ' ',
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    
    term.open(terminalRef.current);
    fit.fit();
    
    // 写入欢迎信息
    term.writeln(`\x1b[32m=== Shell终端 [${tab.name}] ===\x1b[0m`);
    term.writeln(`\x1b[90m主机: ${tab.sshConfig.host || '未配置'}\x1b[0m`);
    term.writeln('');

    // 写入已有的输出（初始化时从 store 读取，避免依赖 shellOutput 导致频繁重建终端）
    const initialOutput = useTestStore.getState().tabs.find((t) => t.id === tab.id)?.shellOutput ?? [];
    initialOutput.forEach(line => {
      term.writeln(line);
    });
    prevOutputRef.current = initialOutput;

    termInstance.current = term;
    fitAddon.current = fit;

    // 窗口大小变化时自适应
    const handleResize = () => {
      fitAddon.current?.fit();
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      termInstance.current = null;
      fitAddon.current = null;
    };
  }, [isVisible, tab.id, tab.name, tab.sshConfig.host]);

  // 同步shell输出到终端（支持输出被截断、清空、追加等场景）
  useEffect(() => {
    if (!termInstance.current || !isVisible) return;

    const term = termInstance.current;
    const prev = prevOutputRef.current;
    const curr = shellOutput;

    if (curr.length === 0) {
      if (prev.length > 0) {
        term.clear();
        prevOutputRef.current = [];
      }
      return;
    }

    if (curr.length > prev.length) {
      // 普通追加
      for (let i = prev.length; i < curr.length; i++) {
        term.writeln(curr[i]);
      }
    } else if (curr.length < prev.length) {
      // 输出被整体截短，清空后重写
      term.clear();
      for (const line of curr) {
        term.writeln(line);
      }
    } else {
      // 长度相同但内容可能被替换（如达到上限后旧行被移除、新行追加）
      let suffixLen = 0;
      const maxCheck = Math.min(prev.length, curr.length);
      while (
        suffixLen < maxCheck &&
        curr[curr.length - 1 - suffixLen] === prev[prev.length - 1 - suffixLen]
      ) {
        suffixLen++;
      }
      if (suffixLen < curr.length) {
        for (let i = curr.length - suffixLen; i < curr.length; i++) {
          term.writeln(curr[i]);
        }
      }
    }

    term.scrollToBottom();
    prevOutputRef.current = curr;
  }, [shellOutput, isVisible]);

  const handleClear = () => {
    clearShellOutput(tab.id);
    if (termInstance.current) {
      termInstance.current.clear();
      termInstance.current.writeln(`\x1b[32m=== 终端已清空 [${tab.name}] ===\x1b[0m`);
    }
    prevOutputRef.current = [];
  };

  const handleCopy = () => {
    const text = shellOutput.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      // 可以添加提示
    });
  };

  if (!isVisible) {
    return (
      <div 
        style={{ 
          width: 40, 
          height: '100%',
          background: '#f5f5f5',
          borderLeft: '1px solid #d9d9d9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Tooltip title="显示Shell终端">
          <Button 
            type="primary"
            icon={<ExpandAltOutlined />}
            onClick={onToggle}
            style={{ 
              writingMode: 'vertical-rl',
              height: 120,
            }}
          >
            Shell终端
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div 
      style={{ 
        width: 450, 
        height: '100%',
        background: '#1e1e1e',
        borderLeft: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 工具栏 */}
      <div 
        style={{ 
          height: 40,
          background: '#2d2d2d',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
        }}
      >
        <Space>
          <CodeOutlined style={{ color: '#fff' }} />
          <span style={{ color: '#fff', fontSize: 13 }}>Shell终端</span>
          <span style={{ color: '#888', fontSize: 11 }}>({tab.name})</span>
        </Space>
        <Space>
          <Tooltip title={muteMonitorOutput ? '已屏蔽监控输出' : '屏蔽监控输出'}>
            <Button 
              type="text" 
              size="small" 
              icon={muteMonitorOutput ? <BellFilled /> : <BellOutlined />}
              onClick={() => setMuteMonitorOutput(tab.id, !muteMonitorOutput)}
              style={{ color: muteMonitorOutput ? '#faad14' : '#ccc' }}
            />
          </Tooltip>
          <Tooltip title="复制全部输出">
            <Button 
              type="text" 
              size="small" 
              icon={<CopyOutlined />}
              onClick={handleCopy}
              style={{ color: '#ccc' }}
            />
          </Tooltip>
          <Tooltip title="清空终端">
            <Button 
              type="text" 
              size="small" 
              icon={<DeleteOutlined />}
              onClick={handleClear}
              style={{ color: '#ccc' }}
            />
          </Tooltip>
          <Tooltip title="隐藏终端">
            <Button 
              type="text" 
              size="small" 
              icon={<CloseOutlined />}
              onClick={onToggle}
              style={{ color: '#ccc' }}
            />
          </Tooltip>
        </Space>
      </div>

      {/* 终端区域 */}
      <div 
        ref={terminalRef} 
        style={{ 
          flex: 1,
          padding: 8,
          overflow: 'hidden',
        }} 
      />
    </div>
  );
};

export default ShellTerminal;
