#!/usr/bin/env node
"use strict";

const proc = require('child_process');
const yaml = require('node-yaml');
const path = require('path');
const fs = require('fs-extra');
const semver = require('semver');
const decompress = require('decompress');
const fetcherDefs = require('./lib/fetchers.js');

const config = yaml.readSync('main-config.yml');

const libs = Object.getOwnPropertyNames(config);

const scratch = path.join(process.cwd(), '.tmp');
const contentScratch = path.join(scratch, 'content');
fs.emptyDirSync(scratch);
if (proc.execSync('git worktree list').indexOf(contentScratch) !== -1) {
    proc.execSync('git worktree prune');
}

const dataSetOps = {};

dataSetOps.forEachLib = function (fun) {
    this.libs.forEach(fun);
};

dataSetOps.mapLibs = function (fun) {
    return this.libs.map(fun);
};

dataSetOps.promiseAllLibs = function (fun) {
    return Promise.all(
        this.mapLibs(lib => {
            return Promise.resolve(fun(lib));
        })
    ).then(() => {
        return this;
    });
};

dataSetOps.forEachLibVersion = function (fun) {
    this.libs.forEach(lib =>
        lib.versions.forEach(ver => fun(lib, ver))
    );
};

dataSetOps.promiseAllLibVersions = function (fun) {
    return this.promiseAllLibs(lib => {
        let vers = lib.versions;
        return Promise.all(
            vers.map(v => Promise.resolve(fun(v, lib)))
        );
    });
};

//The core logic of this build is promise-based.  Each function should take in and resolve the complete data set.
createDataSet()
    .then(populateVersions)
    .then(computeAliases)
    .then(populateConfigs)
    .then(identityPromise(checkoutContent))
    .then(loadContentManifest)
    .then(findNecessaryUpdates)
    .then(applyUpdates)
    .then(ds => {
        // console.log(JSON.stringify(ds, null, 2));
        console.log(ds);
    }, error => {
        console.error(error);
    })
;

function identityPromise(fun) {
    return function (dataSet) {
        return Promise.resolve(fun(dataSet))
            .then(() => dataSet);
    }
}

function createDataSet() {
    let obj = Object.create(dataSetOps, {});
    obj.libs = libs.map(lib => {
        let source = config[lib].source;
        return {
            id: lib,
            source: source,
            versions: [],
            aliases: {},
            contentPath: path.join(contentScratch, lib),
            fetcher: fetcherFor(source)
        };
    });

    return Promise.resolve(obj);
}

function fetcherFor(source) {
    let parts = source.split(':', 2);
    if (parts.length !== 2) {
        throw `Invalid source: ${source}`;
    }
    let sourceType = parts[0];
    let sourceLocation = parts[1];
    switch (sourceType) {
        case 'github':
            return new fetcherDefs.GithubFetcher(sourceLocation);
            break;
        default:
            throw `Unrecognized source type: ${sourceType}`;
    }
}

function populateVersions(dataSet) {
    return dataSet.promiseAllLibs(lib => {
        return lib.fetcher.availableVersions()
            .then(vers => {
                lib.versions = vers;
                lib.versions.forEach(v => v.contentPath = path.join(lib.contentPath, v.name));
            });
    });
}

function populateConfigs(dataSet) {
    return dataSet.promiseAllLibs(lib => {
        return Promise.all(
            lib.versions.map(version => {
                return lib.fetcher.fetchConfig(version.ref)
                    .then(config => {
                        version.config = config;
                    });
            })
        ).then(() => {
            let latest = lib.versions.find(each => each.name === lib.aliases.latest).config;
            lib.display = {
                name: latest.name,
                description: latest.description,
                docs: latest.docs
            };
        });
    });
}

function computeAliases(dataSet) {
    return dataSet.promiseAllLibs(lib => {
        let verNums = lib.versions.map(each => each.name).filter(semver.valid);
        let desired = computeDesiredAliases(verNums);
        lib.aliases = [...desired].reduce((obj, alias) => {
            obj[alias] = semver.maxSatisfying(verNums, alias);
            return obj;
        }, {
            latest: verNums.reduce((max, each) => semver.gt(each, max) ? each : max, "0.0.0")
        });
    });

    function computeDesiredAliases(versionNames) {
        return versionNames.reduce((set, each) => {
            let major = semver.major(each);
            let minor = semver.minor(each);
            set.add(`${major}.x.x`);
            set.add(`${major}.${minor}.x`);
            return set;
        }, new Set());
    }
}

function checkoutContent() {
    return new Promise((resolve, reject) =>
        proc.exec(`git worktree add ${contentScratch} content`, {
            cwd: scratch
        }, (err) => {
            if (err) reject(err);
            else resolve();
        }));
}

function loadContentManifest(dataSet) {
    return new Promise((resolve, reject) => {
        fs.readJson(path.join(contentScratch, 'manifest.json'), (err, manifest) => {
            if (err) reject(err);
            else {
                dataSet.manifest = manifest;
                resolve(dataSet);
            }
        });
    });
}

function findNecessaryUpdates(dataSet) {
    let manifest = dataSet.manifest;
    let manifestLibs = manifest.libraries;
    dataSet.forEachLibVersion((lib, version) => {
        version.needsUpdate = needsUpdate(lib, version);
    });
    return Promise.resolve(dataSet);

    function needsUpdate(lib, version) {
        //First, see if the directories we need are there
        let shaFile = path.join(version.contentPath, '.git-sha');
        if (!fs.existsSync(version.contentPath) || !fs.existsSync(shaFile)) {
            return true;
        }
        //Now, see if the git sha has changed since the last manifest update
        let mLib = manifestLibs[lib.id];
        if (!mLib) {
            return true;
        }
        let mVer = mLib.versions.find(mv => mv.name === version.name);
        if (!mVer) {
            return true;
        }
        if (mVer.git_sha !== version.git_sha) {
            return true;
        }
        let shaFromFile = fs.readFileSync(shaFile, 'utf8');
        if (shaFromFile !== version.git_sha) {
            return true;
        }
        return false;
    }
}

function applyUpdates(dataSet) {
    let updates = [];
    dataSet.forEachLibVersion((lib, version) => {
        if (!version.needsUpdate) return;

        updates.push({
            lib: lib,
            version: version
        });
    });

    let promises = updates.map(u =>
        Promise.resolve(u)
            .then(fetchTarball)
            .then(decompressTarball)
    );

    return Promise.all(promises);
}

function fetchTarball(update) {
    let libPath = path.join(scratch, 'tarballs', update.lib.id);
    update.tarpath = path.join(libPath, update.version.name + '.tgz');

    return new Promise((resolve, reject) => {
        fs.ensureDir(libPath, err => {
            if (err) reject(err);
            else resolve(update.tarpath);
        });
    }).then(() => {
        return update.lib.fetcher.fetchTarball(update.version.tarball, update.tarpath);
    }).then(() => {
        return update;
    });
}

function decompressTarball(update) {
    update.workpath = path.join(scratch, 'work', update.lib.id, update.version.name);

    return new Promise((resolve, reject) => {
        fs.emptyDir(update.workpath, (err) => {
            if (err) reject(err);
            else resolve();
        })
    })
        .then(() => decompress(update.tarpath, update.workpath, {
            map: file => {
                let p = file.path;
                file.path = p.substr(p.indexOf(path.sep));
                return file;
            }
        }))
        // .then(data => console.log(data))
        .then(() => update);
}


