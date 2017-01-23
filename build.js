#!/usr/bin/env node
"use strict";

const proc = require('child_process');
const yaml = require('node-yaml');
const path = require('path');
const fsp = require('fs-extra-p');
const fs = require('fs-extra');
const semver = require('semver');
const decompress = require('decompress');
const github = require('./lib/github');
const cpx = require('cpx');
const klaw = require('klaw-sync');
const crypto = require('crypto');
const zlib = require('zlib');
const fetcherDefs = require('./lib/fetchers.js');

const config = yaml.readSync('main-config.yml');

const libs = Object.getOwnPropertyNames(config);

const scratch = path.join(process.cwd(), '.tmp');
const contentScratch = path.join(scratch, 'content');

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
    .then(prepareScratch)
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

    return fsp.readJson('package.json')
        .then(pack => obj.cdnVersion = pack.version)
        .then(() => obj)
        ;
}

function prepareScratch(dataSet) {
    console.log('preparing scratch dir:', scratch);
    return fsp.emptyDir(scratch)
        .then(() => {
            return dataSet;
        });
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
    console.log('populating library versions');
    return dataSet.promiseAllLibs(lib => {
        console.log('fetching versions for', lib.id);
        return lib.fetcher.availableVersions()
            .then(vers => {
                lib.versions = vers;
                lib.versions.forEach(v => v.contentPath = path.join(lib.contentPath, v.name));
            });
    });
}

