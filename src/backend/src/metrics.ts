const counters = {
  uploadsStarted: 0,
  uploadsSucceeded: 0,
  uploadsFailed: 0,
  rowsIngested: 0,
  rowsFailed: 0,
};

export const metrics = {
  increment(key: keyof typeof counters, by = 1) {
    counters[key] += by;
  },
  snapshot() {
    return { ...counters, uptimeSeconds: Math.round(process.uptime()) };
  },
};
