/**
 * Created by ThatJoeMoore on 1/25/17.
 */
"use strict";

const fs = require('fs-extra-p');
const path = require('path');
const cpx = require('cpx');
const log = require('winston');
const klaw = require('klaw');
const constants = require('./constants');
const ghClient = require('./github-client');
const util = require('./util');
const sources = require('./sources');
const WriteTrackingFilesystem = require('./write-tracking-filesystem');

// const SCRATCH_DIR_NAME = '.tmp';
//
// const scratchPath = path.join(process.cwd(), SCRATCH_DIR_NAME);
// const contentPath = path.join(scratchPath, 'content');
// const workPath = path.join(scratchPath, 'work');

/**
 * @typedef {{}} Filesystem
 * @property {string} path
 */

/**
 *
 * @param {CdnConfig} config
 * @param {string} contentPath
 * @param {string} workPath
 * @return {Promise.<Filesystem>}
 */
module.exports = function buildFilesystem(config, contentPath, workPath) {
    let filesystem;
    return _createScratch()
        .then(_downloadContent)
        .then(_initFilesystem)
        .then(_downloadWorkingFiles)
        .then(_clearDestinations)
        .then(_copyFiles)
        .then(_writeShaFiles)
        .then(_writeAliases)
        .then(() => {
            fs.writeJsonSync('filesystem.json', filesystem.paths);
            return filesystem;
        });

    function promiseNeedingUpdates(func) {
        return config.promiseAllLibVersions((lib, ver) => {
            if (!ver.needsUpdate) return Promise.resolve();
            return func(lib, ver);
        });
    }

    function _createScratch() {
        return fs.emptyDir(contentPath)
            .then(() => fs.emptyDir(workPath));
    }

    function _downloadContent() {
        log.info('-------------- Downloading Current CDN Contents --------------');
        return ghClient.downloadTarball(
            constants.CDN.GITHUB_ORG, constants.CDN.GITHUB_REPO, constants.CDN.CONTENT_BRANCH,
            contentPath
        );
    }

    function _initFilesystem() {
        return WriteTrackingFilesystem.create(contentPath)
            .then(wtf => filesystem = wtf);
    }

    function _downloadWorkingFiles() {
        log.info('-------------- Downloading Library Contents --------------');
        return promiseNeedingUpdates((lib, ver) => {
            log.info(`Downloading contents of ${lib.id}@${ver.ref}`);
            return sources.downloadTarball(lib.sourceInfo, ver.ref, _workDir(lib, ver));
        })
    }

    function _clearDestinations() {
        return promiseNeedingUpdates((lib, ver) =>
            // filesystem.emptyDir(path.join(lib.id, ver.name))
            fs.emptyDir(_contentDir(lib, ver))
        );
    }

    function _copyFiles() {
        log.info('-------------- Copying Library Files --------------');
        return promiseNeedingUpdates((lib, ver) => {
            let workDir = _workDir(lib, ver);
            let contentDir = _contentDir(lib, ver);
            let copyPromises = ver.resources.mappings.map(r => {
                let dest = r.dest ? path.join(contentDir, r.dest) : contentDir;
                log.info(`copying ${r.src} to ${dest}`);
                return new Promise((resolve, reject) => {
                    cpx.copy(path.join(workDir, r.src), dest, err => {
                        if (err) reject(err);
                        else resolve();
                    })
                });
            });
            return Promise.all(copyPromises);
        });
    }

    function _writeShaFiles() {
        log.info('-------------- Writing Library SHA Files --------------');
        return promiseNeedingUpdates((lib, ver) => {
            let contentDir = _contentDir(lib, ver);
            return fs.writeFile(path.join(contentDir, '.git-sha'), ver.commitSha);
        });
    }

    function _writeAliases() {
        log.info('-------------- Creating Library Symlinks --------------');
        return config.promiseAllLibs(lib => {
            let libPath = path.join(contentPath, lib.id);
            let promises = [];
            util.transformObject(lib.aliases, (name, value) => {
                promises.push(fs.ensureSymlink(path.join(libPath, value), path.join(libPath, name)));
            });
            return Promise.all(promises);
        });
    }

    function _workDir(library, version) {
        return path.join(workPath, library.id, version.name);
    }

    function _contentDir(library, version) {
        return path.join(contentPath, library.id, version.name);
    }

};