function populateConfigs(dataSet) {
    return dataSet.promiseAllLibs(lib => {
        console.log(`fetching configs for ${lib.id}`);
        return Promise.all(
            lib.versions.map(version => {
                console.log(`fetching version config for ${version.name}`);
                return lib.fetcher.fetchConfig(version.ref)
                    .then(config => {
                        version.config = config;
                    });
            })
        ).then(() => {
            console.log(`finished fetching configs for ${lib.id}`);
            console.log(`latest version is ${lib.aliases.latest}, using it for global config`);
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
        console.log(`computing aliases for ${lib.id}`);
        let verNums = lib.versions.map(each => each.name).filter(semver.valid);
        let desired = computeDesiredAliases(verNums);
        lib.aliases = [...desired].reduce((obj, alias) => {
            obj[alias] = semver.maxSatisfying(verNums, alias);
            return obj;
        }, {
            latest: verNums.reduce((max, each) => semver.gt(each, max) ? each : max, "0.0.0")
        });
        console.log('computed aliases', lib.aliases);
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
    console.log('Checking out `content` branch');
    let tar = path.join(scratch, 'old-content.tgz');
    return github.getTarball('byuweb', 'web-cdn', 'content', tar)
        .then(() => {
            return untar(tar, contentScratch);
        });
}

function loadContentManifest(dataSet) {
    console.log('Loading content manifest');
    return fsp.readJson(path.join(contentScratch, 'manifest.json'))
        .then((manifest) => {
            console.log('finished reading manifest');
            dataSet.manifest = manifest;
            return dataSet;
        });
}

function findNecessaryUpdates(dataSet) {
    console.log('computing necessary updates');
    let manifest = dataSet.manifest;
    let oldVersion = manifest['$cdn-version'];
    console.log(`old contents were built with ${oldVersion}`);
    //If the CDN software has changed, REBUILD ALL THE THINGS!
    if (manifest['$cdn-version'] !== dataSet.cdnVersion) {
        console.log('old contents were build with an older version; rebuilding everything');
        dataSet.forEachLibVersion((lib, version) => {
            version.needsUpdate = true;
        });
        return Promise.resolve(dataSet);
    }

    let manifestLibs = manifest.libraries;
    dataSet.forEachLibVersion((lib, version) => {
        let update = needsUpdate(lib, version);
        if (update) console.log(`${lib.id} ${version.name} needs an update`);
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
    console.log('Applying Updates');
    let updates = [];
    dataSet.forEachLibVersion((lib, version) => {
        if (!version.needsUpdate) return;
        updates.push({
            lib: lib,
            version: version,
            name: `${lib.id} ${version.name}`
        });
    });

    let getTarballs =
        Promise.all(updates.map(fetchTarball));

    let runUpdates = updates.reduce((p, u) =>
            p.then(() => {
                console.log('=================================');
                console.log(`Starting update of ${u.name}`);
                console.log('=================================');
                return Promise.resolve(u);
            })
                .then(decompressTarball)
                .then(copyFiles)
                .then()
        , getTarballs);

    return runUpdates
        .then(() => dataSet)
        .then(buildManifest);
}

function fetchTarball(update) {
    let libPath = path.join(scratch, 'tarballs', update.lib.id);
    let tarball = update.version.tarball;

    let dest = update.tarpath = path.join(libPath, update.version.name + '.tgz');

    console.log(`downloading ${tarball} to ${dest}`);

    return fsp.ensureDir(libPath).then(() => {
        return update.lib.fetcher.fetchTarball(tarball, dest);
    }).then(() => {
        console.log(`Finished downloading ${tarball}`);
        return update;
    });
}

function decompressTarball(update) {
    let tar = update.tarpath;
    let dest = update.workpath = path.join(scratch, 'work', update.lib.id, update.version.name);

    return untar(tar, dest)
        .then(() => {
            console.log(`finished decompressing ${tar}`);
            return update;
        });
}

function untar(tar, dest) {
    return fsp.emptyDir(dest)
        .then(() => {
            console.log(`decompressing ${tar} to ${dest}`);
            return decompress(tar, dest, {
                map: file => {
                    let p = file.path;
                    file.path = p.substr(p.indexOf(path.sep));
                    return file;
                }
            });
        });
}

function copyFiles(update) {
    let base = update.version.contentPath;
    console.log(`copying files for ${update.lib.id} ${update.version.name} to ${base}`)
    return fsp.emptyDir(base)
        .then(() => {
            return Promise.all(
                update.version.config.resourceMappings.map(r => {
                    let dest = r.dest ? path.join(base, r.dest) : base;
                    console.log(`copying ${r.src} to ${dest}`);
                    return new Promise((resolve, reject) => {
                        cpx.copy(path.join(update.workpath, r.src), dest, err => {
                            if (err) reject(err);
                            else resolve();
                        })
                    });
                })
            );
        })
        .then(() => {
            let sha = update.version.git_sha;
            console.log(`writing .git-sha for ${update.name} (${sha})`);
            return fsp.writeFile(path.join(base, '.git-sha'), sha);
        })
        .then(() => update)
        ;
}

function buildManifest(dataSet) {
    let manifest = {
        '$cdn-version': dataSet.cdnVersion,
        '$built': new Date().toISOString(),
        libraries: dataSet.libs.reduce((result, lib) => {
            let l = result[lib.id] = {
                name: lib.display.name,
                description: lib.display.description,
                docs_url: lib.display.docs,
                source: lib.source
            };
            l.aliases = lib.aliases;

            l.versions = lib.versions.map(version => {
                let v = {
                    name: version.name,
                    ref: version.ref,
                    tarball: version.tarball,
                    git_sha: version.git_sha,
                    link: lib.fetcher.viewRefUrl(version.ref)
                };
                let resources = klaw(version.contentPath, {
                    ignore: '.git-sha'
                }).filter(f => f.stats.isFile());

                v.resources = resources.reduce((res, f) => {
                    let p = path.relative(version.contentPath, f.path);
                    let ep = version.config.entrypoints[p];
                    res[p] = {
                        entrypoint: !!ep,
                        description: ep,
                        size: f.stats.size,
                        gzipped_size: zlib.gzipSync(fs.readFileSync(f.path)).length
                    };
                    return res;
                }, {});
                return v;
            });

            return result;
        }, {})
    };

    dataSet.newManifest = manifest;
    console.log('writing new manifest');
    return fsp.writeJson(path.join(contentScratch, 'manifest.json'),
        manifest
    ).then(() => dataSet);
}
