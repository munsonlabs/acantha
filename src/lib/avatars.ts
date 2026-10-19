const cache = new Map<string, Promise<string | null>>()

/**
 * A picture for a commit author: GitHub's for its noreply addresses, otherwise Gravatar's, which is sent a SHA-256
 * hash of the email rather than the address. Gravatar answers 404 when there is no picture, so callers fall back.
 */
export function avatarUrl(email: string): Promise<string | null> {
  const key = email.trim().toLowerCase()
  let url = cache.get(key)
  if (!url) cache.set(key, (url = resolve(key)))
  return url
}

async function resolve(email: string): Promise<string | null> {
  if (!email.includes('@')) return null
  const github = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/.exec(email)
  if (github) return github[1] ? `https://avatars.githubusercontent.com/u/${github[1]}?s=64&v=4` : `https://github.com/${github[2]}.png?size=64`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `https://gravatar.com/avatar/${hex}?s=64&d=404`
}
