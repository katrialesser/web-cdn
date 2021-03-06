/**
 * Created by ThatJoeMoore on 2/1/17
 */
"use strict";
const AWS = require('aws-sdk');
const log = require('winston');
const fs = require('fs-extra-p');
const util = require('../util');
const constants = require('../constants');

const s3Options = {
    s3Client: new AWS.S3()
};
const s3 = require('s3').createClient(s3Options);

const cloudfront = new AWS.CloudFront();

/**
 * @param {CdnConfig} config
 * @param {string} contentPath
 * @param {string} stagingPath
 * @param {FilesystemChanges} filesystemChanges
 * @returns {Promise.<*>}
 */
module.exports = function pushToS3(config, contentPath, stagingPath, filesystemChanges) {
    log.info('-------------- Pushing to Amazon S3 --------------');
    if (filesystemChanges.onlyManifestChanged) {
        log.info('Only manifest changed; skipping push to S3');
        return Promise.resolve();
    }

    return fs.emptyDir(stagingPath)
        .then(() => fs.copy(contentPath, stagingPath, {
            overwrite: true,
            dereference: true,
            preserveTimestamps: true
        })).then(() => _uploadDir(stagingPath))
        .then(() => _invalidateCloudfront());

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
            uploader.on('fileUploadEnd', (_, s3Key) => {
                log.debug(`Finished uploading ${s3Key}`);
            });
            uploader.on('progress', () => {
                if (uploader.progressAmount > 0)
                    log.info(`S3 Progress: ${(uploader.progressAmount / uploader.progressTotal) * 100}%`);
            });
            uploader.on('error', reject);
            uploader.on('end', resolve);
        });
    }

    function _invalidateCloudfront() {
        let paths = config.asLibVersions()
            .filter(obj => obj.version.needsUpdate)
            .map(obj => {
                let {lib, version} = obj;
                let aliasesToUpdate = util.objectAsArray(lib.aliases)
                    .filter(pair => pair.value === version.name)
                    .map(pair => pair.key);

                aliasesToUpdate.push(version.name);

                return aliasesToUpdate.map(name => `/${lib.id}/${name}/*`)
            }).reduce((previous, value) => previous.concat(value), []);
        paths.push('/manifest.json');

        return _getDistribution()
            .then(distro => {
                if (!distro) {
                    log.warn(`!!!!!!!!! Unable to create CloudFront Invalidation: couldn't find distribution with alias ${constants.S3.BUCKET.PROD}`);
                    return;
                }
                let id = distro.Id;

                let params = {
                    DistributionId: id,
                    InvalidationBatch: {
                        CallerReference: util.hash('sha256', JSON.stringify(filesystemChanges.hashes)).hex,
                        Paths: {
                            Quantity: paths.length,
                            Items: paths
                        }
                    }
                };

                log.info('-------------- Invalidating CloudFront Cache --------------');
                log.debug('Distribution: ', id);
                log.debug('File Paths: ', paths);

                return cloudfront.createInvalidation(params).promise()
                    .then(result => log.info('Created invalidation ', result.Invalidation.Id))
            });
    }

    function _getDistribution() {
        return _doGet();

        function _doGet(marker) {
            let params = {};
            if (marker) params.Marker = marker;
            return cloudfront.listDistributions(params).promise()
                .then(response => {
                    let list = response.DistributionList;
                    let distro = list.Items.find(d => {
                        return d.Aliases && d.Aliases.Items && d.Aliases.Items.includes(constants.S3.BUCKET.PROD);
                    });
                    if (distro) {
                        return distro;
                    } else if (list.IsTruncated && list.Marker) {
                        return _doGet(response, list.Marker)
                    } else {
                        return null;
                    }
                });
        }
    }
};



