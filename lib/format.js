function formatCount(value) {
  const n = Math.max(0, value);
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(Math.round(n));
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
