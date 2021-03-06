/**
 * Created by ThatJoeMoore on 1/24/17
 */
"use strict";

const sources = require('./sources');
const constants = require('./constants');
const githubApi = require('./github/github-client');
const util = require('./util');
const semver = require('semver');
const log = require('winston');

const package_json = require('./../package.json');

const cdnVersion = package_json.version;

/**
 * @typedef {{}} Version
 * @property {!string} name
 * @property {!string} ref
 * @property {!string} tarballUrl
 * @property {!boolean} inManifest
 * @property {?string} manifestSha
 * @property {!string} commitSha
 * @property {?string} link
 * @property {?Object} resources
 * @property {Object.<string, string>} resources.entrypoints
 * @property {ResourceMapping[]} resources.mappings
 * @property {!boolean} needsUpdate
 * @property {!boolean} ignored - 'ignored' means that the version/ref doesn't belong in the CDN
 * @property {?string} reasonIgnored
 * @property {!boolean} skipped - 'skipped' means that the version/ref is in the CDN, but we can't update it right now
 * @property {?string} reasonSkipped
 */

/**
 * @typedef {{}} ResourceMapping
 * @property {!string} src
 * @property {?string} dest
 */

/**
 * @typedef {{}} Library
 * @property {string} id
 * @property {object} sourceInfo
 * @property {Version[]} versions
 * @property {object.<string, string>} aliases
 * @property {object} display
 * @property {string} display.name
 * @property {string} display.description
 * @property {string} display.docs
 */

/**
 * @typedef {{}} ContentInfo
 * @property {string} commitSha
 * @property {string} treeSha
 * @property {Manifest} manifest
 */

/**
 *
 */
class CdnConfig {

    /**
     * @param {Object.<string, {source: string}>} libsToSources
     * @returns {Promise.<CdnConfig>}
     */
    static loadFromConfig(libsToSources) {
        log.info('Building configuration from', libsToSources);
        let libIds = Object.getOwnPropertyNames(libsToSources);
        return githubApi.getFileContents(
            constants.CDN.GITHUB_ORG, constants.CDN.GITHUB_REPO, constants.CDN.CONTENT_BRANCH,
            "manifest.json"
        ).then(manifestString => {
            let manifest = JSON.parse(manifestString);
            let manifestVersion = manifest['$cdn-version'];
            log.debug(`successfully loaded content manifest built ${manifest['$built']} by v${manifestVersion}`);

            let forceReload = manifestVersion !== cdnVersion;

            let libsPromise = Promise.all(libIds.map(libId => {
                let sourceString = libsToSources[libId].source;
                return CdnConfig.createLib(libId, sourceString, manifest.libraries[libId], forceReload);
            }));

            let contentCommitPromise = githubApi.getLatestCommit(
                constants.CDN.GITHUB_ORG, constants.CDN.GITHUB_REPO, constants.CDN.CONTENT_BRANCH
            );

            return Promise.all([libsPromise, contentCommitPromise])
                .then(results => {
                    let [libs, contentCommit] = results;
                    return new CdnConfig(
                        libs, {
                            commitSha: contentCommit.sha,
                            treeSha: contentCommit.tree.sha,
                            manifest: manifest
                        }
                    );
                });
        });
    }

    /**
     *
     * @param {Library[]} libs
     * @param {ContentInfo} contentInfo
     */
    constructor(libs, contentInfo) {
        /**
         * @type {string}
         */
        this.cdnVersion = cdnVersion;

        /**
         * @type {Library[]}
         */
        this.libs = libs;

        /**
         * @type {ContentInfo}
         */
        this.contentInfo = contentInfo;
    }

    /**
     * @callback libCallback
     * @param {Library} lib
     * @return {*}
     */

    /**
     *
     * @param {libCallback} fun
     */
    forEachLib(fun) {
        this.libs.forEach(fun);
    }

    /**
     *
     * @param {libCallback} fun
     * @returns {Array|*|{}}
     */
    mapLibs(fun) {
        return this.libs.map(fun);
    }

    /**
     *
     * @param {libCallback} fun
     * @returns {Promise.<CdnConfig>}
     */
    promiseAllLibs(fun) {
        let result = {};
        return Promise.all(
            this.mapLibs(lib => {
                return Promise.resolve(fun(lib))
                    .then(r => result[lib.id] = r);
            })
        ).then(() => result);
    }

    /**
     * @callback libVerCallback
     * @param {Library} lib
     * @param {Version} version
     */

    /**
     * @param {libVerCallback} fun
     */
    forEachLibVersion(fun) {
        this.libs.forEach(lib => {
            lib.versions.forEach(v => fun(lib, v));
        });
    }

    asLibVersions() {
        let values = [];
        this.forEachLibVersion((lib, ver) => values.push({lib: lib, version: ver}));
        return values;
    }

    /**
     * @param {libVerCallback} fun
     */
    promiseAllLibVersions(fun) {
        return this.promiseAllLibs(lib => {
            let result = {};
            return Promise.all(
                lib.versions.map(v => Promise.resolve(fun(lib, v))
                    .then(r => result[v.name] = r))
            ).then(() => result);
        })
    }

