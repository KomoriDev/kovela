-- 私信和补单都是没人盯着的后台路径：出问题时原本只有 attempts 可看。2026-11 那轮
-- 私信整批失败（爱发电开始拒收含尖括号的私信）就是这样查不出原因的，所以把上游的
-- 原话留在行上。
ALTER TABLE outbox ADD COLUMN last_error TEXT;

-- 补单的心跳：最近一次扫描是什么时候、翻了几页、看见多少单、补了几单。
-- 只有一行，id 固定为 1。
CREATE TABLE reconcile_runs (
  id INTEGER PRIMARY KEY CHECK(id=1),
  ran_at INTEGER NOT NULL,
  pages INTEGER NOT NULL,
  seen INTEGER NOT NULL,
  backfilled INTEGER NOT NULL,
  error TEXT NOT NULL DEFAULT ''
);
