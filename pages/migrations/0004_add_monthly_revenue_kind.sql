-- monthly_revenue に kind カラム追加
-- 突合した deal の kind を引き継いで保存する。これにより summary で ByQ/Qhai 別の月範囲を出せる。
-- 実行: wrangler d1 execute summit-fy2026 --remote --file=./migrations/0004_add_monthly_revenue_kind.sql

ALTER TABLE monthly_revenue ADD COLUMN kind TEXT;
CREATE INDEX IF NOT EXISTS idx_monthly_kind ON monthly_revenue(kind);

-- 既存レコードに kind を埋める（deals テーブルとJOIN）
UPDATE monthly_revenue
SET kind = (SELECT d.kind FROM deals d WHERE d.id = monthly_revenue.deal_id)
WHERE kind IS NULL;

-- それでもNULL（dealが見つからない）の場合は 'Qhai' をデフォルト
UPDATE monthly_revenue SET kind = 'Qhai' WHERE kind IS NULL;
