"use strict";

const CdnConfig = require('./lib/cdn-config');
const path = require('path');
const buildFilesystem = require('./lib/steps/build-filesystem');
const commitContent = require('./lib/steps/commit-content');
const pushToS3 = require('./lib/steps/push-to-s3');

const SCRATCH_DIR_NAME = '.tmp';

const scratchPath = path.join(process.cwd(), SCRATCH_DIR_NAME);
const contentPath = path.join(scratchPath, 'content');
const workPath = path.join(scratchPath, 'work');
const stagingPath = path.join(scratchPath, 's3-staging');


module.exports = function runner(config) {
    //Step 1 - Build the config
    return CdnConfig.loadFromConfig(config).then(cfg => {
        // Step 2 - Build the filesystem
        return buildFilesystem(cfg, contentPath, workPath).then(changes =>
            // Step 3 - Commit content to Github
            commitContent(cfg, changes, contentPath).then(() =>
                // Step 4 - Push changes to S3
                pushToS3(cfg, contentPath, stagingPath, changes)
            )
        );
    }).catch(err => {
        console.error(err);
    });
};
