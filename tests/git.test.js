"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert"));
const git_js_1 = require("../dist/git.js");
(0, node_test_1.describe)('parseGitRemoteUrl', () => {
    (0, node_test_1.it)('parses HTTPS remote', () => {
        const config = '[remote "origin"]\n\turl = https://github.com/acme/my-repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*';
        assert.strictEqual((0, git_js_1.parseGitRemoteUrl)(config), 'https://github.com/acme/my-repo.git');
    });
    (0, node_test_1.it)('parses SSH remote', () => {
        const config = '[remote "origin"]\n\turl = git@github.com:acme/my-repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*';
        assert.strictEqual((0, git_js_1.parseGitRemoteUrl)(config), 'git@github.com:acme/my-repo.git');
    });
    (0, node_test_1.it)('returns null when no origin', () => {
        const config = '[core]\n\trepositoryformatversion = 0';
        assert.strictEqual((0, git_js_1.parseGitRemoteUrl)(config), null);
    });
});
(0, node_test_1.describe)('normalizeRepoUrl', () => {
    (0, node_test_1.it)('normalizes HTTPS URL', () => {
        const result = (0, git_js_1.normalizeRepoUrl)('https://github.com/acme/my-repo.git');
        assert.deepStrictEqual(result, { url: 'github.com/acme/my-repo', name: 'my-repo' });
    });
    (0, node_test_1.it)('normalizes SSH URL', () => {
        const result = (0, git_js_1.normalizeRepoUrl)('git@github.com:acme/my-repo.git');
        assert.deepStrictEqual(result, { url: 'github.com/acme/my-repo', name: 'my-repo' });
    });
    (0, node_test_1.it)('normalizes HTTP URL from self-hosted GitLab', () => {
        const result = (0, git_js_1.normalizeRepoUrl)('http://gitlab.example.com:8080/team/my-project.git');
        assert.deepStrictEqual(result, { url: 'gitlab.example.com:8080/team/my-project', name: 'my-project' });
    });
    (0, node_test_1.it)('strips trailing slash', () => {
        const result = (0, git_js_1.normalizeRepoUrl)('https://github.com/acme/my-repo/');
        assert.deepStrictEqual(result, { url: 'github.com/acme/my-repo', name: 'my-repo' });
    });
});
