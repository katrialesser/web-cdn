/**
 * Created by ThatJoeMoore on 1/20/17.
 */
"use strict";

const util = require('./util');
const constants = require('./constants');
const ghConfig = require('./github-config');
const ghClient = require('./github-client');
const log = require('winston');
const yaml = require('node-yaml');

const req = ghConfig.request.async;
const reqp = ghConfig.request.promise;

const fs = require('fs');
const fsp = require('fs-extra-p');

function ghapi(githubInfo, path) {
    return `https://api.github.com/repos/${githubInfo.owner}/${githubInfo.repo}/${path}`;
}

/**
 * @type SourceFunctions
 */
module.exports = {

    id: constants.SOURCE_KEYS.GITHUB,

    /**
     *
     * @param {string} sourceString
     * @returns {githubInfo}
     */
    parseSourceInfo(sourceString) {
        let [owner, repo] = sourceString.split('/');
        return {
            type: constants.SOURCE_KEYS.GITHUB,
            owner: owner,
            repo: repo
        };
    },

    /**
     * @typedef {{owner: string, repo: string}} githubInfo
     * @augments SourceInfo
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
        return ghClient.downloadTarball(
            ghInfo.owner, ghInfo.repo, ref, dest
        );
    },

    /**
     *
     * @param {githubInfo} ghInfo
     * @param {string} ref
     * @returns {Promise.<RepoConfig>}
     */
    fetchRepoConfig(ghInfo, ref) {
        return ghClient.getFileContents(ghInfo.owner, ghInfo.repo, ref, '.cdn-config.yml')
            .then(yaml.parse)
            .catch(err => {
                log.warn('error getting repo config for', ghInfo, ref, err);
                return null;
            });
    }

};

