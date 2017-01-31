"use strict";

const klaw = require('klaw');

const ghClient = require('./github-client');
const constants = require('./constants');

module.exports = function commitContent(config, contentPath) {
    let currentBlobs;

    return _getCurrentBlobs()
        .then()
        ;


    function _getCurrentBlobs() {
        let blobs = {};
        return readTree(config.contentInfo.treeSha, '')
            .then(() => currentBlobs = blobs);

        function readTree(treeSha, basePath) {
            return ghClient.getTree(
                constants.CDN.GITHUB_ORG, constants.CDN.GITHUB_REPO, treeSha
            ).then(tree => {
                let parts = tree.tree;
                parts.filter(t => t.type === 'blob')
                    .forEach(t => blobs[path.join(basePath, t.path)] = t.sha);
                return Promise.all(
                    parts.filter(t => t.type === 'tree')
                        .map(t => readTree(t.sha, path.join(basePath, t.path)))
                );
            });
        }
    }

};