    /**
     * Create a library object
     * @param {string} id
     * @param {string} sourceString
     * @param {?ManifestLib} manifestLib
     * @param {boolean} forceReload
     * @returns {Promise.<Library>}
     */
    static createLib(id, sourceString, manifestLib, forceReload) {
        let si = sources.parseSourceInfo(sourceString);
        return sources.listRefs(si)
            .then((result) => {
                let {tags, branches} = result;
                return _refsToVersions(tags, branches, forceReload);
            })
            .then(versions => {
                let aliases = CdnConfig.computeAliasesForVersions(versions);

                return _getLatestLibConfig(versions, aliases)
                    .then(cfg => {
                        if (cfg) {
                            return cfg;
                        } else {
                            return {
                                name: manifestLib.name,
                                description: manifestLib.description,
                                docs: manifestLib.docs_url
                            };
                        }
                    }).then(cfg => {
                        return {
                            id: id,
                            sourceInfo: si,
                            versions: versions,
                            aliases: aliases,
                            display: {
                                name: cfg.name,
                                description: cfg.description,
                                docs: cfg.docs
                            }
                        }
                    });
            });


        function _versionFromRef(ref, name) {
            let realName = name || ref.name;
            let manifestVersion = manifestLib ? manifestLib.versions.find(v => v.name === realName) : null;

            let repoConfigPromise = sources.fetchRepoConfig(si, ref.ref)
                .catch(err => null);
            let contentShaPromise = githubApi.getFileContents(
                constants.CDN.GITHUB_ORG, constants.CDN.GITHUB_REPO, constants.CDN.CONTENT_BRANCH,
                `${id}/${realName}/.git-sha`
            ).catch(() => null);

            return Promise.all([repoConfigPromise, contentShaPromise])
                .then(results => {
                    let [repoConfig, contentSha] = results;

                    return CdnConfig.createLibVersion(
                        realName, ref, manifestVersion, repoConfig, contentSha, forceReload
                    );
                });
        }

        function _refsToVersions(tags, branches) {
            let versions = tags.map(t => _versionFromRef(t));

            //We currently only support the master branch - change this later?
            let master = branches.find(b => b.ref === 'master');
            if (master) {
                versions.push(_versionFromRef(master, constants.VERSION_ALIASES.MASTER));
            }
            return Promise.all(versions);
        }

        function _getLatestLibConfig(versions, aliases) {
            let refToFind;
            if (aliases.latest) {
                let ver = versions.find(v => v.name === aliases.latest);
                refToFind = ver.ref;
            }
            if (!refToFind) {
                refToFind = 'master';
            }
            return sources.fetchRepoConfig(si, refToFind)
                .catch(err => {
                    log.warn('Error getting repo config', err);
                    return null;
                });
        }

    }

    /**
     * Create a version for a lib
     * @param {string} name
     * @param {refInfo} ref
     * @param {?ManifestVersion} manifestVersion
     * @param {?RepoConfig} repoConfig
     * @param {?string} contentSha
     * @param {boolean} forceReload
     * @returns {Version}
     */
    static createLibVersion(name, ref, manifestVersion, repoConfig, contentSha, forceReload) {
        let entrypoints;
        let reasonIgnored = null;
        let reasonSkipped = null;
        if (repoConfig) {
            entrypoints = repoConfig.entrypoints;
        } else if (manifestVersion) {
            entrypoints = util.objectAsArray(manifestVersion.resources).reduce((result, pair) => {
                let {path, value} = pair;
                if (value.entrypoint) {
                    result[path] = value.description;
                }
                return result;
            }, {});
            reasonSkipped = 'There is no longer a valid .cdn-config.yml present';
        } else {
            entrypoints = null;
            reasonIgnored = 'There is no valid .cdn-config.yml present';
        }
        let mappings = _getMappings(repoConfig);
        let manifestSha = manifestVersion ? manifestVersion.git_sha : null;

        let canUpdate = !reasonIgnored && !reasonSkipped;

        let sha = ref.commitSha;
        return {
            name: name,
            ref: ref.ref,
            tarballUrl: ref.tarballUrl,
            inManifest: !!manifestSha,
            manifestSha: manifestSha,
            commitSha: sha,
            link: ref.viewUrl,
            resources: {
                entrypoints: entrypoints,
                mappings: mappings
            },
            ignored: !!reasonIgnored,
            reasonIgnored: reasonIgnored,
            skipped: !!reasonSkipped,
            reasonSkipped: reasonSkipped,
            canUpdate: canUpdate,
            needsUpdate: canUpdate && (forceReload || sha !== manifestSha || sha !== contentSha)
        };

        function _getMappings(repoConfig) {
            if (!repoConfig) return null;
            return repoConfig.resources.map(r => {
                if (typeof r === 'string') {
                    return {
                        src: r
                    }
                } else {
                    return r;
                }
            });
        }
    }

    /**
     *
     * @param {Version[]} versions
     * @returns {object.<string,string>}
     */
    static computeAliasesForVersions(versions) {
        let semvers = versions.map(v => v.name).filter(semver.valid);
        if (!semvers || !semvers.length) return {};
        let aliases = semvers.reduce((set, each) => {
            let major = semver.major(each);
            let minor = semver.minor(each);
            set.add(`${major}.x.x`);
            set.add(`${major}.${minor}.x`);
            return set;
        }, new Set());

        let result = [...aliases].reduce((obj, alias) => {
            obj[alias] = semver.maxSatisfying(semvers, alias);
            return obj;
        }, {});
        result.latest = semver.maxSatisfying(semvers, '*');
        return result;
    }

}

module.exports = CdnConfig;
