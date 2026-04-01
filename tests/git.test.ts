import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { parseGitRemoteUrl, normalizeRepoUrl } from '../dist/git.js';

describe('parseGitRemoteUrl', () => {
  it('parses HTTPS remote', () => {
    const config = '[remote "origin"]\n\turl = https://github.com/acme/my-repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*';
    assert.strictEqual(parseGitRemoteUrl(config), 'https://github.com/acme/my-repo.git');
  });

  it('parses SSH remote', () => {
    const config = '[remote "origin"]\n\turl = git@github.com:acme/my-repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*';
    assert.strictEqual(parseGitRemoteUrl(config), 'git@github.com:acme/my-repo.git');
  });

  it('returns null when no origin', () => {
    const config = '[core]\n\trepositoryformatversion = 0';
    assert.strictEqual(parseGitRemoteUrl(config), null);
  });
});

describe('normalizeRepoUrl', () => {
  it('normalizes HTTPS URL', () => {
    const result = normalizeRepoUrl('https://github.com/acme/my-repo.git');
    assert.deepStrictEqual(result, { url: 'github.com/acme/my-repo', name: 'my-repo' });
  });

  it('normalizes SSH URL', () => {
    const result = normalizeRepoUrl('git@github.com:acme/my-repo.git');
    assert.deepStrictEqual(result, { url: 'github.com/acme/my-repo', name: 'my-repo' });
  });

  it('normalizes HTTP URL from self-hosted GitLab', () => {
    const result = normalizeRepoUrl('http://gitlab.example.com:8080/team/my-project.git');
    assert.deepStrictEqual(result, { url: 'gitlab.example.com:8080/team/my-project', name: 'my-project' });
  });

  it('strips trailing slash', () => {
    const result = normalizeRepoUrl('https://github.com/acme/my-repo/');
    assert.deepStrictEqual(result, { url: 'github.com/acme/my-repo', name: 'my-repo' });
  });
});
