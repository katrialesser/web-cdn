/**
 * Created by jmooreoa on 1/24/17.
 */
"use strict";

const package_json = require('./../package.json');
const path = require('path');
const semver = require('semver');

function libsToUse(dataSet, includeIgnored) {
    return includeIgnored ? dataSet.libs : dataSet.libs.filter(l => {
            return l.versions.some(v => !v.ignore);
        });
}

function versionsToUse(lib, includeIgnored) {
    return includeIgnored ? lib.versions : lib.versions.filter(v =>  v.ignored);
}

/**
 * @typedef {object} Version
 * @property {!string} name
 * @property {!string} ref
 * @property {!string} tarballUrl
 * @property {!string} commitSha
 * @property {?Object} resources
 * @property {Object.<string, string>} resources.entrypoints
 * @property {ResourceMapping[]} resources.mappings
 * @property {!boolean} needsUpdate
 * @property {!boolean} ignored
 * @property {?string} reasonIgnored
 */

/**
 * @typedef {object} ResourceMapping
 * @property {!string} src
 * @property {?string} dest
 */

/**
 * @typedef {object} Library
 * @property {string} id
 * @property {object} sourceInfo
 * @property {Version[]} versions
 * @property {object.<string, string>} aliases
 * @property {object} display
 * @property {string} display.name
 * @property {string} display.description
 * @property {string} display.docs
 */

class CdnConfig {
    /**
     *
     * @param {Library[]} libs
     */
    constructor(libs) {
        /**
         * @type {string}
         */
        this.cdnVersion = package_json.version;

        /**
         * @type {Library[]}
         */
        this.libs = libs;

        /**
         * @type {?object}
         * @property {string} sha
         * @property {string} tree
         */
        this.contentCommit = null;

        /**
         * @type {?object}
         */
        this.manifest = null;

        /**
         * @type {?object}
         */
        this.newManifest = null;
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
     * @param sourceInfo
     * @param scratchDir
     * @returns {Library}
     */
    static createLib(id, sourceInfo) {
        return {
            id: id,
            sourceInfo: sourceInfo,
            version: [],
            aliases: {}
        }
    }

    /**
     * Create a version for a lib
     * @param {string} name
     * @param {string} ref
     * @param {string} tarballUrl
     * @param {string} sha
     * @returns {Version}
     */
    static createLibVersion(name, ref, tarballUrl, sha) {
        return {
            name: name,
            ref: ref,
            tarball: tarballUrl,
            git_sha: sha,
            needsUpdate: false,
            ignored: false,
            reasonIgnored: null
        };
    }

    /**
     *
     */
    computeAliasesForAllLibs() {
        this.libs.forEach(l => {
            l.aliases = CdnConfig.computeAliasesForVersions(l.versions);
        });
    }

    /**
     *
     * @param {Version[]} versions
     * @returns {object.<string,string>}
     */
    static computeAliasesForVersions(versions) {
        let semvers = versions.map(v => v.name)
            .filter(semver.valid);
        let aliases = versions.map(v => v.name)
            .reduce((set, each) => {
                let major = semver.major(each);
                let minor = semver.minor(each);
                set.add(`${major}.x.x`);
                set.add(`${major}.${minor}.x`);
                return set;
            }, new Set());

        let result = [...aliases].reduce((obj, alias) => {
            obj[alias] = semver.maxSatisfying(semvers, alias);
            return obj;
        });
        result.latest = semver.maxSatisfying('*', semvers);
        return result;
    }

}

module.exports = CdnConfig;
