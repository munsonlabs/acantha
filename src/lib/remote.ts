/** Turns a git remote URL (SSH or HTTPS) into the repository's web address, without any credentials. */
export function webUrl(remote: string | null): string | null {
  if (!remote) return null
  let url = remote.trim().replace(/\.git$/, '')
  const ssh = /^(?:ssh:\/\/)?[\w.-]+@([^:/]+)(?::\d+)?[:/](.+)$/.exec(url)
  if (ssh && !url.startsWith('http')) url = `https://${ssh[1]}/${ssh[2]}`
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    parsed.username = ''
    parsed.password = ''
    parsed.protocol = 'https:'
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

/** A commit's page on GitHub, GitLab or Bitbucket. */
export function commitUrl(remote: string | null, hash: string): string | null {
  const base = webUrl(remote)
  if (!base) return null
  if (base.includes('gitlab')) return `${base}/-/commit/${hash}`
  if (base.includes('bitbucket')) return `${base}/commits/${hash}`
  return `${base}/commit/${hash}`
}
