/**
 * Created by ThatJoeMoore on 1/20/17.
 */
"use strict";

const util = require('./util');
const constants = require('./constants');
const ghConfig = require('./github-config');

const req = ghConfig.request.async;
const reqp = ghConfig.request.promise;

const fs = require('fs');
const fsp = require('fs-extra-p');

function ghapi(githubInfo, path) {
    return `https://api.github.com/repos/${githubInfo.owner}/${githubInfo.repo}/${path}`;
}

module.exports = {

    /**
     * @typedef {{owner: string, repo: string}} githubInfo
     */

    /**
     * @typedef {{name: string, ref: string, tarballUrl: string, commitSha: string}} refInfo
     */

    /**
     * @param {!githubInfo} ghInfo
     * @return {Promise.<{tags: refInfo, branches: refInfo}>}
     */
    listRefs(ghInfo) {
        let branches = reqp(ghapi(ghInfo, 'branches'))
            .then(branches =>
                branches.map(each => {
                    let name = each.name;
                    return {
                        name: util.cleanRefName(name),
                        ref: name,
                        tarballUrl: ghapi(ghInfo, `tarball/${name}`),
                        commitSha: each.commit.sha
                    };
                })
            );
        let tags = reqp(ghapi(ghInfo, 'tags'))
            .then(tags =>
                tags.map(each => {
                    return {
                        name: util.cleanRefName(each.name),
                        ref: each.name,
                        tarballUrl: each.tarball_url,
                        commitSha: each.commit.sha
                    };
                })
            );
        return Promise.all([branches, tags])
            .then(results => {
                return {
                    branches: results[0],
                    tags: results[1]
                };
            });
    },

    /**
     * @param {!githubInfo} ghInfo
     * @param {!string} ref
     * @param {!string} dest
     * @returns {Promise}
     */
    downloadTarball(ghInfo, ref, dest) {
        let output = fs.createWriteStream(dest);
        return new Promise((resolve, reject) => {
            req(ghapi(ghInfo, `tarball/${ref}`))
                .on('response', resolve)
                .on('error', reject)
                .pipe(output);
        });
    },

};

