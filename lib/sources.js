/**
 * Created by ThatJoeMoore on 1/25/17.
 */
"use strict";

const constants = require('./constants');

module.exports = {
    getSourceInfo: getSourceInfo
};

function getSourceInfo(sourceString) {
    let [type, value] = sourceString.split(':', 2);
    switch (type) {
        case constants.SOURCE_KEYS.GITHUB:
            let [owner, repo] = sourceString.split('/');
            return {
                type: constants.SOURCE_KEYS.GITHUB,
                owner: owner,
                repo: repo
            };
            break;
        default:
            throw `Unknown source type: ${type}`;
    }
}