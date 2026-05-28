-- 初期マスタデータ投入: teams 4個 + members 20名
-- 管理者: takeaki.mandokoro@logiquest.co.jp に admin ロール付与
-- 実行: wrangler d1 execute summit-fy2026 --remote --file=./migrations/0002_initial_master_data.sql

-- チーム
INSERT INTO teams (id, name, color, sort_order, active) VALUES
  ('T1', '富士', '#FFB3B3', 1, 1),
  ('T2', '立山', '#A5D8FF', 2, 1),
  ('T3', '剱',   '#B2F2BB', 3, 1),
  ('T4', '白山', '#FFD8A8', 4, 1)
ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, sort_order=excluded.sort_order;

-- メンバー（20名）
INSERT INTO members (email, name, team, role, active) VALUES
  -- T1 富士
  ('koji.imai@logiquest.co.jp',        '今井 浩二',  'T1', 'member', 1),
  ('toshiyuki.nii@logiquest.co.jp',    '新居 寿幸',  'T1', 'member', 1),
  ('yuki.matsumura@logiquest.co.jp',   '松村 優樹',  'T1', 'member', 1),
  ('hiroyuki.okita@logiquest.co.jp',   '沖田 博之',  'T1', 'member', 1),
  ('kenji.kita@logiquest.co.jp',       '北 憲治',    'T1', 'member', 1),
  -- T2 立山
  ('yoshiki.tanigawa@logiquest.co.jp', '谷川 義喜',  'T2', 'member', 1),
  ('kei.iwao@logiquest.co.jp',         '岩尾 慶',    'T2', 'member', 1),
  ('ryoji.hanyu@logiquest.co.jp',      '羽生 良二',  'T2', 'member', 1),
  ('yuta.yamada@logiquest.co.jp',      '山田 裕太',  'T2', 'member', 1),
  ('ryusei.kakinuma@logiquest.co.jp',  '柿沼 龍征',  'T2', 'member', 1),
  -- T3 剱
  ('kensuke.honda@logiquest.co.jp',    '本多 健裕',  'T3', 'member', 1),
  ('mahiro.yamada@logiquest.co.jp',    '山田 真大',  'T3', 'member', 1),
  ('satoshi.tamura@logiquest.co.jp',   '田村 憲',    'T3', 'member', 1),
  ('kazushi.okumura@logiquest.co.jp',  '奥村 一志',  'T3', 'member', 1),
  ('daisuke.ogasawara@logiquest.co.jp','小笠原 大翼','T3', 'member', 1),
  -- T4 白山
  ('akihito.yoko@logiquest.co.jp',     '横尾 明仁',  'T4', 'member', 1),
  ('takuma.wakida@logiquest.co.jp',    '脇田 拓馬',  'T4', 'member', 1),
  ('taisuke.yoshino@logiquest.co.jp',  '𠮷野 泰祐',  'T4', 'member', 1),
  ('keisuke.shimizu@logiquest.co.jp',  '清水 啓介',  'T4', 'member', 1),
  ('naoya.mimoto@logiquest.co.jp',     '見本 直弥',  'T4', 'member', 1),
  -- 管理者（武明さん。T1所属 + admin ロール）
  ('takeaki.mandokoro@logiquest.co.jp','武明',        'T1', 'admin',  1)
ON CONFLICT(email) DO UPDATE SET name=excluded.name, team=excluded.team, role=excluded.role, active=excluded.active;

-- 設定（KPI閾値・係数）
INSERT INTO settings (key, value) VALUES (
  'kpi',
  '{"msPoints":{"main":1,"sub":0.5},"hourlyCoefThresholds":[{"min":4000,"coef":2,"label":"4000円以上"},{"min":3000,"coef":1.5,"label":"3000円以上4000円未満"},{"min":0,"coef":1,"label":"3000円未満"}],"issueRules":{"missingDailyHours":true,"missingMonthlyWorkdays":true,"missingMonthlyRevenue":true,"zeroDivisor":true,"extremeHourlyRateAbove":100000,"extremeHourlyRateBelow":100}}'
) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
