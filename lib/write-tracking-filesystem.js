/**
 * Created by ThatJoeMoore on 1/30/17
 */
"use strict";

const fs = require('fs-extra-p');
const klaw = require('klaw');
const path = require('path');

const util = require('./util');

module.exports = class WriteTrackingFilesystem {

    /**
     * @param {string} basePath
     * @returns {Promise.<WriteTrackingFilesystem>}
     */
    static create(basePath) {
        let initialPaths = {};
        return _scan(basePath, basePath, (path, type) => {
            initialPaths[path] = {
                type: type,
                status: 'UNMODIFIED'
            };
        }).then(paths => {
            return new WriteTrackingFilesystem(basePath, paths);
        });
    }

    /**
     * @param {string} basePath
     * @param {*} initialPaths
     * @private
     */
    constructor(basePath, initialPaths) {
        this.base = basePath;
        this.paths = initialPaths;
    }

    emptyDir(dir) {
        return fs.emptyDir(path.join(this.base, dir))
            .then(() => {
                Object.getOwnPropertyNames(this.paths)
                    .filter(f => f.indexOf(dir) === 0)
                    .forEach(f => {
                        this.paths[f].status = 'DELETED';
                    });
            });
    }

    writeFile(file, contents, options) {
        return fs.writeFile(path.join(this.base, file), contents, options)
            .then(() => {
                let record = this.paths[file];
                if (record) {
                    record.status = 'MODIFIED';
                } else {
                    this.paths[file] = {
                        type: 'FILE',
                        status: 'ADDED'
                    };
                }
            });
    }

    writeJson(file, object, options) {
        return fs.writeJson(path.join(this.base, file), object, options)
            .then(() => {
                let record = this.paths[file];
                if (record) {
                    record.status = 'MODIFIED';
                } else {
                    this.paths[file] = {
                        type: 'FILE',
                        status: 'ADDED'
                    };
                }
            });
    }

    ensureSymlink(src, dest) {
        let srcPath = path.join(this.base, src);
        let destPath = path.join(this.base, dest);
        return fs.readFile(srcPath, {encoding: 'utf8'})
            .catch(err => null)
            .then(oldLink => {
                let newValue = path.relative(
                    path.dirname(destPath), srcPath
                );
                let willChange = newValue !== oldLink;
                return fs.ensureSymlink(srcPath, destPath)
                    .then(() => {
                        if (!willChange) return;
                        let entry = this.paths.find(f => f.path === dest);
                        if (entry) {
                            entry.status = 'MODIFIED'
                        } else {
                            this.paths.push({
                                path: dest,
                                type: 'SYMLINK',
                                statue: 'ADDED'
                            });
                        }
                    });
            });
    }

    scan() {
        return new Promise((resolve, reject) => {
            let initialPaths = [];
            klaw(this.base)
                .on('end', () => {
                    resolve(initialPaths)
                })
                .on('error', reject)
                .on('data', item => {
                    let isFile = item.stats.isFile();
                    let isLink = item.stats.isSymbolicLink();
                    if (!isFile && !isLink) {
                        return;
                    }
                    let itemPath = item.path;
                    let relativePath = path.relative(this.base, itemPath);

                    // initialPaths.push({
                    //     path: relativePath,
                    //     type: isFile ? 'FILE' : 'SYMLINK',
                    //     status: 'UNMODIFIED'
                    // });
                });
        });
    }

    copyFromExternal(absoluteSourceGlob, relativeDestDir) {

    }

};

function _scan(basePath, dir, processor) {
    return new Promise((resolve, reject) => {
        let promises = [];
        klaw(dir)
            .on('end', () => {
                resolve(Promise.all(promises));
            })
            .on('error', reject)
            .on('data', item => {
                let isFile = item.stats.isFile();
                let isLink = item.stats.isSymbolicLink();
                if (!isFile && !isLink) {
                    return;
                }
                let type = isFile ? 'FILE' : 'SYMLINK';
                let itemPath = item.path;
                let relativePath = path.relative(basePath, itemPath);

                promises.push(Promise.resolve(processor(relativePath, type)));
            });
    });
}

