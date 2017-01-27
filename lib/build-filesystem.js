/**
 * Created by ThatJoeMoore on 1/25/17.
 */
"use strict";

const fs = require('fs-extra-p');
const path = require('path');
const memfs = require('mem-fs');
const fseditor = require('mem-fs-editor');
const constants = require('./constants');
const ghClient = require('./github-client');
const util = require('./util');

const SCRATCH_DIR_NAME = '.tmp';

const scratchPath = path.join(process.cwd(), SCRATCH_DIR_NAME);
const contentPath = path.join(scratchPath, 'content');
const workPath = path.join(scratchPath, 'work');

/**
 * @typedef {{}} Filesystem
 */

/**
 *
 * @param {CdnConfig} config
 * @return {Promise.<Filesystem>}
 */
module.exports = function buildFilesystem(config) {
    return _createScratch()
        .then(_downloadContent)
        ;

    function _createScratch() {
        return Promise.all(
            [scratchPath, contentPath, workPath]
                .map(fs.emptyDir)
        );
    }

    function _downloadContent() {
        return ghClient.downloadTarball(
            constants.CDN.GITHUB_ORG, constants.CDN.GITHUB_REPO, constants.CDN.CONTENT_BRANCH,
            contentPath
        );
    }

};

