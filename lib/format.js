function formatCount(value) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(Math.round(value));
}

function formatPercent(value) {
  return `${Math.round((Number.isFinite(value) ? value : 0) * 100)}%`;
}

function toolLabel(name) {
  const labels = {
    "claude-code": "Claude Code",
    codex: "Codex",
    gemini: "Gemini",
    openclaw: "OpenClaw",
    opencode: "opencode",
  };
  return labels[name] || name.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toolIcon(name) {
  const icons = {
    "claude-code": "bot",
    codex: "zap",
    gemini: "sparkles",
    openclaw: "terminal",
    opencode: "code-2",
  };
  return icons[name] || "terminal";
}

module.exports = { formatCount, formatPercent, toolLabel, toolIcon };
