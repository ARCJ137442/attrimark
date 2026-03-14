interface StatsBarProps {
  stats: {
    totalBlocks: number;
    totalChars: number;
    humanChars: number;
    agentChars: number;
    humanPercent: number;
    agentPercent: number;
    sourceBreakdown: { human: number; agent: number; mixed: number };
  } | null;
  onTogglePanel: () => void;
  showPanel: boolean;
}

export function StatsBar({ stats, onTogglePanel, showPanel }: StatsBarProps) {
  if (!stats) return null;

  return (
    <div className="stats-bar" onClick={onTogglePanel}>
      <div className="stats-bar-inner">
        <div className="stats-progress">
          <div className="progress-human" style={{ width: `${stats.humanPercent}%` }} />
          <div className="progress-agent" style={{ width: `${stats.agentPercent}%` }} />
        </div>
        <div className="stats-text">
          <span>{stats.totalBlocks} blocks</span>
          <span>{stats.totalChars} chars</span>
          <span className="stat-human">H: {stats.humanPercent.toFixed(1)}%</span>
          <span className="stat-agent">A: {stats.agentPercent.toFixed(1)}%</span>
          <span className="stats-toggle">{showPanel ? "▼" : "▲"} Details</span>
        </div>
      </div>
    </div>
  );
}
