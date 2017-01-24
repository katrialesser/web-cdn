/**
 * Created by jmooreoa on 1/20/17.
 */
"use strict";

const headers = {
    'User-Agent': 'BYU-Web-Community-CDN 1.0.0-dev'
};

if (process.env.GITHUB_USER && process.env.GITHUB_TOKEN) {
    headers['Authorization'] = 'Basic ' + Buffer.from(process.env.GITHUB_USER + ':' + process.env.GITHUB_TOKEN).toString('base64');
}

const req = require('request').defaults({
    headers: headers,
    json: true
});
const reqp = require('request-promise-native').defaults({
    headers: headers,
    json: true
});

const fs = require('fs');
const fsp = require('fs-extra-p');

module.exports = {
    getTarball(owner, repo, ref, dest) {
        let output = fs.createWriteStream(dest);
        return new Promise((resolve, reject) => {
            req(`https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`)
                .on('response', resolve)
                .on('error', reject)
                .pipe(output);
        })
    },

    getLatestCommit(owner, repo, head) {
        return reqp(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${head}`)
            .then(commit => {
                return reqp(commit.object.url);
            });
    },

    uploadBlob(owner, repo, file) {
        return fsp.readFile(file)
            .then(buffer => this.uploadBlobContent(owner, repo, buffer));
    },

    uploadBlobContent(owner, repo, content) {
        let b64 = Buffer.from(content).toString('base64');
        let body = {
            content: b64,
            encoding: 'base64'
        };
        return reqp({
            url: `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
            method: 'POST',
            body: body
        }).then(resp => {
            return resp.sha;
        });
    },

    createTree(owner, repo, base, contents) {
        return reqp({
            url: `https://api.github.com/repos/${owner}/${repo}/git/trees`,
            method: 'POST',
            body: {
                base_tree: base,
                tree: contents
            }
        }).then(resp => {
            return resp.sha;
        });
    },

    createCommit(owner, repo, commit) {
        return reqp({
            url: `https://api.github.com/repos/${owner}/${repo}/git/commits`,
            method: 'POST',
            body: commit
        }).then(resp => {
            return resp.sha;
        });
    },

    updateRef(owner, repo, ref, sha) {
        return reqp({
            method: 'PATCH',
            url: `https://api.github.com/repos/${owner}/${repo}/git/refs/${ref}`,
            body: {
                sha: sha
            }
        });
    }
};

