/**
 * Created by ThatJoeMoore on 1/24/17
 */
"use strict";

const package_json = require('./../package.json');
const sources = require('./sources');
const constants = require('./constants');
const githubApi = require('./github-committer');
const util = require('./util');
const semver = require('semver');
const log = require('winston');

function libsToUse(dataSet, includeIgnored) {
    return includeIgnored ? dataSet.libs : dataSet.libs.filter(l => {
            return l.versions.some(v => !v.ignore);
        });
}

function versionsToUse(lib, includeIgnored) {
    return includeIgnored ? lib.versions : lib.versions.filter(v => v.ignored);
}

/**
 * @typedef {{}} Version
 * @property {!string} name
 * @property {!string} ref
 * @property {!string} tarballUrl
 * @property {!boolean} inManifest
 * @property {?string} manifestSha
 * @property {!string} commitSha
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
            log.debug('successfully loaded content manifest');
            let libsPromise = Promise.all(libIds.map(libId => {
                let sourceString = libsToSources[libId].source;
                return CdnConfig.createLib(libId, sourceString, manifest.libraries[libId]);
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
        this.cdnVersion = package_json.version;

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
     * @param {boolean} [includeIgnored=false]
     */
    forEachLib(fun, includeIgnored) {
        libsToUse(this, includeIgnored).forEach(fun);
    }

    /**
     *
     * @param {libCallback} fun
     * @param {boolean} [includeIgnored=false]
     * @returns {Array|*|{}}
     */
    mapLibs(fun, includeIgnored) {
        return libsToUse(this, includeIgnored).map(fun);
    }

    /**
     *
     * @param {libCallback} fun
     * @param {boolean} [includeIgnored=false]
     * @returns {Promise.<CdnConfig>}
     */
    promiseAllLibs(fun, includeIgnored) {
        return Promise.all(
            this.mapLibs(lib => {
                return Promise.resolve(fun(lib));
            })
        ).then(() => this);
    }

    /**
     * @callback libVerCallback
     * @param {Library} lib
     * @param {Version} version
     */

    /**
     * @param {libVerCallback} fun
     * @param {boolean} [includeIgnored=false]
     */
    forEachLibVersion(fun, includeIgnored) {
        this.libs.forEach(lib => {
            versionsToUse(lib, includeIgnored).forEach(fun);
        });
    }

    /**
     * @param {libVerCallback} fun
     * @param {boolean} [includeIgnored=false]
     */
    promiseAllLibVersions(fun, includeIgnored) {
        return this.promiseAllLibs(lib => {
            let vers = versionsToUse(lib, includeIgnored);
            return Promise.all(
                vers.map(v => Promise.resolve(fun(lib, v)))
            );
        })
    }

    /**
     * Create a library object
     * @param {string} id
     * @param {string} sourceString
     * @param {?ManifestLib} manifestLib
     * @returns {Promise.<Library>}
     */
    static createLib(id, sourceString, manifestLib) {
        let si = sources.parseSourceInfo(sourceString);
        return sources.listRefs(si)
            .then((result) => {
                let {tags, branches} = result;
                return _refsToVersions(tags, branches);
            })
            .then(versions => {
                return {
                    id: id,
                    sourceInfo: si,
                    versions: versions,
                    aliases: CdnConfig.computeAliasesForVersions(versions)
                };
            });


        function _versionFromRef(ref, name) {
            let realName = name || ref.name;
            let manifestVersion = manifestLib.versions.find(v => v.name === realName);

            return sources.fetchRepoConfig(si, ref.ref)
                .catch(err => null)
                .then(repoConfig => {
                    return CdnConfig.createLibVersion(
                        realName, ref.ref, ref.tarballUrl, ref.commitSha, manifestVersion, repoConfig
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
    }

    /**
     * Create a version for a lib
     * @param {string} name
     * @param {string} ref
     * @param {string} tarballUrl
     * @param {string} sha
     * @param {?ManifestVersion} manifestVersion
     * @param {?RepoConfig} repoConfig
     * @returns {Version}
     */
    static createLibVersion(name, ref, tarballUrl, sha, manifestVersion, repoConfig) {
        let entrypoints;
        let reasonIgnored = null;
        let reasonSkipped = null;
        if (repoConfig) {
            entrypoints = repoConfig.entrypoints;
        } else if (manifestVersion) {
            entrypoints = Object.getOwnPropertyNames(manifestVersion.resources).reduce((result, path) => {
                let value = manifestVersion.resources[path];
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
        let mappings = repoConfig ? repoConfig.resources : null;
        let manifestSha = manifestVersion ? manifestVersion.git_sha : null;
        return {
            name: name,
            ref: ref,
            tarballUrl: tarballUrl,
            inManifest: !!manifestSha,
            manifestSha: manifestSha,
            commitSha: sha,
            resources: {
                entrypoints: entrypoints,
                mappings: mappings
            },
            ignored: !!reasonIgnored,
            reasonIgnored: reasonIgnored,
            skipped: !!reasonSkipped,
            reasonSkipped: reasonSkipped,
            needsUpdate: sha !== manifestSha && !reasonIgnored && !reasonSkipped
        };
    }

    /**
     *
     * @param {Version[]} versions
     * @returns {object.<string,string>}
     */
    static computeAliasesForVersions(versions) {
        let semvers = versions.map(v => v.name).filter(semver.valid);
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
