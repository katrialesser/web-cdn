/**
 * Created by ThatJoeMoore on 1/25/17.
 */
"use strict";

const constants = require('./../constants');
const ghConfig = require('./github-config');
const decompress = require('decompress');
const os = require('os');

const reqp = ghConfig.request.promise;
const req = ghConfig.request.async;

const path = require('path');
const fsp = require('fs-extra-p');
const log = require('winston');

const tmpdirPromise = fsp.mkdtemp(path.join(os.tmpdir(), 'github-tarballs'));

log.level = 'debug';

module.exports = {
    addBlob: addBlob,
    getLatestCommit: getLatestCommit,
    getFileContents: getFileContents,
    downloadTarball: downloadTarball,
    getTree: getTree,
    createCommit: createCommit,
    createTree: createTree,
    updateRef: updateRef
};

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
            log.debug('Got file contents', result.headers);
            return Buffer.from(result.content, result.encoding).toString('utf8');
        });
}

/**
 * @typedef {{path: string, type: string, [contents]: string}} fileInfo
 */
/**
 * @typedef {{path: string, type: string, [contents]: string, blob: ?string}} fileWithBlob
 */

const MODE_SYMLINK = '120000';
const MODE_FILE = '100644';

function addBlob(owner, repo, file) {
    console.log(`uploading blob for ${file}`);
    return fsp.lstat(file).then(stats => {
        let read, mode;
        if (stats.isSymbolicLink()) {
            read = fsp.readlink(file);
            mode = MODE_SYMLINK;
        } else {
            read = fsp.readFile(file);
            mode = MODE_FILE;
        }
        return read.then(content =>  uploadBlobContent(owner, repo, content))
            .then(sha => {
                return {sha: sha, mode: mode}
            })
    });
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

function createTree(owner, repo, contents) {
    console.log(`creating tree in ${owner} ${repo} with contents:`, contents);

    return reqp({
        url: `https://api.github.com/repos/${owner}/${repo}/git/trees`,
        method: 'POST',
        body: {
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

function downloadTarball(owner, repo, ref, dest) {
    log.debug(`downloading tarball from ${owner}/${repo} @${ref} to ${dest}`);
    return fsp.emptyDir(dest)
        .then(() => tmpdirPromise)
        .then(tmp => {
            let tar = path.join(tmp, `${owner}_${repo}_${ref}.tgz`);
            log.debug('Downloading to temp file', tar);

            let stream = fsp.createWriteStream(tar);

            return new Promise((resolve, reject) => {
                req(`https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`)
                    .on('error', reject)
                    .pipe(stream);
                stream.on('finish', () => {
                    log.debug('Finished downloading');
                    resolve(tar);
                });
            });
        }).then(tar => {
            return decompress(tar, dest, {
                map: file => {
                    let p = file.path;
                    file.path = p.substr(p.indexOf(path.sep));
                    return file;
                }
            });
        }).then(() => {
            log.debug('finished decompressing to', dest);
            return dest;
        });
}

function getTree(owner, repo, treeSha) {
    return reqp(`https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}`);
}
