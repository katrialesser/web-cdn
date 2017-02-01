/**
 * Created by ThatJoeMoore on 2/1/17
 */
"use strict";
const AWS = require('aws-sdk');
const log = require('winston');
const fs = require('fs-extra-p');
const constants = require('../constants');

const s3Options = {
    s3Client: new AWS.S3()
};
const s3 = require('s3').createClient(s3Options);

/**
 *
 * @param {string} contentPath
 * @param {string} stagingPath
 * @param {FilesystemChanges} filesystemChanges
 * @returns {Promise.<*>}
 */
module.exports = function pushToS3(contentPath, stagingPath, filesystemChanges) {
    log.info('-------------- Pushing to Amazon S3 --------------');
    if (filesystemChanges.onlyManifestChanged) {
        log.info('Only manifest changed; skipping push to S3');
        return Promise.resolve();
    }

    return fs.copy(contentPath, stagingPath, {
        overwrite: true,
        dereference: true,
        preserveTimestamps: true
    }).then(() => _uploadDir(stagingPath));

    function _uploadDir(dir) {
       return new Promise((resolve, reject) => {
        let uploader = s3.uploadDir({
            localDir: dir,
            deleteRemoved: true,
            followSymlinks: false,
            s3Params: {
                Bucket: constants.S3.BUCKET.PROD,
                ACL: 'public-read'
            }
        });
        uploader.on('progress', () => {
            if (uploader.progressAmount > 0)
                log.info(`S3 Progress: ${(uploader.progressAmount / uploader.progressTotal) * 100}%`);
        });
        uploader.on('error', reject);
        uploader.on('end', resolve);
    });

    }
};



