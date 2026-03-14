interface StatsPanelProps {
  stats: {
    totalBlocks: number;
    totalChars: number;
    humanChars: number;
    agentChars: number;
    humanPercent: number;
    agentPercent: number;
    sourceBreakdown: { human: number; agent: number; mixed: number };
    timeline: { timestamp: string; humanChars: number; agentChars: number }[];
  };
}

export function StatsPanel({ stats }: StatsPanelProps) {
  const maxChars = Math.max(
    ...stats.timeline.map((t) => t.humanChars + t.agentChars),
    1
  );

  return (
    <div className="stats-panel">
      <h3>文档统计</h3>

      <div className="stats-grid">
        <div className="stat-box">
          <div className="stat-value">{stats.totalBlocks}</div>
          <div className="stat-label">段落</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{stats.totalChars}</div>
          <div className="stat-label">总字符</div>
        </div>
        <div className="stat-box stat-box-human">
          <div className="stat-value">{stats.humanChars}</div>
          <div className="stat-label">Human ({stats.humanPercent.toFixed(1)}%)</div>
        </div>
        <div className="stat-box stat-box-agent">
          <div className="stat-value">{stats.agentChars}</div>
          <div className="stat-label">Agent ({stats.agentPercent.toFixed(1)}%)</div>
        </div>
      </div>

      <div className="stats-breakdown">
        <h4>段落来源分布</h4>
        <div className="breakdown-row">
          <span className="source-badge source-human">● human</span>
          <span>{stats.sourceBreakdown.human} blocks</span>
        </div>
        <div className="breakdown-row">
          <span className="source-badge source-agent">◆ agent</span>
          <span>{stats.sourceBreakdown.agent} blocks</span>
        </div>
        <div className="breakdown-row">
          <span className="source-badge source-mixed">◇ mixed</span>
          <span>{stats.sourceBreakdown.mixed} blocks</span>
        </div>
      </div>

      {stats.timeline.length > 0 && (
        <div className="stats-timeline">
          <h4>编辑趋势</h4>
          <div className="timeline-chart">
            {stats.timeline.slice(-20).map((point, i) => (
              <div key={i} className="timeline-bar" title={point.timestamp}>
                <div
                  className="bar-human"
                  style={{ height: `${(point.humanChars / maxChars) * 100}%` }}
                />
                <div
                  className="bar-agent"
                  style={{ height: `${(point.agentChars / maxChars) * 100}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
