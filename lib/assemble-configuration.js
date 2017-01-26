/**
 * Created by ThatJoeMoore on 1/25/17.
 */
"use strict";

const CdnConfig = require('./cdn-config');
const constants = require('./constants');
const sources = require('./sources');

/**
 * @export
 * @param {Object.<string, string>} libsToSources
 * @returns {Promise.<CdnConfig>}
 */
module.exports = function assembleConfiguration(libsToSources) {
    let libIds = Object.getOwnPropertyNames(libsToSources);
    let libs = libIds.map(libId => {
        let sourceString = libsToSources[libId];
        let sourceInfo = sources.parseSourceInfo(sourceString);
        return CdnConfig.createLib(libId, sourceInfo);
    });
    let config = new CdnConfig(libs);

    return config.promiseAllLibs(lib => {
        return sources.listRefs(lib.sourceInfo)
            //Add in version information
            .then((result) => {
                let {tags, branches} = result;
                lib.versions = _refsToVersions(tags, branches);
            })
            //Compute Aliases
            .then(() => {
                lib.aliases = CdnConfig.computeAliasesForVersions(lib.versions);
            });
    }).then(() => {
        config.computeAliasesForAllLibs()
    });

    /*
     * to populate:
     * - lib versions & aliases
     * - contentCommit
     * - oldManifest? or do we do that separately? Or do we integrate its information into the
     *      library objects?
     */
};

/**
 *
 * @param {refInfo} ref
 * @returns {Version}
 * @private
 */
function _versionFromRef(ref) {
    return CdnConfig.createLibVersion(
        ref.name, ref.ref, ref.tarballUrl, ref.commitSha
    );
}

function _refsToVersions(tags, branches) {
    let versions = tags.map(_versionFromRef);

    //We currently only support the master branch - change this later?
    let master = branches.find(b => b.ref === 'master');
    if (master) {
        master.name = constants.VERSION_ALIASES.MASTER;
        versions.push(master);
    }
    return versions;
}