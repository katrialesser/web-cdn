/**
 * Created by ThatJoeMoore on 1/25/17.
 */
"use strict";

const constants = require('./constants');
const ghConfig = require('./github-config');

const reqp = ghConfig.request.promise;

const path = require('path');
const fsp = require('fs-extra-p');
const log = require('winston');

log.level = 'debug';

module.exports = {
    commitTo: commitTo,
    getLatestCommit: getLatestCommit,
    getFileContents: getFileContents
};

/**
 * Create a new commit and advance the branch to the given commit
 * @param {!string} owner
 * @param {!string} repo
 * @param {!string} branch
 * @param {!string} fileBase
 * @param {Array.<string|fileInfo>} files
 * @param {!string} message
 * @param {object} options
 * @param {?{name: string, email: string}} options.committer
 * @param {?{name: string, email: string}} options.author
 * @returns {Promise}
 */
function commitTo(owner, repo, branch, fileBase, files, message, options) {
    let commitInfo = getLatestCommit(owner, repo, branch);
    let treeContents = Promise.all(
        files.map(getFileInfo)
    ).then(fileInfos => {
        return Promise.all(fileInfos.map(f => {
            //Upload the blobs
            return uploadBlob(owner, repo, f)
                .then(blobSha => {
                    //Then, return the tree content structure
                    return {
                        path: path.relative(fileBase, f.path),
                        mode: modeFor(f),
                        type: 'blob',
                        sha: blobSha
                    }
                })
        }));
    });

    return Promise.all([commitInfo, treeContents])
        .then(r => {
            let [commit, tree] = r;
            return createTree(owner, repo, commit.tree.sha, tree)
                .then(treeSha => {
                    return createCommit(owner, repo, {
                        message: message,
                        tree: treeSha,
                        parents: [commit.sha],
                        committer: options.committer,
                        author: options.author
                    })
                })
                .then(commitSha => updateRef(owner, repo, 'heads/' + branch, commitSha))
        })
}

function modeFor(fileInfo) {
    if (fileInfo === 'link') {
        return '120000';
    } else {
        return '100644';
    }
}

/**
 *
 * @param {string|fileInfo} pathOrInfo
 * @returns {Promise.<fileInfo>}
 */
function getFileInfo(pathOrInfo) {
    if (typeof pathOrInfo === 'string') {
        let path = pathOrInfo;
        return fsp.lstat(path)
            .then(stats => {
                return {
                    path: path,
                    type: stats.isSymbolicLink() ? 'link' : 'file'
                }
            });
    } else {
        return Promise.resolve(pathOrInfo);
    }
}

/**
 *
 * @param owner
 * @param repo
 * @param head
 * @returns {Promise.<{sha: string, url: string, author: object, committer: object, tree: {url: string, sha: string}}>}
 */
function getLatestCommit(owner, repo, head) {
    return reqp(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${head}`)
        .then(commit => {
            return reqp(commit.object.url);
        });
}

function getFileContents(owner, repo, ref, path) {
    log.debug(`getting contents from Github for ${owner} ${repo} ${path} @${ref}`);
    return reqp(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`)
        .then(result => {
            log.debug('Got file contents');
            return Buffer.from(result.content, result.encoding).toString('utf8');
        });
}

/**
 * @typedef {{path: string, type: string, [contents]: string}} fileInfo
 */
/**
 * @typedef {{path: string, type: string, [contents]: string, blob: ?string}} fileWithBlob
 */

/**
 *
 * @param {string} owner
 * @param {string} repo
 * @param {fileInfo} fileInfo
 * @returns {Promise.<string>}
 */

function uploadBlob(owner, repo, fileInfo) {
    console.log(`uploading blob for ${fileInfo.path}`);
    let content;
    if (fileInfo.contents) {
        content = Promise.resolve(fileInfo.contents);
    } else if (fileInfo.type === 'link') {
        content = fsp.readlink(fileInfo.path);
    } else if (fileInfo.type === 'file') {
        content = fsp.readFile(fileInfo.path);
    }

    return content
        .then(contents => uploadBlobContent(owner, repo, contents));
}

function uploadBlobContent(owner, repo, content) {
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
}

function createTree(owner, repo, base, contents) {
    console.log(`creating tree in ${owner} ${repo} from ${base} with contents:`, contents);
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
}

function createCommit(owner, repo, commit) {
    console.log(`creating commit in ${owner} ${repo}:`, commit);
    return reqp({
        url: `https://api.github.com/repos/${owner}/${repo}/git/commits`,
        method: 'POST',
        body: commit
    }).then(resp => {
        console.log(`created commit ${resp.sha}`);
        return resp.sha;
    });
}

function updateRef(owner, repo, ref, sha) {
    console.log(`updating ref ${ref} in ${owner} ${repo} to ${sha}`)
    return reqp({
        method: 'PATCH',
        url: `https://api.github.com/repos/${owner}/${repo}/git/refs/${ref}`,
        body: {
            sha: sha
        }
    }).then(response => {
        console.log(`updated ref ${ref}`)
    });
}
