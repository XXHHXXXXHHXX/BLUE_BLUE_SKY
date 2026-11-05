'use client';

import React from 'react';
import { Tag, Tooltip } from 'antd';
import { scoreEntries } from '../../utils/scoreParsing';

/** 分数配色（按顺序循环） */
const SCORE_COLORS = ['green', 'blue', 'orange', 'purple', 'cyan', 'magenta', 'volcano', 'gold'];

/**
 * 分数展示组件
 *
 * - 无命名分数（旧数据 / run.sh 只输出 {"score": n}）：显示单个加粗数字
 * - 有命名分数：显示「名称: 数值」标签，鼠标悬停可看完整列表
 */
const ScoreDisplay: React.FC<{
  /** 主分数 */
  score: number;
  /** 命名分数 */
  scores?: Record<string, number>;
  /** 紧凑模式：只显示标签，不换行 */
  compact?: boolean;
  /** 失败态（显示"失败"标签） */
  failed?: boolean;
}> = ({ score, scores, compact, failed }) => {
  if (failed) return <Tag color="error">失败</Tag>;

  const entries = scoreEntries(scores);
  if (entries.length === 0) {
    return <span style={{ fontWeight: 'bold', color: '#52c41a' }}>{score}</span>;
  }

  // 多个命名分数：展示标签组；单列宽度有限时用 Tooltip 兜底完整内容
  const tags = entries.map((e, idx) => (
    <Tag key={e.name} color={SCORE_COLORS[idx % SCORE_COLORS.length]} style={{ marginInlineEnd: 4 }}>
      {e.name}: <strong>{e.value}</strong>
    </Tag>
  ));

  if (compact) {
    return (
      <Tooltip
        title={
          <div>
            {entries.map((e) => (
              <div key={e.name}>
                {e.name}: {e.value}
              </div>
            ))}
          </div>
        }
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>{tags}</div>
      </Tooltip>
    );
  }

  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>{tags}</div>;
};

export default ScoreDisplay;
