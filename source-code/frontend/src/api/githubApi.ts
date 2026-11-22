export interface GitHubRelease {
  id: number
  tag_name: string
  name: string
  body: string
  published_at: string
  html_url: string
  prerelease: boolean
  draft: boolean
}

const MAX_RELEASES = 3

export const GITHUB_RELEASES_URL = 'https://github.com/qiqStrong/Comfy-Nova/releases'
export const GITHUB_REPO_URL = 'https://github.com/qiqStrong/Comfy-Nova'

/**
 * 用随应用分发的 version.json 兜底生成一条更新日志。
 * GitHub API 不可达（国内网络常见）或仓库还没有 Release 时使用。
 */
export async function fetchLocalRelease(): Promise<GitHubRelease | null> {
  const api = (window as { pywebview?: { api?: { get_local_release_info?: () => Promise<{ success: boolean; version?: string; published_at?: string; release_notes?: string }> } } }).pywebview?.api
  if (!api?.get_local_release_info) return null

  try {
    const local = await api.get_local_release_info()
    if (!local?.success || !local.release_notes) return null

    return {
      id: 0,
      tag_name: local.version || '',
      name: local.version || '',
      body: local.release_notes,
      published_at: local.published_at || '',
      html_url: GITHUB_RELEASES_URL,
      prerelease: false,
      draft: false,
    }
  } catch {
    return null
  }
}

/**
 * 读取本项目的更新日志。
 *
 * 数据只来自随包分发的 CHANGELOG.md（后端 get_local_release_info 解析后返回
 * entries）。**不再合并上游 Comfy-Nova 的 GitHub Releases**：那是别人的发布
 * 内容，与本项目的改动无关，混进来会让用户以为这些修复是自己这版做的。
 */
export async function fetchReleases(): Promise<GitHubRelease[]> {
  const api = (window as {
    pywebview?: {
      api?: {
        get_local_release_info?: () => Promise<{
          success: boolean
          version?: string
          published_at?: string
          release_notes?: string
          entries?: { version: string; published_at: string; body: string }[]
        }>
      }
    }
  }).pywebview?.api

  if (!api?.get_local_release_info) return []

  try {
    const local = await api.get_local_release_info()
    if (!local?.success) return []

    // 新接口返回全部版本条目；老实现只给最新一条，这里两者都兼容
    const entries = local.entries?.length
      ? local.entries
      : local.release_notes
        ? [{ version: local.version || '', published_at: local.published_at || '', body: local.release_notes }]
        : []

    return entries.slice(0, MAX_RELEASES).map((entry, index) => ({
      id: index,
      tag_name: entry.version,
      name: entry.version,
      body: entry.body,
      published_at: entry.published_at,
      // 本站没有对应 Release 页面，指向仓库主页而不是 Releases（避免 404）
      html_url: GITHUB_REPO_URL,
      prerelease: false,
      draft: false,
    }))
  } catch {
    return []
  }
}


export function parseReleaseBody(body: string): string[] {
  const lines = body.split('\n')
  const changes: string[] = []
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const change = trimmed.substring(2).trim()
      if (change) {
        changes.push(change)
      }
    }
  }
  
  return changes.slice(0, 5)
}

export function formatReleaseDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
