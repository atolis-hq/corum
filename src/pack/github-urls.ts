export interface GitHubUrlParts {
  owner: string
  repo: string
  path: string
}

export function parseGitHubUrl(url: string): GitHubUrlParts {
  const u = new URL(url)
  if (u.hostname !== 'github.com') throw new Error(`Not a github.com URL: ${url}`)
  const segments = u.pathname.replace(/^\//, '').split('/').filter(Boolean)
  if (segments.length < 3) throw new Error(`Missing path in GitHub URL: ${url}`)
  const [owner, repo, ...rest] = segments
  return { owner, repo, path: rest.join('/') }
}

export function parseGitHubRepo(repoUrl: string): { owner: string; repo: string } {
  const u = new URL(repoUrl)
  if (u.hostname !== 'github.com') throw new Error(`Not a github.com URL: ${repoUrl}`)
  const segments = u.pathname.replace(/^\//, '').split('/').filter(Boolean)
  if (segments.length < 2) throw new Error(`Missing repository in GitHub URL: ${repoUrl}`)
  const [owner, repo] = segments
  return { owner, repo }
}

export function toRegistryFetchUrl(configUrl: string): string {
  const { owner, repo, path } = parseGitHubUrl(configUrl)
  return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`
}

export function toPackRawBaseUrl(owner: string, repo: string, ref: string, packPath: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${packPath}`
}

export function toTagsApiUrl(owner: string, repo: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/tags?per_page=1`
}
