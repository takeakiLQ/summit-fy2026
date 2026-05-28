-- 案件種別（kind）カラムを追加
--   'ByQ'  = Salesforceの Group_FY22__c が '都市物流営業部（緊急便）'
--   'Qhai' = それ以外（既存案件のデフォルト）
-- 実行: wrangler d1 execute summit-fy2026 --remote --file=./migrations/0003_add_deal_kind.sql

ALTER TABLE deals ADD COLUMN kind TEXT;
CREATE INDEX IF NOT EXISTS idx_deals_kind ON deals(kind);

-- 既存案件は当面 Qhai 扱い（次回SF同期で Group_FY22__c に基づき正しく上書きされる）
UPDATE deals SET kind = 'Qhai' WHERE kind IS NULL;
