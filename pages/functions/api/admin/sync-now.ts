/**
 * POST /api/admin/sync-now
 *
 * GitHub Actions の workflow_dispatch を起動して、SF→D1同期を即時実行する。
 * 実際の同期処理は GitHub Actions 側で非同期に走る（2〜3分かかる）。
 *
 * admin のみ。 _middleware.ts で /api/admin/* のロール確認済み。
 */
import { Env, jsonResponse, getUser, logAudit } from '../_lib';

interface ExtEnv extends Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;  // 例: 'takeakiLQ/summit-fy2026'
}

export const onRequestPost: PagesFunction<ExtEnv> = async (context) => {
  const { env } = context;
  const user = getUser(context);

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return jsonResponse({ error: 'GitHub設定が未登録（GITHUB_TOKEN / GITHUB_REPO secret 必要）' }, 500);
  }

  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/sync.yml/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'summit-fy2026-cloudflare-workers',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  if (res.status === 204) {
    await logAudit(env, user.email, 'sync.trigger', 'github-actions', { repo: env.GITHUB_REPO });
    return jsonResponse({
      ok: true,
      message: 'GitHub Actions を起動しました。2〜3分後にダッシュボードに反映されます。',
      runsUrl: `https://github.com/${env.GITHUB_REPO}/actions/workflows/sync.yml`,
    });
  }

  const text = await res.text();
  console.error('GitHub workflow_dispatch failed:', res.status, text);
  return jsonResponse({
    error: 'GitHub API エラー',
    status: res.status,
    detail: text.slice(0, 500),
  }, 500);
};
