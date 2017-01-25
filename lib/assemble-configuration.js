/**
 * Created by ThatJoeMoore on 1/25/17.
 */
"use strict";

const CdnConfig = require('./cdn-config');
const constants = require('./constants');
const sources = require('./sources');

module.exports = function assembleConfiguration(libsToSources) {
    let libIds = Object.getOwnPropertyNames(libsToSources);
    let libs = libIds.map(libId => {
        let source = libsToSources[libId];
        let sourceInfo = sources.getSourceInfo(source);
        return CdnConfig.createLib(libId, sourceInfo);
    });

};