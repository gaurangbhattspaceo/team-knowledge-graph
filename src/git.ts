import * as fs from 'fs';
import * as path from 'path';

export interface RepoInfo {
  url: string;
  name: string;
}

export function parseGitRemoteUrl(configContent: string): string | null {
  const lines = configContent.split('\n');
  let inOrigin = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '[remote "origin"]') {
      inOrigin = true;
      continue;
    }
    if (trimmed.startsWith('[') && inOrigin) break;
    if (inOrigin && trimmed.startsWith('url = ')) {
      return trimmed.slice(6).trim();
    }
  }
  return null;
}

export function normalizeRepoUrl(rawUrl: string): RepoInfo {
  let url = rawUrl.trim();
  url = url.replace(/^https?:\/\//, '');
  url = url.replace(/^git@/, '');
  // Convert SSH host:path to host/path, but only when the colon separates a path (not a port number)
  url = url.replace(/^([^/:]+):(?!\d+\/)/, '$1/');
  url = url.replace(/\.git\/?$/, '');
  url = url.replace(/\/$/, '');
  const name = url.split('/').pop() || url;
  return { url, name };
}

export function detectRepo(cwd: string): RepoInfo | null {
  try {
    let dir = cwd;
    while (dir !== path.dirname(dir)) {
      const gitConfig = path.join(dir, '.git', 'config');
      if (fs.existsSync(gitConfig)) {
        const content = fs.readFileSync(gitConfig, 'utf-8');
        const remoteUrl = parseGitRemoteUrl(content);
        if (remoteUrl) {
          return normalizeRepoUrl(remoteUrl);
        }
        return { url: `local/${path.basename(dir)}`, name: path.basename(dir) };
      }
      dir = path.dirname(dir);
    }
  } catch { /* silently fail */ }
  return null;
}
